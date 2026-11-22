import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { ADMIN_AND_OWNER_ROLES, requireRole } from '../../../../lib/admin-staff'
import type { LegalPageVersion } from '../../../../lib/legal-page-types'

const MAX_TITLE_LENGTH = 160
const MAX_BODY_LENGTH = 50_000
const pageColumns = 'id, slug, version, title, body, status, published_at, created_at, created_by'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}


async function readEditorPayload(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return { response: jsonError('Le contenu reçu est illisible.', 400) }
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { response: jsonError('Le contenu reçu est invalide.', 400) }
  }

  const payload = body as Record<string, unknown>
  if (typeof payload.title !== 'string' || typeof payload.body !== 'string') {
    return { response: jsonError('Le titre et le texte des conditions sont obligatoires.', 400) }
  }
  if (payload.title.length > MAX_TITLE_LENGTH) {
    return { response: jsonError(`Le titre ne peut pas dépasser ${MAX_TITLE_LENGTH} caractères.`, 400) }
  }
  if (payload.body.length > MAX_BODY_LENGTH) {
    return { response: jsonError(`Le texte ne peut pas dépasser ${MAX_BODY_LENGTH.toLocaleString('fr-FR')} caractères.`, 400) }
  }

  return { title: payload.title, body: payload.body }
}

function findPublicationIssues(body: string) {
  const bracketPassages = [...body.matchAll(/\[[\s\S]*?\]/g)].map(([passage]) => passage)
  const htmlTags = [...body.matchAll(/<\/?[a-zA-Z][^>]*>/g)].map(([tag]) => tag)
  const issues = [
    ...new Set(bracketPassages.map((passage) => `Passage entre crochets : ${passage}`)),
    ...new Set(htmlTags.map((tag) => `Balise HTML : ${tag}`)),
  ]
  return issues
}

export async function GET(request: Request) {
  const authorization = await requireRole(request, ADMIN_AND_OWNER_ROLES, 'Legal pages')
  if ('response' in authorization) return authorization.response

  try {
    const supabase = authorization.supabase
    const { data, error } = await supabase
      .from('legal_page_versions')
      .select(pageColumns)
      .eq('slug', 'conditions')
      .order('version', { ascending: false })

    if (error) {
      console.error('[Legal pages] Chargement des versions impossible.', { errorCode: error.code })
      return jsonError('Impossible de charger les brouillons et l’historique des conditions.', 500)
    }

    const history = (data ?? []) as LegalPageVersion[]
    const draft = history.find((version) => version.status === 'brouillon') ?? null
    return NextResponse.json({ draft, history })
  } catch (error) {
    console.error('[Legal pages] Chargement des versions impossible.', {
      errorName: error instanceof Error ? error.name : 'unknown',
    })
    return jsonError('Impossible de charger les brouillons et l’historique des conditions.', 500)
  }
}

export async function PUT(request: Request) {
  const authorization = await requireRole(request, ADMIN_AND_OWNER_ROLES, 'Legal pages')
  if ('response' in authorization) return authorization.response

  const payload = await readEditorPayload(request)
  if ('response' in payload) return payload.response

  try {
    const supabase = authorization.supabase
    const { data: currentDraft, error: draftError } = await supabase
      .from('legal_page_versions')
      .select('id')
      .eq('slug', 'conditions')
      .eq('status', 'brouillon')
      .maybeSingle()
    if (draftError) {
      console.error('[Legal pages] Recherche du brouillon impossible.', { errorCode: draftError.code })
      return jsonError('Impossible de charger le brouillon des conditions.', 500)
    }

    let result
    if (currentDraft) {
      result = await supabase
        .from('legal_page_versions')
        .update({ title: payload.title, body: payload.body })
        .eq('id', currentDraft.id)
        .eq('status', 'brouillon')
        .select(pageColumns)
        .single()
    } else {
      const { data: latest, error: latestError } = await supabase
        .from('legal_page_versions')
        .select('version')
        .eq('slug', 'conditions')
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (latestError) {
        console.error('[Legal pages] Calcul de version impossible.', { errorCode: latestError.code })
        return jsonError('Impossible de préparer un nouveau brouillon.', 500)
      }
      result = await supabase
        .from('legal_page_versions')
        .insert({
          slug: 'conditions',
          version: (latest?.version ?? 0) + 1,
          title: payload.title,
          body: payload.body,
          status: 'brouillon',
          created_by: authorization.user.id,
        })
        .select(pageColumns)
        .single()
    }

    if (result.error) {
      console.error('[Legal pages] Enregistrement du brouillon impossible.', { errorCode: result.error.code })
      if (result.error.code === '23505') {
        return jsonError('Un brouillon vient d’être créé. Rechargez la page avant de réessayer.', 409)
      }
      return jsonError('Le brouillon n’a pas pu être enregistré.', 500)
    }

    return NextResponse.json({ message: 'Le brouillon des conditions a été enregistré.', draft: result.data })
  } catch (error) {
    console.error('[Legal pages] Enregistrement du brouillon impossible.', {
      errorName: error instanceof Error ? error.name : 'unknown',
    })
    return jsonError('Le brouillon n’a pas pu être enregistré.', 500)
  }
}

