import { NextResponse } from 'next/server'
import { authorizeJalimsAdminRequest } from '../../../../lib/admin-route-auth'
import { createSupabaseAdminClient } from '../../../../lib/paytech-admin'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const internationalPhonePattern = /^[1-9][0-9]{7,14}$/

type PartnerInput = {
  name: string
  whatsapp_phone: string
  city: string
  active: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validatePartner(value: unknown, includeActive: boolean): PartnerInput | null {
  if (!isRecord(value)) return null
  const { name, whatsapp_phone, city, active } = value
  if (
    typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 120
    || typeof whatsapp_phone !== 'string' || !internationalPhonePattern.test(whatsapp_phone)
    || typeof city !== 'string' || city.trim().length === 0 || city.trim().length > 100
    || (includeActive && typeof active !== 'boolean')
  ) {
    return null
  }
  return {
    name: name.trim(),
    whatsapp_phone,
    city: city.trim(),
    active: includeActive ? active as boolean : true,
  }
}

export async function GET(request: Request) {
  const authorization = await authorizeJalimsAdminRequest(request, 'Admin partners')
  if ('response' in authorization) return authorization.response

  try {
    const supabase = createSupabaseAdminClient()
    const { data, error } = await supabase
      .from('partners')
      .select('id, name, whatsapp_phone, city, active, created_at')
      .order('name')
    if (error) {
      console.error('[Admin partners] List failed', error.message)
      return NextResponse.json({ error: 'Impossible de charger les partenaires.' }, { status: 500 })
    }
    return NextResponse.json({ partners: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[Admin partners] List failed', error)
    return NextResponse.json({ error: 'Impossible de charger les partenaires.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const authorization = await authorizeJalimsAdminRequest(request, 'Admin partners')
  if ('response' in authorization) return authorization.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Les informations du partenaire sont illisibles.' }, { status: 400 })
  }
  if (!isRecord(body)) return NextResponse.json({ error: 'Les informations du partenaire sont invalides.' }, { status: 400 })

  const partner = validatePartner(body, false)
  if (!partner) {
    return NextResponse.json({
      error: 'Indiquez un nom, une ville et un numéro WhatsApp international valide composé uniquement de chiffres (8 à 15 chiffres).',
    }, { status: 400 })
  }

  try {
    const supabase = createSupabaseAdminClient()
    const { data, error } = await supabase
      .from('partners')
      .insert(partner)
      .select('id, name, whatsapp_phone, city, active, created_at')
      .single()
    if (error) {
      console.error('[Admin partners] Create failed', error.message)
      return NextResponse.json({ error: 'Le partenaire n’a pas pu être ajouté.' }, { status: 500 })
    }
    return NextResponse.json({ partner: data }, { status: 201 })
  } catch (error) {
    console.error('[Admin partners] Create failed', error)
    return NextResponse.json({ error: 'Le partenaire n’a pas pu être ajouté.' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const authorization = await authorizeJalimsAdminRequest(request, 'Admin partners')
  if ('response' in authorization) return authorization.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'La modification du partenaire est illisible.' }, { status: 400 })
  }
  if (!isRecord(body) || typeof body.id !== 'string' || !uuidPattern.test(body.id)) {
    return NextResponse.json({ error: 'Le partenaire demandé est invalide.' }, { status: 400 })
  }

  const partner = validatePartner(body, true)
  if (!partner) {
    return NextResponse.json({
      error: 'Vérifiez le nom, la ville, le numéro WhatsApp international (chiffres uniquement) et l’état du partenaire.',
    }, { status: 400 })
  }

  try {
    const supabase = createSupabaseAdminClient()
    const { data, error } = await supabase
      .from('partners')
      .update(partner)
      .eq('id', body.id)
      .select('id, name, whatsapp_phone, city, active, created_at')
      .maybeSingle()
    if (error) {
      console.error('[Admin partners] Update failed', error.message)
      return NextResponse.json({ error: 'Le partenaire n’a pas pu être modifié.' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'Ce partenaire n’existe plus.' }, { status: 404 })
    return NextResponse.json({ partner: data })
  } catch (error) {
    console.error('[Admin partners] Update failed', error)
    return NextResponse.json({ error: 'Le partenaire n’a pas pu être modifié.' }, { status: 500 })
  }
}
