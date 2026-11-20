import { timingSafeEqual } from 'node:crypto'
import { after } from 'next/server'
import { createSupabaseAdminClient } from '../../../../../lib/supabase-admin'
import { sendAutomaticOrderConfirmation } from '../../../../../lib/order-message-service'

type JsonRecord = Record<string, unknown>

type BictorysPayment = {
  id?: unknown
  paymentReference?: unknown
  status?: unknown
  amount?: unknown
  currency?: unknown
  pspName?: unknown
  merchantFees?: unknown
  settledAmount?: unknown
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parsePayment(value: unknown): BictorysPayment | null {
  if (!isRecord(value)) return null
  return {
    id: value.id,
    paymentReference: value.paymentReference,
    status: value.status,
    amount: value.amount,
    currency: value.currency,
    pspName: value.pspName,
    merchantFees: value.merchantFees,
    settledAmount: value.settledAmount,
  }
}

function matchesWebhookSecret(receivedSecret: string | null, expectedSecret: string) {
  if (receivedSecret === null) return false
  const received = Buffer.from(receivedSecret, 'utf8')
  const expected = Buffer.from(expectedSecret, 'utf8')
  return received.length === expected.length && timingSafeEqual(received, expected)
}

function parseAmount(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && value.trim() === '') return null
  const amount = Number(value)
  return Number.isFinite(amount) && amount >= 0 ? amount : null
}

function isOrderId(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function acknowledge() {
  return new Response('OK', { status: 200 })
}

function scheduleConfirmationEmail(orderId: string) {
  try {
    after(async () => {
      try {
        const result = await sendAutomaticOrderConfirmation(orderId)
        if (result.alreadyAttempted) {
          console.info('[Bictorys webhook] Automatic confirmation email already attempted', { orderId })
        }
      } catch (error) {
        console.error('[Bictorys webhook] Automatic confirmation email failed', {
          orderId,
          errorName: error instanceof Error ? error.name : 'unknown',
        })
      }
    })
  } catch (error) {
    console.error('[Bictorys webhook] Automatic confirmation email could not be scheduled', {
      orderId,
      errorName: error instanceof Error ? error.name : 'unknown',
    })
  }
}

export async function POST(request: Request) {
  const webhookSecret = process.env.BICTORYS_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('[Bictorys webhook] Signing secret is not configured')
    return new Response('Webhook configuration error', { status: 500 })
  }

  if (!matchesWebhookSecret(request.headers.get('X-Secret-Key'), webhookSecret)) {
    console.error('[Bictorys webhook] Request rejected', { reason: 'invalid_secret' })
    return new Response('Unauthorized', { status: 401 })
  }

  let payment: BictorysPayment | null
  try {
    payment = parsePayment(await request.json())
  } catch {
    console.error('[Bictorys webhook] Request rejected', { reason: 'invalid_json' })
    return new Response('Invalid JSON', { status: 400 })
  }

  if (!payment || typeof payment.status !== 'string') {
    console.error('[Bictorys webhook] Event ignored', { reason: 'invalid_payment_event' })
    return acknowledge()
  }
  if (payment.status.trim().toLowerCase() !== 'succeeded') {
    return acknowledge()
  }

  if (!isOrderId(payment.paymentReference)
    || typeof payment.id !== 'string'
    || !payment.id.trim()) {
    console.error('[Bictorys webhook] Successful event ignored', {
      reason: 'missing_or_invalid_payment_fields',
      hasPaymentReference: isOrderId(payment.paymentReference),
      hasChargeId: typeof payment.id === 'string' && Boolean(payment.id.trim()),
    })
    return acknowledge()
  }
  if (payment.currency !== 'XOF') {
    console.error('[Bictorys webhook] Successful event ignored', {
      reason: 'currency_mismatch',
      orderId: payment.paymentReference,
    })
    return acknowledge()
  }

  const amount = parseAmount(payment.amount)
  if (amount === null) {
    console.error('[Bictorys webhook] Successful event ignored', {
      reason: 'invalid_amount',
      orderId: payment.paymentReference,
    })
    return acknowledge()
  }

  let supabase
  try {
    supabase = createSupabaseAdminClient()
  } catch (error) {
    console.error('[Bictorys webhook] Database configuration unavailable', {
      errorName: error instanceof Error ? error.name : 'unknown',
    })
    return new Response('Webhook processing unavailable', { status: 500 })
  }

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, total_price, status, payment_reference, payment_method, merchant_fees, settled_amount')
    .eq('id', payment.paymentReference)
    .maybeSingle()

  if (orderError) {
    console.error('[Bictorys webhook] Order lookup failed', { databaseCode: orderError.code })
    return new Response('Webhook processing unavailable', { status: 500 })
  }
  if (!order) {
    console.error('[Bictorys webhook] Successful event ignored', { reason: 'order_not_found' })
    return acknowledge()
  }

  if (order.status === 'payé'
    || ['commandé_fournisseur', 'chez_transitaire', 'en_transit', 'arrivé', 'prête_a_retirer', 'récupéré'].includes(order.status)) {
    return acknowledge()
  }

  const expectedAmount = Number(order.total_price)
  if (!Number.isFinite(expectedAmount) || expectedAmount <= 0 || amount !== expectedAmount) {
    console.error('[Bictorys webhook] Payment amount mismatch; order not confirmed', {
      orderId: order.id,
      expectedAmount: Number.isFinite(expectedAmount) ? expectedAmount : null,
      receivedAmount: amount,
      currency: payment.currency,
    })
    return acknowledge()
  }

  let merchantFees = order.merchant_fees
  if (payment.merchantFees != null) {
    const parsedFees = parseAmount(payment.merchantFees)
    if (parsedFees === null) {
      console.error('[Bictorys webhook] Invalid merchant fees ignored', { orderId: order.id })
    } else {
      merchantFees = parsedFees
    }
  }

  let settledAmount = order.settled_amount
  if (payment.settledAmount != null) {
    const parsedSettledAmount = parseAmount(payment.settledAmount)
    if (parsedSettledAmount === null) {
      console.error('[Bictorys webhook] Invalid settled amount ignored', { orderId: order.id })
    } else {
      settledAmount = parsedSettledAmount
    }
  }
  const paymentMethod = typeof payment.pspName === 'string' && payment.pspName.trim()
    ? payment.pspName.trim()
    : order.payment_method

  const { data: updatedOrder, error: updateError } = await supabase
    .from('orders')
    .update({
      payment_provider: 'bictorys',
      payment_reference: payment.id.trim(),
      payment_method: paymentMethod,
      merchant_fees: merchantFees,
      settled_amount: settledAmount,
    })
    .eq('id', order.id)
    .in('status', ['pending_payment', 'cancelled'])
    .select('id')
    .maybeSingle()

  if (updateError) {
    console.error('[Bictorys webhook] Payment details update failed', { databaseCode: updateError.code })
    return new Response('Webhook processing unavailable', { status: 500 })
  }
  if (!updatedOrder) {
    return acknowledge()
  }

  const { data: confirmed, error: confirmError } = await supabase.rpc('confirm_product_order', {
    p_order_id: order.id,
  })
  if (confirmError) {
    console.error('[Bictorys webhook] Order confirmation failed', { databaseCode: confirmError.code })
    return new Response('Webhook processing unavailable', { status: 500 })
  }
  if (!confirmed) {
    console.error('[Bictorys webhook] Order confirmation was rejected', { orderId: order.id })
    return new Response('Webhook processing unavailable', { status: 500 })
  }

  scheduleConfirmationEmail(order.id)
  return acknowledge()
}
