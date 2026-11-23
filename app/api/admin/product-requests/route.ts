import { NextResponse } from 'next/server'
import { ADMIN_AND_OWNER_ROLES, requireRole } from '../../../../lib/admin-staff'

const STATUSES = new Set(['new', 'en_cours', 'devis_envoye', 'converti', 'sans_suite'])
const PERIODS = new Set(['7', '30', '90', 'all'])

type ProductRequestRow = {
  id: string
  created_at: string
  search_query: string
  whatsapp: string
  link: string | null
  description: string | null
  image_path: string | null
  user_id: string | null
  status: string
  admin_notes: string | null
  quoted_price: number | string | null
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function parseQuotedPrice(value: unknown): number | null | 'invalid' {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const normalized = trimmed.replace(/\s+/g, '').replace(',', '.')
    if (!/^\d+(\.\d+)?$/.test(normalized)) return 'invalid'
    const parsed = Number(normalized)
    if (!Number.isFinite(parsed) || parsed < 0) return 'invalid'
    return parsed
  }
  return 'invalid'
}

export async function GET(request: Request) {
  const authorization = await requireRole(request, ADMIN_AND_OWNER_ROLES, 'Admin product requests')
  if ('response' in authorization) return authorization.response

  const url = new URL(request.url)
  const status = url.searchParams.get('status') ?? 'all'
  const period = url.searchParams.get('period') ?? '30'
  const mode = url.searchParams.get('mode')

  if (status !== 'all' && !STATUSES.has(status)) {
    return jsonError('Filtre de statut invalide.', 400)
  }
  if (!PERIODS.has(period)) {
    return jsonError('Choisissez une période valide : 7, 30, 90 jours ou tout.', 400)
  }

  try {
    const supabase = authorization.supabase

    const [{ count: newCount, error: countError }, zeroResultSearchesResult] = await Promise.all([
      supabase.from('product_requests').select('id', { count: 'exact', head: true }).eq('status', 'new'),
      supabase.rpc('admin_analytics_zero_result_searches', { p_period: period }),
    ])

    if (countError) {
      console.error('[Admin product requests] New count query failed', countError.message)
      return jsonError('Impossible de charger les demandes produit.', 503)
    }
    if (zeroResultSearchesResult.error) {
      console.error('[Admin product requests] Zero-result searches query failed', zeroResultSearchesResult.error.message)
    }

    const zeroResultSearches = zeroResultSearchesResult.error ? [] : (zeroResultSearchesResult.data ?? [])

    if (mode === 'count') {
      return NextResponse.json({ newCount: newCount ?? 0, zeroResultSearches }, { headers: { 'Cache-Control': 'no-store' } })
    }

    let query = supabase
      .from('product_requests')
      .select('id, created_at, search_query, whatsapp, link, description, image_path, user_id, status, admin_notes, quoted_price')
      .order('created_at', { ascending: false })
      .limit(200)

    if (status !== 'all') {
      query = query.eq('status', status)
    }

    const { data, error } = await query
    if (error) {
      console.error('[Admin product requests] List query failed', error.message)
      return jsonError('Impossible de charger les demandes produit.', 503)
    }

    const rows = (data ?? []) as ProductRequestRow[]
    const imagePaths = rows.map((row) => row.image_path).filter((path): path is string => Boolean(path))
    const signedMap = new Map<string, string>()

    if (imagePaths.length > 0) {
      const { data: signedData, error: signedError } = await supabase.storage
        .from('product-requests')
        .createSignedUrls(imagePaths, 3600)

      if (signedError) {
        console.error('[Admin product requests] Signed URL generation failed', signedError.message)
      } else {
        for (const item of signedData ?? []) {
          if (item.path && item.signedUrl) {
            signedMap.set(item.path, item.signedUrl)
          }
        }
      }
    }

    const requests = rows.map((row) => ({
      id: row.id,
      created_at: row.created_at,
      search_query: row.search_query,
      whatsapp: row.whatsapp,
      link: row.link,
      description: row.description,
      image_path: row.image_path,
      image_url: row.image_path ? (signedMap.get(row.image_path) ?? null) : null,
      user_id: row.user_id,
      status: row.status,
      admin_notes: row.admin_notes ?? '',
      quoted_price: row.quoted_price === null || row.quoted_price === undefined ? '' : String(row.quoted_price),
    }))

    return NextResponse.json(
      { requests, newCount: newCount ?? 0, zeroResultSearches },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('[Admin product requests] Request handling failed', error)
    return jsonError('Impossible de charger les demandes produit.', 503)
  }
}

export async function PATCH(request: Request) {
  const authorization = await requireRole(request, ADMIN_AND_OWNER_ROLES, 'Admin product requests')
  if ('response' in authorization) return authorization.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError('Le contenu reçu est illisible.', 400)
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return jsonError('Le contenu reçu est invalide.', 400)
  }

  const payload = body as Record<string, unknown>
  const id = typeof payload.id === 'string' ? payload.id.trim() : ''
  if (!id) return jsonError('Identifiant de demande manquant.', 400)

  const updates: Record<string, unknown> = {}
  if (payload.status !== undefined) {
    if (typeof payload.status !== 'string' || !STATUSES.has(payload.status)) {
      return jsonError('Statut invalide.', 400)
    }
    updates.status = payload.status
  }
  if (payload.admin_notes !== undefined) {
    if (typeof payload.admin_notes !== 'string') {
      return jsonError('Les notes internes sont invalides.', 400)
    }
    updates.admin_notes = payload.admin_notes.trim() || null
  }
  if (payload.quoted_price !== undefined) {
    const parsed = parseQuotedPrice(payload.quoted_price)
    if (parsed === 'invalid') {
      return jsonError('Le prix proposé est invalide.', 400)
    }
    updates.quoted_price = parsed
  }

  if (Object.keys(updates).length === 0) {
    return jsonError('Aucune modification fournie.', 400)
  }

  try {
    const supabase = authorization.supabase
    const { data, error } = await supabase
      .from('product_requests')
      .update(updates)
      .eq('id', id)
      .select('id, status, admin_notes, quoted_price')
      .maybeSingle()

    if (error) {
      console.error('[Admin product requests] Update failed', error.message)
      return jsonError('La demande n’a pas pu être mise à jour.', 500)
    }
    if (!data) {
      return jsonError('Demande introuvable.', 404)
    }

    const { count: newCount } = await supabase
      .from('product_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'new')

    return NextResponse.json({
      request: {
        id: data.id as string,
        status: data.status as string,
        admin_notes: (data.admin_notes as string | null) ?? '',
        quoted_price: data.quoted_price === null || data.quoted_price === undefined ? '' : String(data.quoted_price),
      },
      newCount: newCount ?? 0,
    })
  } catch (error) {
    console.error('[Admin product requests] Update request failed', error)
    return jsonError('La demande n’a pas pu être mise à jour.', 500)
  }
}
