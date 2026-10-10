import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { hasJalimsAdminAccess } from '../../../../lib/admin-access'
import { createSupabaseAdminClient } from '../../../../lib/paytech-admin'

const allowedImageExtension = /\.(jpe?g|png|webp)$/i
const allowedSku = /^[A-Z0-9][A-Z0-9._-]{0,63}$/
const anthropicModel = 'claude-haiku-4-5-20251001'

type ImportInput = {
  sku: string
  supplierUrl: string
  sourceName: string
  purchasePriceCny: number
  chinaShippingCny: number
  weightKg: number
  colors: string[]
  sizes: string[]
  marginPercent: number
  moq: number
  deliveryEstimate: string
  category: string
}

type GeneratedText = {
  name: string
  description: string
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function getDatabaseErrorMessage(error: { code?: string; message?: string; details?: string }) {
  const text = `${error.code ?? ''} ${error.message ?? ''} ${error.details ?? ''}`.toLowerCase()
  const messages: [string, string][] = [
    ['imported_product_requires_three_photos', 'Un produit importé doit avoir au moins trois photos pour être publié.'],
    ['product_import_exchange_rate_not_configured', 'Le taux de change CNY/FCFA n’est pas configuré.'],
    ['product_has_pending_variant_reservations', 'Ce produit a des commandes en cours. Ses variantes ne peuvent pas être modifiées pour le moment.'],
    ['product_color_attribute_unavailable', 'L’option de couleur n’est pas disponible dans les réglages du catalogue.'],
    ['product_size_attribute_unavailable', 'L’option de taille n’est pas disponible dans les réglages du catalogue.'],
    ['invalid_calculated_sale_price', 'Le prix de vente calculé est invalide. Vérifiez le prix d’achat, le poids et la marge.'],
    ['invalid_product_import_number', 'Un nombre fourni est invalide. Vérifiez les prix, le poids et la marge.'],
    ['invalid_product_import_data', 'Les informations du produit sont incomplètes ou invalides.'],
    ['invalid_product_import_images', 'Aucune photo valide n’a été fournie.'],
    ['invalid_product_import_image', 'Le nom ou le format d’une photo n’est pas accepté.'],
    ['product_import_record_not_found', 'Aucun produit importé ne correspond à ce SKU. Importez d’abord sa ligne Excel.'],
  ]
  return messages.find(([code]) => text.includes(code))?.[1]
    ?? 'La base de données a refusé cette opération. Vérifiez les informations puis réessayez.'
}

async function authorize(request: Request) {
  const authorization = request.headers.get('authorization')
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!accessToken) return { response: jsonError('Connectez-vous avec le compte administrateur pour continuer.', 401) }
  if (!supabaseUrl || !anonKey) {
    console.error('[Product import] Supabase public environment is not configured')
    return { response: jsonError('Le service d’import n’est pas configuré correctement.', 500) }
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await authClient.auth.getUser(accessToken)

  if (error) {
    console.error('[Product import] Admin authentication failed', error.message)
    return { response: jsonError('Votre session n’a pas pu être vérifiée. Reconnectez-vous puis réessayez.', 401) }
  }
  if (!hasJalimsAdminAccess(data.user)) {
    return { response: jsonError('Ce compte ne dispose pas des droits administrateur.', 403) }
  }

  return { user: data.user }
}

function isValidImportInput(value: unknown): value is ImportInput {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  const numberFields = ['purchasePriceCny', 'chinaShippingCny', 'weightKg', 'marginPercent', 'moq']
  return typeof row.sku === 'string'
    && allowedSku.test(row.sku)
    && !row.sku.includes('..')
    && typeof row.supplierUrl === 'string'
    && typeof row.sourceName === 'string'
    && row.sourceName.trim() !== ''
    && numberFields.every((field) => typeof row[field] === 'number' && Number.isFinite(row[field]))
    && Number(row.purchasePriceCny) > 0
    && Number(row.chinaShippingCny) >= 0
    && Number(row.weightKg) > 0
    && Number(row.marginPercent) >= 0
    && Number.isInteger(row.moq)
    && Number(row.moq) >= 1
    && Array.isArray(row.colors)
    && row.colors.every((item) => typeof item === 'string')
    && Array.isArray(row.sizes)
    && row.sizes.every((item) => typeof item === 'string')
    && Math.max(row.colors.length, 1) * Math.max(row.sizes.length, 1) <= 250
    && typeof row.deliveryEstimate === 'string'
    && row.deliveryEstimate.trim() !== ''
    && typeof row.category === 'string'
    && row.category.trim() !== ''
}

async function generateFrenchText(sourceName: string, category: string): Promise<GeneratedText> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('anthropic_key_missing')

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      model: anthropicModel,
      max_tokens: 900,
      messages: [{
        role: 'user',
        content: `Rédige en français pour la boutique sénégalaise Jalims un titre court et une description produit honnête à partir de ces informations. N’invente aucune caractéristique absente. Réponds uniquement avec un objet JSON de la forme {"name":"...","description":"..."}. Nom source : ${sourceName}\nCatégorie : ${category}`,
      }],
    }),
  })

  if (!response.ok) {
    console.error('[Product import] Anthropic request failed', response.status)
    throw new Error(`anthropic_http_${response.status}`)
  }

  const result = await response.json() as {
    content?: { type?: string; text?: string }[]
  }
  const text = result.content?.find((item) => item.type === 'text')?.text?.trim()
  if (!text) throw new Error('anthropic_empty_response')

  const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch (error) {
    console.error('[Product import] Anthropic returned invalid JSON', error)
    throw new Error('anthropic_invalid_response')
  }

  if (typeof parsed !== 'object' || parsed === null) throw new Error('anthropic_invalid_response')
  const generated = parsed as Record<string, unknown>
  if (
    typeof generated.name !== 'string' || !generated.name.trim()
    || typeof generated.description !== 'string' || !generated.description.trim()
  ) {
    throw new Error('anthropic_invalid_response')
  }

  return { name: generated.name.trim(), description: generated.description.trim() }
}