export async function POST(request: Request) {
  const authorization = await requireRole(request, ADMIN_AND_OWNER_ROLES, 'Legal pages')
  if ('response' in authorization) return authorization.response

  const payload = await readEditorPayload(request)
  if ('response' in payload) return payload.response
  if (!payload.title.trim() || !payload.body.trim()) {
    return jsonError('Ajoutez un titre et un texte avant de publier les conditions.', 400)
  }

  const issues = findPublicationIssues(payload.body)
  if (issues.length > 0) {
    return jsonError(`Publication refusée. Corrigez les passages suivants :\n${issues.map((issue) => `• ${issue}`).join('\n')}`, 400)
  }

  try {
    const supabase = authorization.supabase
    const publishedAt = new Date().toISOString()
    const { data: currentDraft, error: draftError } = await supabase
      .from('legal_page_versions')
      .select('id')
      .eq('slug', 'conditions')
      .eq('status', 'brouillon')
      .maybeSingle()
    if (draftError) {
      console.error('[Legal pages] Recherche du brouillon impossible.', { errorCode: draftError.code })
      return jsonError('Impossible de charger le brouillon avant publication.', 500)
    }

    let result
    if (currentDraft) {
      result = await supabase
        .from('legal_page_versions')
        .update({
          title: payload.title,
          body: payload.body,
          status: 'publie',
          published_at: publishedAt,
        })
        .eq('id', currentDraft.id)
        .eq('status', 'brouillon')
        .select(pageColumns)
        .maybeSingle()
    } else {
      const { data: latest, error: latestError } = await supabase
        .from('legal_page_versions')
        .select('version')
        .eq('slug', 'conditions')
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (latestError) {
        console.error('[Legal pages] Calcul de version impossible.', { errorCode: latestError.code })
        return jsonError('Impossible de préparer une nouvelle version.', 500)
      }
      result = await supabase
        .from('legal_page_versions')
        .insert({
          slug: 'conditions',
          version: (latest?.version ?? 0) + 1,
          title: payload.title,
          body: payload.body,
          status: 'publie',
          published_at: publishedAt,
          created_by: authorization.user.id,
        })
        .select(pageColumns)
        .single()
    }

    if (result.error || !result.data) {
      console.error('[Legal pages] Publication impossible.', { errorCode: result.error?.code ?? 'missing_row' })
      if (result.error?.code === '23505') {
        return jsonError('Une nouvelle version vient d’être publiée. Rechargez la page avant de réessayer.', 409)
      }
      return jsonError('La nouvelle version des conditions n’a pas pu être publiée.', 500)
    }

    revalidatePath('/conditions')
    return NextResponse.json({
      message: `La version ${result.data.version} des conditions a été publiée.`,
      version: result.data,
    })
  } catch (error) {
    console.error('[Legal pages] Publication impossible.', {
      errorName: error instanceof Error ? error.name : 'unknown',
    })
    return jsonError('La nouvelle version des conditions n’a pas pu être publiée.', 500)
  }
}
