import { NextResponse } from 'next/server'
import { loadAdminOrderDeliveryDetails } from '../../../../lib/admin-order-delivery-details'
import { authorizeJalimsAdminRequest } from '../../../../lib/admin-route-auth'
import { createSupabaseAdminClient } from '../../../../lib/paytech-admin'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(request: Request) {
  const authorization = await authorizeJalimsAdminRequest(request, 'Admin order delivery details')
  if ('response' in authorization) return authorization.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'La demande de détails de livraison est illisible.' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: 'La demande de détails de livraison est invalide.' }, { status: 400 })
  }

  const orderIds = (body as Record<string, unknown>).orderIds
  if (
    !Array.isArray(orderIds)
    || orderIds.length > 1000
    || !orderIds.every((id) => typeof id === 'string' && uuidPattern.test(id))
  ) {
    return NextResponse.json({ error: 'La liste des commandes est invalide.' }, { status: 400 })
  }

  try {
    const supabase = createSupabaseAdminClient()
    const result = await loadAdminOrderDeliveryDetails(supabase, orderIds)
    if (result.error) {
      console.error('[Admin order delivery details] Lookup failed', result.error.message)
      return NextResponse.json({ error: 'Impossible de charger les coordonnées de livraison.' }, { status: 500 })
    }
    return NextResponse.json({ details: result.details }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[Admin order delivery details] Lookup failed', error)
    return NextResponse.json({ error: 'Impossible de charger les détails de livraison.' }, { status: 500 })
  }
}