async function importProduct(body: Record<string, unknown>) {
  const row = body.row
  const testMode = body.testMode === true
  const submittedSku = typeof row === 'object' && row !== null ? Reflect.get(row, 'sku') : undefined
  if (
    testMode
    && typeof submittedSku === 'string'
    && !submittedSku.trim().toUpperCase().startsWith('TEST')
  ) {
    return jsonError('Le mode test écrit dans la vraie base et n’accepte que les SKU commençant par « TEST ».', 400)
  }
  if (!isValidImportInput(row)) return jsonError('Les données de cette ligne sont invalides.', 400)

  const sku = row.sku.trim().toUpperCase()

  if (!testMode && !process.env.ANTHROPIC_API_KEY) {
    return jsonError('La clé ANTHROPIC_API_KEY n’est pas configurée. Activez le mode test pour importer sans IA; seuls les SKU commençant par « TEST » seront acceptés.', 503)
  }

  const generated = testMode
    ? { name: `[À rédiger] ${row.sourceName.trim()}`, description: `[À rédiger] ${row.sourceName.trim()}` }
    : await generateFrenchText(row.sourceName.trim(), row.category.trim())

  let serviceClient: ReturnType<typeof createSupabaseAdminClient>
  try {
    serviceClient = createSupabaseAdminClient()
  } catch (error) {
    console.error('[Product import] Service Supabase configuration failed', error)
    return jsonError('Le service sécurisé de base de données n’est pas configuré.', 500)
  }

  const { data, error } = await serviceClient.rpc('import_product_from_source', {
    p_sku: sku,
    p_supplier_url: row.supplierUrl.trim(),
    p_source_name: row.sourceName.trim(),
    p_purchase_price_cny: row.purchasePriceCny,
    p_china_shipping_cny: row.chinaShippingCny,
    p_weight_kg: row.weightKg,
    p_margin_percent: row.marginPercent,
    p_moq: row.moq,
    p_delivery_estimate: row.deliveryEstimate.trim(),
    p_category: row.category.trim(),
    p_name_fr: generated.name,
    p_description_fr: generated.description,
    p_colors: row.colors,
    p_sizes: row.sizes,
    p_overwrite_text: body.overwriteText === true,
  })

  if (error) {
    console.error('[Product import] Database import failed', { code: error.code, message: error.message })
    return jsonError(getDatabaseErrorMessage(error), 400)
  }

  const result = Array.isArray(data) ? data[0] as {
    imported_product_id: string
    created: boolean
    sale_price_fcfa: number
    remains_published: boolean
  } | undefined : undefined

  if (!result?.imported_product_id) {
    console.error('[Product import] Database returned no imported product')
    return jsonError('La base n’a retourné aucun produit importé.', 500)
  }

  return NextResponse.json({
    productId: result.imported_product_id,
    created: result.created,
    salePriceFcfa: Number(result.sale_price_fcfa),
    published: result.remains_published,
  })
}

