import { createHmac, timingSafeEqual } from 'node:crypto'
import { createSupabaseAdminClient } from '../../../../lib/paytech-admin'

type PayTechNotification = {
  type_event?: string
  item_price?: string | number
  ref_command?: string
  token?: string
  hmac_compute?: string
}

async function readNotification(request: Request): Promise<PayTechNotification | null> {
  const rawBody = await request.text()
  const contentType = request.headers.get('content-type') ?? ''

  try {
    if (contentType.includes('application/json')) {
      return JSON.parse(rawBody) as PayTechNotification
    }

    const params = new URLSearchParams(rawBody)
    return Object.fromEntries(params.entries()) as PayTechNotification
  } catch {
    return null
  }
}

function isValidHmac(notification: PayTechNotification, apiKey: string, apiSecret: string) {
  if (notification.item_price === undefined || !notification.ref_command || !notification.hmac_compute) {
    return false
  }

  const expected = createHmac('sha256', apiSecret)
    .update(`${notification.item_price}|${notification.ref_command}|${apiKey}`)
    .digest()
  if (!/^[a-f\d]{64}$/i.test(notification.hmac_compute)) return false

  const received = Buffer.from(notification.hmac_compute, 'hex')
  return received.length === expected.length && timingSafeEqual(received, expected)
}

export async function POST(request: Request) {
  const apiKey = process.env.PAYTECH_API_KEY
  const apiSecret = process.env.PAYTECH_API_SECRET
  if (!apiKey || !apiSecret) {
    return Response.json({ error: 'Configuration PayTech manquante.' }, { status: 500 })
  }

  const notification = await readNotification(request)
  if (!notification || !isValidHmac(notification, apiKey, apiSecret)) {
    return Response.json({ error: 'Signature IPN invalide.' }, { status: 403 })
  }

  if (!['sale_complete', 'sale_canceled'].includes(notification.type_event ?? '')) {
    return Response.json({ error: 'Événement PayTech non pris en charge.' }, { status: 400 })
  }
  if (!notification.token) {
    return Response.json({ error: 'Token PayTech manquant.' }, { status: 400 })
  }

  let supabase
  try {
    supabase = createSupabaseAdminClient()
  } catch {
    return Response.json({ error: 'Ajoutez SUPABASE_SERVICE_ROLE_KEY aux variables serveur Supabase.' }, { status: 500 })
  }

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, status, total_price')
    .eq('jalims_code', notification.ref_command)
    .eq('paytech_token', notification.token)
    .maybeSingle()

  if (orderError) {
    return Response.json({ error: 'Impossible de retrouver la commande.' }, { status: 500 })
  }
  if (!order) {
    return Response.json({ error: 'Commande ou token PayTech introuvable.' }, { status: 404 })
  }

  const notifiedAmount = Number(notification.item_price)
  if (!Number.isFinite(notifiedAmount) || Math.abs(Number(order.total_price) - notifiedAmount) > 0.001) {
    return Response.json({ error: 'Le montant IPN ne correspond pas à la commande.' }, { status: 400 })
  }

  const isPaid = notification.type_event === 'sale_complete'
  const allowedStatuses = isPaid ? ['pending_payment', 'cancelled'] : ['pending_payment']
  const nextStatus = isPaid ? 'payé' : 'cancelled'

  if (allowedStatuses.includes(order.status)) {
    const { error: updateError } = await supabase
      .from('orders')
      .update({ status: nextStatus })
      .eq('id', order.id)
      .in('status', allowedStatuses)

    if (updateError) {
      return Response.json({ error: 'Impossible de mettre à jour le statut de la commande.' }, { status: 500 })
    }
  }

  return new Response('IPN OK', { status: 200 })
}