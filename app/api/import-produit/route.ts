import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createSupabaseAdminClient } from '../../../lib/supabase-admin'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-import-key',
  'Access-Control-Max-Age': '86400',
}

function corsJson(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, {
    status: init?.status,
    headers: CORS_HEADERS,
  })
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function getImageExtension(contentType: string | null, imageUrl: string): string {
  const type = (contentType ?? '').toLowerCase().split(';')[0]?.trim() ?? ''
  if (type === 'image/png') return 'png'
  if (type === 'image/webp') return 'webp'
  if (type === 'image/jpeg' || type === 'image/jpg') return 'jpg'
  try {
    const pathname = new URL(imageUrl).pathname.toLowerCase()
    const match = pathname.match(/\.(jpe?g|png|webp)(?:$|\?)/)
    if (match) return match[1] === 'jpeg' ? 'jpg' : match[1]
  } catch {
    // ignore
  }
  return 'jpg'
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(request: Request) {
  const providedKey = request.headers.get('x-import-key')
  const expectedKey = process.env.IMPORT_KEY
  if (!expectedKey || !providedKey || providedKey !== expectedKey) {
    return corsJson({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return corsJson({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null) {
    return corsJson({ ok: false, error: 'Invalid body' }, { status: 400 })
  }

  const payload = body as Record<string, unknown>
  const titre = typeof payload.titre === 'string' ? payload.titre.trim() : ''
  const prixChine = toFiniteNumber(payload.prix_chine)
  const devise = payload.devise === 'CNY' || payload.devise === 'FCFA' ? payload.devise : null
  const image = typeof payload.image === 'string' ? payload.image.trim() : ''
  const poidsKg = toFiniteNumber(payload.poids_kg)
  const urlSource = typeof payload.url_source === 'string' ? payload.url_source.trim() : ''

  if (!titre || prixChine === null || prixChine < 0 || !devise || !image || poidsKg === null || poidsKg <= 0) {
    return corsJson({ ok: false, error: 'Missing or invalid fields' }, { status: 400 })
  }

  let supabase
  try {
    supabase = createSupabaseAdminClient()
  } catch {
    return corsJson({ ok: false, error: 'Server configuration error' }, { status: 500 })
  }

  const { data: settingsRow, error: settingsError } = await supabase
    .from('app_settings')
    .select('transport_price_per_kg_fcfa, commission_percent, cny_to_fcfa_rate')
    .eq('id', 1)
    .maybeSingle()

  if (settingsError) {
    return corsJson({ ok: false, error: 'Unable to load settings' }, { status: 500 })
  }

  const rawTransport = settingsRow?.transport_price_per_kg_fcfa
  const rawCommission = settingsRow?.commission_percent
  const transportPerKg =
    rawTransport === null || rawTransport === undefined || rawTransport === ''
      ? Number.NaN
      : Number(rawTransport)
  const commissionPercent =
    rawCommission === null || rawCommission === undefined || rawCommission === ''
      ? Number.NaN
      : Number(rawCommission)
  const cnyToFcfaRate = settingsRow?.cny_to_fcfa_rate == null ? null : Number(settingsRow.cny_to_fcfa_rate)

  if (!Number.isFinite(transportPerKg) || transportPerKg <= 0 || !Number.isFinite(commissionPercent) || commissionPercent <= 0) {
    return corsJson({ ok: false, error: 'Réglages de prix non configurés' }, { status: 400 })
  }

  if (devise === 'CNY' && (cnyToFcfaRate === null || !Number.isFinite(cnyToFcfaRate) || cnyToFcfaRate <= 0)) {
    return corsJson({ ok: false, error: 'CNY to FCFA rate is not configured' }, { status: 400 })
  }

  const prixAchatFcfa = devise === 'CNY' ? prixChine * (cnyToFcfaRate as number) : prixChine
  const prixVenteCalcule = (prixAchatFcfa + poidsKg * transportPerKg) * (1 + commissionPercent / 100)
  const prixVente = Math.ceil(prixVenteCalcule / 10) * 10

  if (!Number.isFinite(prixVente) || prixVente < 0) {
    return corsJson({ ok: false, error: 'Unable to compute sale price' }, { status: 400 })
  }

  const productId = randomUUID()

  let imageResponse: Response
  try {
    imageResponse = await fetch(image)
  } catch {
    return corsJson({ ok: false, error: 'Unable to download image' }, { status: 400 })
  }

  if (!imageResponse.ok) {
    return corsJson({ ok: false, error: 'Unable to download image' }, { status: 400 })
  }

  const contentType = imageResponse.headers.get('content-type')
  const extension = getImageExtension(contentType, image)
  const arrayBuffer = await imageResponse.arrayBuffer()
  const imageBuffer = Buffer.from(arrayBuffer)
  if (imageBuffer.length === 0) {
    return corsJson({ ok: false, error: 'Downloaded image is empty' }, { status: 400 })
  }

  const storagePath = `bookmarklet-imports/${productId}/image.${extension}`
  const { error: uploadError } = await supabase.storage
    .from('products')
    .upload(storagePath, imageBuffer, {
      contentType: contentType ?? (extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg'),
      upsert: false,
    })

  if (uploadError) {
    return corsJson({ ok: false, error: 'Unable to upload image' }, { status: 500 })
  }

  const { data: publicUrlData } = supabase.storage.from('products').getPublicUrl(storagePath)
  const imageUrl = publicUrlData.publicUrl

  const insertPayload = {
    id: productId,
    name: titre,
    description: '',
    price: prixVente,
    image_url: imageUrl,
    category: 'Importé',
    moq: 1,
    stock_status: 'available',
    active: false,
    featured: false,
    origin: 'import' as const,
    local_stock: 0,
    city: null,
    delivery_delay: null,
    stock_updated_at: null,
    partner_id: null,
    import_base_price: prixChine,
    import_base_currency: devise,
    import_weight_kg: poidsKg,
    import_other_fees_fcfa: 0,
  }

  const { error: insertError } = await supabase.from('products').insert(insertPayload)
  if (insertError) {
    await supabase.storage.from('products').remove([storagePath])
    return corsJson({ ok: false, error: 'Unable to create product' }, { status: 500 })
  }

  const warnings: string[] = []

  const { error: imageInsertError } = await supabase.from('product_images').insert({
    product_id: productId,
    image_url: imageUrl,
    storage_path: storagePath,
    display_order: 0,
  })
  if (imageInsertError) {
    console.error('[import-produit] product_images insert failed', {
      productId,
      message: imageInsertError.message,
      details: imageInsertError.details,
      hint: imageInsertError.hint,
      code: imageInsertError.code,
    })
    warnings.push('product_images')
  }

  const { error: costError } = await supabase.from('product_costs').upsert({
    product_id: productId,
    purchase_price: prixChine,
    currency: devise,
    source_url: urlSource || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'product_id' })
  if (costError) {
    console.error('[import-produit] product_costs upsert failed', {
      productId,
      message: costError.message,
      details: costError.details,
      hint: costError.hint,
      code: costError.code,
    })
    warnings.push('product_costs')
  }

  if (warnings.length > 0) {
    return corsJson({
      ok: true,
      prix_vente: prixVente,
      warning: `Produit créé mais incomplet (${warnings.join(', ')}).`,
    })
  }

  return corsJson({ ok: true, prix_vente: prixVente })
}
