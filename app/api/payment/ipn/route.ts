import { createHmac, timingSafeEqual } from 'node:crypto'
import { createSupabaseAdminClient } from '../../../../lib/paytech-admin'

type PayTechNotification = {
  type_event?: string
  item_price?: string | number
  ref_command?: string
  token?: string
  hmac_compute?: string
}

function parseNotification(value: unknown): PayTechNotification | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null

  const fields = value as Record<string, unknown>
  const itemPrice = fields.item_price

  return {
    type_event: typeof fields.type_event === 'string' ? fields.type_event : undefined,
    item_price: typeof itemPrice === 'string' || typeof itemPrice === 'number' ? itemPrice : undefined,
    ref_command: typeof fields.ref_command === 'string' ? fields.ref_command : undefined,
    token: typeof fields.token === 'string' ? fields.token : undefined,
    hmac_compute: typeof fields.hmac_compute === 'string' ? fields.hmac_compute : undefined,
  }
}

async function readNotification(request: Request): Promise<PayTechNotification | null> {
  const contentType = (request.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase()

  if (contentType === 'application/json') {
    return parseNotification(await request.json())
  }

  if (contentType === 'application/x-www-form-urlencoded' || contentType === 'multipart/form-data') {
    const formData = await request.formData()
    const fields: Record<string, string> = {}

    for (const [key, value] of formData.entries()) {
      if (typeof value === 'string') fields[key] = value
    }

    return parseNotification(fields)
  }

  return null
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

function errorResponse(reason: string, message: string, status: number, context: Record<string, unknown> = {}) {
  console.error('[PayTech IPN] Error', { reason, ...context })
  return Response.json({ error: message }, { status })
}

export async function POST(request: Request) {
  const contentType = request.headers.get('content-type') ?? 'unknown'
  console.info('[PayTech IPN] Notification received', {
    method: request.method,
    contentType,
  })

  const apiKey = process.env.PAYTECH_API_KEY
  const apiSecret = process.env.PAYTECH_API_SECRET
  if (!apiKey || !apiSecret) {
    return errorResponse('missing_paytech_configuration', 'Configuration PayTech manquante.', 500)
  }

  let notification: PayTechNotification | null
  try {
    notification = await readNotification(request)
  } catch (error) {
    return errorResponse('invalid_request_body', 'Corps de notification invalide.', 400, {
      errorName: error instanceof Error ? error.name : 'unknown',
    })
  }
  if (!notification) {
    return errorResponse('unsupported_or_invalid_payload', 'Corps de notification invalide.', 400)
  }

  if (!isValidHmac(notification, apiKey, apiSecret)) {
    return errorResponse('invalid_signature', 'Signature IPN invalide.', 403, {
      refCommand: notification.ref_command ?? null,
      event: notification.type_event ?? null,
    })
  }
  console.info('[PayTech IPN] Signature verified', {
    refCommand: notification.ref_command,
    event: notification.type_event,
  })

  if (!['sale_complete', 'sale_canceled'].includes(notification.type_event ?? '')) {
    return errorResponse('unsupported_event', 'Événement PayTech non pris en charge.', 400, {
      event: notification.type_event ?? null,
    })
  }
  if (!notification.token) {
    return errorResponse('missing_payment_token', 'Token PayTech manquant.', 400, {
      refCommand: notification.ref_command ?? null,
    })
  }

  let supabase
  try {
    supabase = createSupabaseAdminClient()
  } catch (error) {
    return errorResponse(
      'supabase_admin_configuration',
      'Ajoutez SUPABASE_SERVICE_ROLE_KEY aux variables serveur Supabase.',
      500,
      { errorName: error instanceof Error ? error.name : 'unknown' },
    )
  }

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, status, total_price')
    .eq('paytech_ref_command', notification.ref_command)
    .eq('paytech_token', notification.token)
    .maybeSingle()

  if (orderError) {
    return errorResponse('order_lookup_failed', 'Impossible de retrouver la commande.', 500, {
      refCommand: notification.ref_command,
      databaseCode: orderError.code,
    })
  }
  if (!order) {
    return errorResponse('order_not_found', 'Commande ou token PayTech introuvable.', 404, {
      refCommand: notification.ref_command,
    })
  }
  console.info('[PayTech IPN] Order matched', { orderId: order.id, refCommand: notification.ref_command })

  const notifiedAmount = Number(notification.item_price)
  if (!Number.isFinite(notifiedAmount) || Math.abs(Number(order.total_price) - notifiedAmount) > 0.001) {
    return errorResponse('amount_mismatch', 'Le montant IPN ne correspond pas à la commande.', 400, {
      orderId: order.id,
    })
  }

  const isPaid = notification.type_event === 'sale_complete'
  const allowedStatuses = isPaid ? ['pending_payment', 'cancelled'] : ['pending_payment']
  const nextStatus = isPaid ? 'payé' : 'cancelled'

  if (isPaid) {
    const { data: confirmed, error: confirmError } = await supabase.rpc('confirm_paytech_product_order', {
      p_order_id: order.id,
    })

    if (confirmError) {
      return errorResponse('order_confirmation_failed', 'Impossible de confirmer la commande payée.', 409, {
        orderId: order.id,
        databaseCode: confirmError.code,
      })
    }
    if (!confirmed) {
      return errorResponse('order_confirmation_rejected', 'Impossible de confirmer la commande payée.', 409, {
        orderId: order.id,
      })
    }

    console.info('[PayTech IPN] Order marked paid', { orderId: order.id })
    return new Response('IPN OK', { status: 200 })
  }

  if (allowedStatuses.includes(order.status)) {
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({ status: nextStatus })
      .eq('id', order.id)
      .in('status', allowedStatuses)
      .select('id')
      .maybeSingle()

    if (updateError) {
      return errorResponse('order_update_failed', 'Impossible de mettre à jour le statut de la commande.', 500, {
        orderId: order.id,
        databaseCode: updateError.code,
      })
    }
    if (updatedOrder) {
      console.info('[PayTech IPN] Order status updated', { orderId: order.id, status: nextStatus })
    } else {
      console.info('[PayTech IPN] Order update skipped; status changed concurrently', { orderId: order.id })
    }
  }

  return new Response('IPN OK', { status: 200 })
}