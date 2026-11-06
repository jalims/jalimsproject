import { createHmac, randomUUID } from 'node:crypto'
import { createSupabaseAdminClient } from '../paytech-admin'
import { isWaveEnabled, isWaveMockEnabled as waveMockEnabled } from './wave-config'

const orderIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const waveApiBaseUrl = process.env.WAVE_API_BASE_URL?.trim() || 'https://api.wave.com'

type WaveOrder = {
  id: string
  total_price: number | string
  status: string
}

type LoadedOrder = {
  order: WaveOrder
} | {
  response: Response
}

type WaveReturnUrls = {
  successUrl: string
  errorUrl: string
}

export type IntegerXofAmountResult = {
  amount: number
} | {
  reason: 'invalid_amount' | 'fractional_xof_amount' | 'unsafe_integer_amount'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorResponse(error: string, status: number) {
  return Response.json({ error }, { status })
}

function getReturnUrls(origin: string, orderId: string): WaveReturnUrls {
  const successUrl = new URL('/payment/wave/success', origin)
  successUrl.searchParams.set('order_id', orderId)

  const errorUrl = new URL('/payment/wave/error', origin)
  errorUrl.searchParams.set('order_id', orderId)

  return { successUrl: successUrl.toString(), errorUrl: errorUrl.toString() }
}

async function loadOwnedPendingOrder(request: Request, orderId: string): Promise<LoadedOrder> {
  const authorization = request.headers.get('authorization')
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!accessToken) {
    return { response: errorResponse('Connexion requise.', 401) }
  }

  let supabase
  try {
    supabase = createSupabaseAdminClient()
  } catch (error) {
    console.error('[Wave] Server payment configuration unavailable', {
      errorName: error instanceof Error ? error.name : 'unknown',
    })
    return { response: errorResponse('Le paiement Wave est momentanément indisponible.', 500) }
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken)
  if (authError || !authData.user) {
    return { response: errorResponse('Session invalide.', 401) }
  }

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, user_id, total_price, status')
    .eq('id', orderId)
    .eq('user_id', authData.user.id)
    .maybeSingle()

  if (orderError) {
    console.error('[Wave] Order lookup failed', {
      orderId,
      databaseCode: orderError.code,
    })
    return { response: errorResponse('Impossible de charger la commande.', 500) }
  }
  if (!order) {
    return { response: errorResponse('Commande introuvable.', 404) }
  }
  if (order.status !== 'pending_payment') {
    return { response: errorResponse('Cette commande n’est plus en attente de paiement.', 409) }
  }

  return {
    order: {
      id: order.id,
      total_price: order.total_price,
      status: order.status,
    },
  }
}

export function getIntegerXofAmount(totalPrice: number | string): IntegerXofAmountResult {
  const amount = Number(totalPrice)
  if (!Number.isFinite(amount) || amount <= 0) {
    console.error('[Wave] Invalid order amount', { reason: 'invalid_amount' })
    return { reason: 'invalid_amount' }
  }
  if (!Number.isSafeInteger(amount)) {
    const hasFraction = !Number.isInteger(amount)
    const reason = hasFraction ? 'fractional_xof_amount' : 'unsafe_integer_amount'
    console.error('[Wave] Invalid order amount', { reason })
    return { reason }
  }
  return { amount }
}

function readIntegerXof(order: WaveOrder): number | Response {
  const result = getIntegerXofAmount(order.total_price)
  if ('amount' in result) return result.amount
  if (result.reason === 'fractional_xof_amount') {
    return errorResponse('Le total de cette commande comporte une partie décimale. Le paiement Wave exige un montant entier en FCFA; aucune session n’a été créée.', 422)
  }
  if (result.reason === 'unsafe_integer_amount') {
    return errorResponse('Le montant enregistré sur la commande dépasse la limite de sécurité pour un paiement XOF.', 500)
  }
  return errorResponse('Le montant enregistré sur la commande est invalide.', 500)
}

