import { createHmac, timingSafeEqual } from 'node:crypto'
import { after } from 'next/server'
import { createSupabaseAdminClient } from '../../../../../lib/paytech-admin'
import { sendAutomaticOrderConfirmation } from '../../../../../lib/order-message-service'
import { getIntegerXofAmount } from '../../../../../lib/payments/wave'

const orderIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const maximumSignatureAgeSeconds = 5 * 60
const maximumRequestProcessingMs = 4000

type WaveSignature = {
  timestamp: string
  signatures: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function webhookError(reason: string, status: number) {
  console.error('[Wave webhook] Request rejected', { reason })
  return new Response('Invalid webhook request', { status })
}

function parseWaveSignature(header: string | null): WaveSignature | null {
  if (!header) return null

  let timestamp: string | null = null
  const signatures: string[] = []
  for (const rawPart of header.split(',')) {
    const part = rawPart.trim()
    const separator = part.indexOf('=')
    if (separator <= 0) return null

    const key = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (key === 't') {
      if (timestamp !== null || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) return null
      timestamp = value
    } else if (key === 'v1') {
      signatures.push(value)
    } else {
      return null
    }
  }

  if (timestamp === null || signatures.length === 0) return null
  return { timestamp, signatures }
}

function verifyWaveSignature(header: string | null, rawBody: string, secret: string) {
  const parsed = parseWaveSignature(header)
  if (!parsed) return { valid: false, reason: 'invalid_signature_header' }

  const timestamp = Number(parsed.timestamp)
  const currentTimestamp = Math.floor(Date.now() / 1000)
  if (Math.abs(currentTimestamp - timestamp) > maximumSignatureAgeSeconds) {
    return { valid: false, reason: 'stale_signature_timestamp' }
  }

  const expected = createHmac('sha256', secret)
    .update(`${parsed.timestamp}${rawBody}`)
    .digest()
  let valid = false
  for (const signature of parsed.signatures) {
    if (!/^[a-f\d]{64}$/i.test(signature)) continue
    const received = Buffer.from(signature, 'hex')
    if (received.length !== expected.length) continue
    const matches = timingSafeEqual(received, expected)
    if (matches) valid = true
  }

  return valid
    ? { valid: true, reason: 'valid_signature' }
    : { valid: false, reason: 'invalid_signature' }
}

function parseIntegerXofAmount(value: unknown) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  const amount = Number(value)
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null
}

function acknowledge() {
  return new Response('OK', { status: 200 })
}

export async function POST(request: Request) {
  const processingDeadline = Date.now() + maximumRequestProcessingMs
  let rawBody: string
  try {
    rawBody = await request.text()
  } catch {
    return webhookError('body_read_failed', 400)
  }

  const secret = process.env.WAVE_WEBHOOK_SECRET
  if (!secret) {
    console.error('[Wave webhook] Signing secret is not configured')
    return new Response('Webhook configuration error', { status: 500 })
  }

  const signature = verifyWaveSignature(request.headers.get('Wave-Signature'), rawBody, secret)
  if (!signature.valid) return webhookError(signature.reason, 401)

  let event: unknown
  try {
    event = JSON.parse(rawBody)
  } catch {
    return webhookError('invalid_json', 400)
  }
  if (!isRecord(event) || event.type !== 'checkout.session.completed') {
    return acknowledge()
  }

  if (!isRecord(event.data)) {
    console.error('[Wave webhook] Completed event ignored', { reason: 'invalid_event_data' })
    return acknowledge()
  }

  const data = event.data
  if (data.checkout_status !== 'complete'
    || data.payment_status !== 'succeeded'
    || data.currency !== 'XOF') {
    console.info('[Wave webhook] Completed event ignored', { reason: 'payment_status_mismatch' })
    return acknowledge()
  }

  if (typeof data.client_reference !== 'string' || !orderIdPattern.test(data.client_reference)) {
    console.error('[Wave webhook] Completed event ignored', { reason: 'invalid_client_reference' })
    return acknowledge()
  }

  let supabase
  try {
    supabase = createSupabaseAdminClient()
  } catch (error) {
    console.error('[Wave webhook] Database configuration unavailable', {
      errorName: error instanceof Error ? error.name : 'unknown',
    })
    return new Response('Webhook processing unavailable', { status: 500 })
  }

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, total_price, status')
    .eq('id', data.client_reference)
    .abortSignal(AbortSignal.timeout(Math.max(1, processingDeadline - Date.now())))
    .maybeSingle()

  if (orderError) {
    console.error('[Wave webhook] Order lookup failed', { databaseCode: orderError.code })
    return new Response('Webhook processing unavailable', { status: 500 })
  }
  if (!order) {
    console.error('[Wave webhook] Completed event ignored', { reason: 'order_not_found' })
    return acknowledge()
  }
  if (order.status === 'payé') return acknowledge()

  const expectedAmount = getIntegerXofAmount(order.total_price)
  if (!('amount' in expectedAmount)) {
    console.error('[Wave webhook] Completed event ignored', { reason: 'invalid_order_amount' })
    return acknowledge()
  }

  const notifiedAmount = parseIntegerXofAmount(data.amount)
  if (notifiedAmount === null || notifiedAmount !== expectedAmount.amount) {
    console.error('[Wave webhook] Completed event ignored', { reason: 'amount_mismatch' })
    return acknowledge()
  }

  const { data: confirmed, error: confirmError } = await supabase
    .rpc('confirm_paytech_product_order', { p_order_id: order.id })
    .abortSignal(AbortSignal.timeout(Math.max(1, processingDeadline - Date.now())))
  if (confirmError) {
    console.error('[Wave webhook] Order confirmation failed', { databaseCode: confirmError.code })
    return new Response('Webhook processing unavailable', { status: 500 })
  }
  if (!confirmed) {
    console.error('[Wave webhook] Order confirmation was rejected')
    return new Response('Webhook processing unavailable', { status: 500 })
  }

  try {
    after(async () => {
      try {
        const result = await sendAutomaticOrderConfirmation(order.id)
        if (result.alreadyAttempted) {
          console.info('[Wave webhook] Automatic confirmation email already attempted')
        }
      } catch (error) {
        console.error('[Wave webhook] Automatic confirmation email failed', {
          errorName: error instanceof Error ? error.name : 'unknown',
        })
      }
    })
  } catch (error) {
    console.error('[Wave webhook] Automatic confirmation email could not be scheduled', {
      errorName: error instanceof Error ? error.name : 'unknown',
    })
  }

  return acknowledge()
}
