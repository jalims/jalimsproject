import { NextResponse } from 'next/server'
import { authorizeJalimsAdminRequest } from '../../../../lib/admin-route-auth'
import { importOrderStatusOptions, localOrderStatusOptions } from '../../../../lib/order-tracking'
import { createSupabaseAdminClient } from '../../../../lib/paytech-admin'

const importStatuses = new Set<string>(importOrderStatusOptions.map(([status]) => status))
const localStatuses = new Set<string>(localOrderStatusOptions.map(([status]) => status))

export async function PATCH(request: Request) {
  const authorization = await authorizeJalimsAdminRequest(request, 'Admin order status')
  if ('response' in authorization) return authorization.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'La demande reçue est invalide.' }, { status: 400 })
  }

  if (
    typeof body !== 'object' || body === null || Array.isArray(body)
    || !('orderId' in body) || typeof body.orderId !== 'string'
    || !('status' in body) || typeof body.status !== 'string'
  ) {
    return NextResponse.json({ error: 'La demande reçue est invalide.' }, { status: 400 })
  }

  const { orderId, status } = body
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)) {
    return NextResponse.json({ error: 'La commande demandée est invalide.' }, { status: 400 })
  }

  try {
    const supabase = createSupabaseAdminClient()
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, origin')
      .eq('id', orderId)
      .maybeSingle()

    if (orderError) {
      console.error('[Admin order status] Order lookup failed', orderError.message)
      return NextResponse.json({ error: 'Le statut de la commande n’a pas pu être vérifié.' }, { status: 500 })
    }
    if (!order) return NextResponse.json({ error: 'Commande introuvable.' }, { status: 404 })

    const allowedStatuses = order.origin === 'local' ? localStatuses : importStatuses
    if (!allowedStatuses.has(status)) {
      return NextResponse.json({ error: 'Ce statut ne correspond pas au parcours de cette commande.' }, { status: 400 })
    }

    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({ status })
      .eq('id', orderId)
      .eq('origin', order.origin)
      .select('id')
      .maybeSingle()

    if (updateError) {
      console.error('[Admin order status] Status update failed', updateError.message)
      return NextResponse.json({ error: 'Le statut de la commande n’a pas pu être modifié.' }, { status: 500 })
    }
    if (!updatedOrder) return NextResponse.json({ error: 'La commande a changé. Rechargez la page puis réessayez.' }, { status: 409 })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Admin order status] Request failed', error instanceof Error ? error.message : 'Unknown error')
    return NextResponse.json({ error: 'Le statut de la commande n’a pas pu être modifié.' }, { status: 500 })
  }
}