async function registerImages(body: Record<string, unknown>) {
  const sku = typeof body.sku === 'string' ? body.sku.trim().toUpperCase() : ''
  const filenames = body.filenames
  if (body.testMode === true && !sku.startsWith('TEST')) {
    return jsonError('Le mode test écrit dans la vraie base et n’accepte que les SKU commençant par « TEST ».', 400)
  }
  if (
    !allowedSku.test(sku)
    || sku.includes('..')
    || !Array.isArray(filenames)
    || filenames.length === 0
    || filenames.some((filename) => (
      typeof filename !== 'string'
      || filename.trim() !== filename
      || filename === '.'
      || filename === '..'
      || filename.includes('/')
      || filename.includes('\\')
      || filename.includes('..')
      || !allowedImageExtension.test(filename)
    ))
  ) {
    return jsonError('Le SKU ou la liste de photos est invalide. Utilisez uniquement des fichiers JPG, PNG ou WebP.', 400)
  }

  let serviceClient: ReturnType<typeof createSupabaseAdminClient>
  try {
    serviceClient = createSupabaseAdminClient()
  } catch (error) {
    console.error('[Product import] Service Supabase configuration failed', error)
    return jsonError('Le service sécurisé de base de données n’est pas configuré.', 500)
  }

  const { data: productCost, error: lookupError } = await serviceClient
    .from('product_costs')
    .select('product_id, sku')
    .ilike('sku', sku)
    .maybeSingle()

  if (lookupError) {
    console.error('[Product import] Product lookup failed', { code: lookupError.code, message: lookupError.message })
    return jsonError('La base n’a pas pu retrouver ce SKU.', 400)
  }
  if (!productCost) return jsonError('Aucun produit importé ne correspond à ce SKU. Importez d’abord sa ligne Excel.', 404)

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) {
    console.error('[Product import] Supabase URL is not configured')
    return jsonError('Le service de stockage des photos n’est pas configuré.', 500)
  }

  const images = [...new Set(filenames as string[])].map((filename) => ({
    filename,
    image_url: `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/products/${encodeURIComponent(productCost.sku)}/${encodeURIComponent(filename)}`,
  }))
  const { data, error } = await serviceClient.rpc('register_imported_product_images', {
    p_product_id: productCost.product_id,
    p_images: images,
  })

  if (error) {
    console.error('[Product import] Image registration failed', { code: error.code, message: error.message })
    return jsonError(getDatabaseErrorMessage(error), 400)
  }

  const result = Array.isArray(data) ? data[0] as { photo_count: number; published: boolean } | undefined : undefined
  if (!result) {
    console.error('[Product import] Database returned no image registration result')
    return jsonError('La base n’a pas confirmé l’enregistrement des photos.', 500)
  }

  return NextResponse.json({ photoCount: result.photo_count, published: result.published })
}

export async function GET(request: Request) {
  const auth = await authorize(request)
  if ('response' in auth) return auth.response

  return NextResponse.json({ anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY) })
}

export async function POST(request: Request) {
  const auth = await authorize(request)
  if ('response' in auth) return auth.response

  let body: unknown
  try {
    body = await request.json()
  } catch (error) {
    console.error('[Product import] Invalid JSON request body', error)
    return jsonError('La requête d’import est illisible.', 400)
  }
  if (typeof body !== 'object' || body === null) return jsonError('La requête d’import est invalide.', 400)

  const payload = body as Record<string, unknown>
  try {
    if (payload.action === 'import') return await importProduct(payload)
    if (payload.action === 'register-images') return await registerImages(payload)
    return jsonError('Cette opération d’import n’est pas reconnue.', 400)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    console.error('[Product import] Request failed', error)
    if (message === 'anthropic_key_missing') {
      return jsonError('La clé ANTHROPIC_API_KEY n’est pas configurée. Activez le mode test pour importer sans IA.', 503)
    }
    if (message.startsWith('anthropic_http_')) {
      return jsonError('Le service de rédaction IA est momentanément indisponible. Réessayez ou activez le mode test.', 502)
    }
    if (message.startsWith('anthropic_')) {
      return jsonError('Le service IA n’a pas produit un texte français exploitable. Réessayez ou activez le mode test.', 502)
    }
    return jsonError('Une erreur inattendue a interrompu cette opération. Les autres produits peuvent être importés séparément.', 500)
  }
}