async function readOrderId(request: Request): Promise<string | Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse('Requête invalide.', 400)
  }

  if (!isRecord(body) || typeof body.order_id !== 'string' || !orderIdPattern.test(body.order_id)) {
    return errorResponse('Identifiant de commande invalide.', 400)
  }
  return body.order_id
}

function getWaveApiEndpoint(): string | null {
  try {
    const baseUrl = new URL(waveApiBaseUrl)
    if (baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password) return null
    return `${baseUrl.toString().replace(/\/+$/, '')}/v1/checkout/sessions`
  } catch {
    return null
  }
}

export function isWaveMockEnabled() {
  return waveMockEnabled()
}

export async function createWavePayment(request: Request) {
  if (!isWaveEnabled()) {
    return errorResponse('Wave est temporairement désactivé. Choisissez un autre moyen de paiement.', 503)
  }

  const orderId = await readOrderId(request)
  if (orderId instanceof Response) return orderId

  const loadedOrder = await loadOwnedPendingOrder(request, orderId)
  if ('response' in loadedOrder) return loadedOrder.response

  const amount = readIntegerXof(loadedOrder.order)
  if (amount instanceof Response) return amount

  if (waveMockEnabled()) {
    const mockUrl = new URL('/payment/wave/mock', request.url)
    mockUrl.searchParams.set('order_id', loadedOrder.order.id)
    return Response.json({ redirect_url: mockUrl.toString() })
  }

  const apiKey = process.env.WAVE_API_KEY
  if (!apiKey) {
    return errorResponse('Configuration Wave manquante. Configurez WAVE_API_KEY sur le serveur.', 500)
  }

  const endpoint = getWaveApiEndpoint()
  if (!endpoint) {
    console.error('[Wave] Invalid API base URL configuration')
    return errorResponse('Configuration de l’URL de l’API Wave invalide. Une URL HTTPS est requise.', 500)
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  if (!siteUrl) {
    return errorResponse('Configuration de l’adresse du site manquante.', 500)
  }

  let siteOrigin: string
  try {
    const parsedSiteUrl = new URL(siteUrl)
    if (parsedSiteUrl.protocol !== 'https:') {
      return errorResponse('L’adresse publique du site doit utiliser HTTPS pour le paiement Wave.', 500)
    }
    siteOrigin = parsedSiteUrl.origin
  } catch {
    return errorResponse('Configuration de l’adresse du site invalide.', 500)
  }

  const returnUrls = getReturnUrls(siteOrigin, loadedOrder.order.id)
  let waveResponse: Response
  try {
    waveResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: String(amount),
        currency: 'XOF',
        success_url: returnUrls.successUrl,
        error_url: returnUrls.errorUrl,
        client_reference: loadedOrder.order.id,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    })
  } catch (error) {
    console.error('[Wave] Checkout session request failed', {
      orderId: loadedOrder.order.id,
      errorName: error instanceof Error ? error.name : 'unknown',
    })
    return errorResponse('Wave est momentanément inaccessible. Votre commande reste en attente; vous pouvez réessayer ou choisir un autre moyen de paiement.', 502)
  }

  if (!waveResponse.ok) {
    console.error('[Wave] Checkout session request rejected', {
      orderId: loadedOrder.order.id,
      status: waveResponse.status,
    })
    return errorResponse('Wave n’a pas pu démarrer le paiement. Votre commande reste en attente; vous pouvez réessayer ou choisir un autre moyen de paiement.', 502)
  }

  let session: unknown
  try {
    session = await waveResponse.json()
  } catch {
    console.error('[Wave] Invalid checkout session response', {
      orderId: loadedOrder.order.id,
      reason: 'invalid_json',
    })
    return errorResponse('La réponse de Wave est invalide. Votre commande reste en attente; vous pouvez réessayer.', 502)
  }

  const waveLaunchUrl = isRecord(session) ? session.wave_launch_url : undefined
  if (typeof waveLaunchUrl !== 'string') {
    console.error('[Wave] Invalid checkout session response', {
      orderId: loadedOrder.order.id,
      reason: 'missing_wave_launch_url',
    })
    return errorResponse('Wave n’a pas renvoyé de lien de paiement valide. Votre commande reste en attente; vous pouvez réessayer.', 502)
  }

  let redirectUrl: URL
  try {
    redirectUrl = new URL(waveLaunchUrl)
  } catch {
    return errorResponse('Wave n’a pas renvoyé de lien de paiement valide. Votre commande reste en attente; vous pouvez réessayer.', 502)
  }
  if (redirectUrl.protocol !== 'https:') {
    return errorResponse('Wave n’a pas renvoyé de lien de paiement sécurisé. Votre commande reste en attente; vous pouvez réessayer.', 502)
  }

  return Response.json({ redirect_url: redirectUrl.toString() })
}

