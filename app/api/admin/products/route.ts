import { NextResponse } from 'next/server'
import { authorizeJalimsAdminRequest } from '../../../../lib/admin-route-auth'
import { createSupabaseAdminClient } from '../../../../lib/paytech-admin'

type ProductInput = {
  name: string
  description: string
  price: number
  delivery_estimate: string | null
  image_url: string | null
  category: string | null
  moq: number
  stock_status: string
  featured: boolean
  active: boolean
  origin: 'local' | 'import'
  local_stock: number
  city: string | null
  delivery_delay: string | null
  partner_id: string | null
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const stockStatuses = new Set(['available', 'preorder', 'out_of_stock'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNullableText(value: unknown, maximumLength: number): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= maximumLength)
}

function validateProduct(value: unknown): ProductInput | null {
  if (!isRecord(value)) return null

  const {
    name,
    description,
    price,
    delivery_estimate,
    image_url,
    category,
    moq,
    stock_status,
    featured,
    active,
    origin,
    local_stock,
    city,
    delivery_delay,
    partner_id,
  } = value

  if (
    typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 120
    || typeof description !== 'string' || description.length > 3000
    || typeof price !== 'number' || !Number.isFinite(price) || price <= 0
    || !isNullableText(delivery_estimate, 100)
    || !isNullableText(image_url, 2048)
    || (image_url !== null && !/^https?:\/\//i.test(image_url))
    || !isNullableText(category, 100)
    || typeof moq !== 'number' || !Number.isInteger(moq) || moq < 1
    || typeof stock_status !== 'string' || !stockStatuses.has(stock_status)
    || typeof featured !== 'boolean'
    || typeof active !== 'boolean'
    || (origin !== 'local' && origin !== 'import')
  ) {
    return null
  }

  if (origin === 'local') {
    if (
      typeof local_stock !== 'number' || !Number.isInteger(local_stock) || local_stock <= 0
      || typeof city !== 'string' || city.trim().length === 0 || city.trim().length > 100
      || typeof delivery_delay !== 'string' || delivery_delay.trim().length === 0 || delivery_delay.trim().length > 100
      || typeof partner_id !== 'string' || !uuidPattern.test(partner_id)
    ) {
      return null
    }

    return {
      name: name.trim(),
      description,
      price,
      delivery_estimate,
      image_url,
      category,
      moq,
      stock_status,
      featured,
      active,
      origin,
      local_stock,
      city: city.trim(),
      delivery_delay: delivery_delay.trim(),
      partner_id,
    }
  }

  return {
    name: name.trim(),
    description,
    price,
    delivery_estimate,
    image_url,
    category,
    moq,
    stock_status,
    featured,
    active,
    origin,
    local_stock: 0,
    city: null,
    delivery_delay: null,
    partner_id: null,
  }
}

async function validateActivePartner(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  product: ProductInput,
) {
  if (!product.partner_id) return { valid: true, failed: false }

  const { data, error } = await supabase
    .from('partners')
    .select('id, active')
    .eq('id', product.partner_id)
    .maybeSingle()
  if (error) {
    console.error('[Admin products] Partner lookup failed', error.message)
    return { valid: false, failed: true }
  }
  return { valid: data?.active === true, failed: false }
}

async function readJson(request: Request) {
  try {
    return await request.json() as unknown
  } catch {
    return null
  }
}

function getId(value: unknown) {
  return typeof value === 'string' && uuidPattern.test(value) ? value : null
}

export async function POST(request: Request) {
  const authorization = await authorizeJalimsAdminRequest(request, 'Admin products')
  if ('response' in authorization) return authorization.response

  const body = await readJson(request)
  if (!isRecord(body)) return NextResponse.json({ error: 'Les informations du produit sont invalides.' }, { status: 400 })
  const id = getId(body.id)
  const product = validateProduct(body.product)
  if (!id || !product) return NextResponse.json({ error: 'Vérifiez les informations du produit, son origine et son partenaire.' }, { status: 400 })

  try {
    const supabase = createSupabaseAdminClient()
    const partnerValidation = await validateActivePartner(supabase, product)
    if (partnerValidation.failed) {
      return NextResponse.json({ error: 'Impossible de vérifier le partenaire sélectionné.' }, { status: 500 })
    }
    if (!partnerValidation.valid) {
      return NextResponse.json({ error: 'Choisissez un partenaire actif pour ce produit local.' }, { status: 400 })
    }
    const { error } = await supabase.from('products').insert({
      id,
      ...product,
      active: false,
      stock_updated_at: product.origin === 'local' ? new Date().toISOString() : null,
    })

    if (error) {
      console.error('[Admin products] Create failed', error.message)
      return NextResponse.json({ error: 'Le produit n’a pas pu être créé.' }, { status: 500 })
    }

    return NextResponse.json({ id }, { status: 201 })
  } catch (error) {
    console.error('[Admin products] Create failed', error instanceof Error ? error.message : 'Unknown error')
    return NextResponse.json({ error: 'Le produit n’a pas pu être créé.' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  const authorization = await authorizeJalimsAdminRequest(request, 'Admin products')
  if ('response' in authorization) return authorization.response

  const body = await readJson(request)
  if (!isRecord(body)) return NextResponse.json({ error: 'Les informations du produit sont invalides.' }, { status: 400 })
  const id = getId(body.id)
  const product = validateProduct(body.product)
  if (!id || !product) return NextResponse.json({ error: 'Vérifiez les informations du produit, son origine et son partenaire.' }, { status: 400 })

  try {
    const supabase = createSupabaseAdminClient()
    const partnerValidation = await validateActivePartner(supabase, product)
    if (partnerValidation.failed) {
      return NextResponse.json({ error: 'Impossible de vérifier le partenaire sélectionné.' }, { status: 500 })
    }
    if (!partnerValidation.valid) {
      return NextResponse.json({ error: 'Choisissez un partenaire actif pour ce produit local.' }, { status: 400 })
    }
    const { data, error } = await supabase
      .from('products')
      .update({
        ...product,
        stock_updated_at: product.origin === 'local' ? new Date().toISOString() : null,
      })
      .eq('id', id)
      .select('id')
      .maybeSingle()

    if (error) {
      console.error('[Admin products] Update failed', error.message)
      return NextResponse.json({ error: 'Le produit n’a pas pu être modifié.' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'Ce produit n’existe plus.' }, { status: 404 })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Admin products] Update failed', error instanceof Error ? error.message : 'Unknown error')
    return NextResponse.json({ error: 'Le produit n’a pas pu être modifié.' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const authorization = await authorizeJalimsAdminRequest(request, 'Admin products')
  if ('response' in authorization) return authorization.response

  const body = await readJson(request)
  if (!isRecord(body)) return NextResponse.json({ error: 'La demande reçue est invalide.' }, { status: 400 })
  const id = getId(body.id)
  if (!id) return NextResponse.json({ error: 'Le produit demandé est invalide.' }, { status: 400 })

  let update: Record<string, unknown>
  if (body.action === 'confirm-stock') {
    if (typeof body.localStock !== 'number' || !Number.isInteger(body.localStock) || body.localStock <= 0) {
      return NextResponse.json({ error: 'La quantité en stock doit être un entier supérieur à zéro.' }, { status: 400 })
    }
    update = { local_stock: body.localStock, stock_updated_at: new Date().toISOString() }
  } else if (body.action === 'set-active' && typeof body.active === 'boolean') {
    update = { active: body.active }
  } else {
    return NextResponse.json({ error: 'La demande reçue est invalide.' }, { status: 400 })
  }

  try {
    const supabase = createSupabaseAdminClient()
    let query = supabase.from('products').update(update).eq('id', id)
    if (body.action === 'confirm-stock') query = query.eq('origin', 'local')
    const { data, error } = await query.select('id').maybeSingle()

    if (error) {
      console.error('[Admin products] Product status update failed', error.message)
      return NextResponse.json({ error: 'La modification du produit n’a pas pu être enregistrée.' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'Ce produit local n’existe plus.' }, { status: 404 })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Admin products] Product status update failed', error instanceof Error ? error.message : 'Unknown error')
    return NextResponse.json({ error: 'La modification du produit n’a pas pu être enregistrée.' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const authorization = await authorizeJalimsAdminRequest(request, 'Admin products')
  if ('response' in authorization) return authorization.response

  const body = await readJson(request)
  const id = isRecord(body) ? getId(body.id) : null
  if (!id) return NextResponse.json({ error: 'Le produit demandé est invalide.' }, { status: 400 })

  try {
    const supabase = createSupabaseAdminClient()
    const { error } = await supabase.from('products').delete().eq('id', id)
    if (error) {
      console.error('[Admin products] Delete failed', error.message)
      return NextResponse.json({ error: 'Le produit temporaire n’a pas pu être supprimé.' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Admin products] Delete failed', error instanceof Error ? error.message : 'Unknown error')
    return NextResponse.json({ error: 'Le produit temporaire n’a pas pu être supprimé.' }, { status: 500 })
  }
}