export async function handleMockWavePayment(request: Request) {
  if (!waveMockEnabled()) {
    return errorResponse('Le simulateur Wave est désactivé.', 404)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse('Requête invalide.', 400)
  }
  if (!isRecord(body)
    || typeof body.order_id !== 'string'
    || !orderIdPattern.test(body.order_id)
    || (body.outcome !== 'paid' && body.outcome !== 'error')) {
    return errorResponse('Action de simulation invalide.', 400)
  }

  const loadedOrder = await loadOwnedPendingOrder(request, body.order_id)
  if ('response' in loadedOrder) return loadedOrder.response

  const amount = readIntegerXof(loadedOrder.order)
  if (amount instanceof Response) return amount

  const origin = new URL(request.url).origin
  const returnUrls = getReturnUrls(origin, loadedOrder.order.id)
  if (body.outcome === 'error') {
    return Response.json({ redirect_url: returnUrls.errorUrl })
  }

  const secret = process.env.WAVE_WEBHOOK_SECRET
  if (!secret) {
    console.error('[Wave mock] Missing webhook signing secret', { orderId: loadedOrder.order.id })
    return errorResponse('Configurez WAVE_WEBHOOK_SECRET pour tester une confirmation Wave simulée.', 500)
  }

  const sessionId = `cos-${randomUUID().replaceAll('-', '').slice(0, 16)}`
  const transactionId = `MOCK-${randomUUID().replaceAll('-', '').slice(0, 10)}`
  const mockLaunchUrl = new URL('/payment/wave/mock', origin)
  mockLaunchUrl.searchParams.set('order_id', loadedOrder.order.id)
  const rawBody = JSON.stringify({
    type: 'checkout.session.completed',
    data: {
      id: sessionId,
      amount: String(amount),
      checkout_status: 'complete',
      client_reference: loadedOrder.order.id,
      currency: 'XOF',
      error_url: returnUrls.errorUrl,
      payment_status: 'succeeded',
      transaction_id: transactionId,
      success_url: returnUrls.successUrl,
      wave_launch_url: mockLaunchUrl.toString(),
    },
  })
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}${rawBody}`)
    .digest('hex')

  let webhookResponse: Response
  try {
    webhookResponse = await fetch(new URL('/api/payment/wave/webhook', origin), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Wave-Signature': `t=${timestamp},v1=${signature}`,
      },
      body: rawBody,
      cache: 'no-store',
    })
  } catch (error) {
    console.error('[Wave mock] Signed test event could not be sent', {
      orderId: loadedOrder.order.id,
      errorName: error instanceof Error ? error.name : 'unknown',
    })
    return errorResponse('Impossible d’envoyer l’événement de test au webhook Wave. La commande reste en attente.', 502)
  }

  if (!webhookResponse.ok) {
    console.error('[Wave mock] Signed test event was rejected', {
      orderId: loadedOrder.order.id,
      status: webhookResponse.status,
    })
    return errorResponse(`Le webhook Wave n’a pas accepté l’événement de test (HTTP ${webhookResponse.status}). La commande reste en attente.`, 502)
  }

  return Response.json({ redirect_url: returnUrls.successUrl })
}
