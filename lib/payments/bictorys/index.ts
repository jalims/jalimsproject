import { randomUUID } from 'node:crypto'
import { createSupabaseAdminClient } from '../../supabase-admin'

const orderIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorResponse(error: string, status: number) {
  return Response.json({ error }, { status })
}

function normalizeSenegalPhone(phone: string) {
  let compact = phone.trim().replace(/[\s().-]/g, '')

  if (compact.startsWith('00221')) {
    compact = `+${compact.slice(2)}`
  } else if (/^221\d{9}$/.test(compact)) {
    compact = `+${compact}`
  } else if (/^\d{9}$/.test(compact)) {
    compact = `+221${compact}`
  }

  return /^\+221\d{9}$/.test(compact) ? compact : null
}

function getApiEndpoint() {
  try {
    const configuredBaseUrl = process.env.BICTORYS_BASE_URL?.trim()
    if (!configuredBaseUrl) return null

    const baseUrl = new URL(configuredBaseUrl)
    if (baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password) return null
    return `${baseUrl.toString().replace(/\/+$/, '')}/pay/v1/charges`
  } catch {
    return null
  }
}

function getSiteOrigin() {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  if (!siteUrl) return null

  try {
    const parsedSiteUrl = new URL(siteUrl)
    return parsedSiteUrl.protocol === 'https:' ? parsedSiteUrl.origin : null
  } catch {
    return null
  }
}

export async function createBictorysPayment(request: Request) {
  const apiKey = process.env.BICTORYS_API_KEY
  const endpoint = getApiEndpoint()
  const siteOrigin = getSiteOrigin()

  if (!apiKey) {
    return errorResponse('Configuration Bictorys manquante sur le serveur.', 500)
  }
  if (!endpoint) {
    console.error('[Bictorys] Invalid API base URL configuration')
    return errorResponse('Configuration de l’URL de l’API Bictorys manquante ou invalide.', 500)
  }
  if (!siteOrigin) {
    return errorResponse('Configuration de l’adresse du site manquante ou invalide.', 500)
  }

  const accessToken = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!accessToken) {
    return errorResponse('Connexion requise.', 401)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse('Requête invalide.', 400)
  }
  if (!isRecord(body) || typeof body.order_id !== 'string' || !orderIdPattern.test(body.order_id)) {
    return errorResponse('Identifiant de commande invalide.', 400)
  }

  let supabase
  try {
    supabase = createSupabaseAdminClient()
  } catch (error) {
    console.error('[Bictorys] Server payment configuration unavailable', {
      errorName: error instanceof Error ? error.name : 'unknown',
    })
    return errorResponse('Le paiement est momentanément indisponible.', 500)
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken)
  if (authError || !authData.user) {
    return errorResponse('Session invalide.', 401)
  }

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, user_id, total_price, status, payment_reference')
    .eq('id', body.order_id)
    .eq('user_id', authData.user.id)
    .maybeSingle()

  if (orderError) {
    console.error('[Bictorys] Order lookup failed', {
      orderId: body.order_id,
      databaseCode: orderError.code,
    })
    return errorResponse('Impossible de charger la commande.', 500)
  }
  if (!order) {
    return errorResponse('Commande introuvable.', 404)
  }
  if (order.status !== 'pending_payment') {
    return errorResponse('Cette commande n’est plus en attente de paiement.', 409)
  }
  const amount = Number(order.total_price)
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return errorResponse('Le montant enregistré sur la commande doit être un entier XOF valide.', 500)
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('full_name, phone')
    .eq('id', authData.user.id)
    .maybeSingle()

  if (profileError) {
    return errorResponse('Impossible de charger votre profil client.', 500)
  }
  const name = profile?.full_name?.trim()
  if (!name) {
    return errorResponse('Ajoutez votre nom complet à votre profil avant de payer.', 400)
  }

  const phone = typeof profile?.phone === 'string' ? normalizeSenegalPhone(profile.phone) : null
  if (!phone) {
    return errorResponse('Ajoutez un numéro sénégalais valide au format +221XXXXXXXXX dans votre profil.', 400)
  }

  const successUrl = new URL('/payment/bictorys/success', siteOrigin)
  successUrl.searchParams.set('order_id', order.id)
  const errorUrl = new URL('/payment/bictorys/error', siteOrigin)
  errorUrl.searchParams.set('order_id', order.id)

  const attemptReference = `pending:bictorys:${randomUUID()}`
  let claimQuery = supabase
    .from('orders')
    .update({ payment_reference: attemptReference })
    .eq('id', order.id)
    .eq('status', 'pending_payment')
  claimQuery = order.payment_reference === null
    ? claimQuery.is('payment_reference', null)
    : claimQuery.eq('payment_reference', order.payment_reference)
  const { data: claimedOrder, error: claimError } = await claimQuery
    .select('id')
    .maybeSingle()

  if (claimError) {
    console.error('[Bictorys] Could not reserve payment attempt', {
      orderId: order.id,
      databaseCode: claimError.code,
    })
    return errorResponse('Impossible de réserver la tentative de paiement.', 500)
  }
  if (!claimedOrder) {
    return errorResponse('Une autre tentative de paiement est en cours. Actualisez vos commandes avant de réessayer.', 409)
  }

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({
        amount,
        currency: 'XOF',
        paymentReference: order.id,
        successRedirectUrl: successUrl.toString(),
        errorRedirectUrl: errorUrl.toString(),
        customerObject: {
          name,
          phone,
          country: 'SN',
        },
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    })
  } catch (error) {
    console.error('[Bictorys] Charge creation request failed', {
      orderId: order.id,
      errorName: error instanceof Error ? error.name : 'unknown',
    })
    return errorResponse('Vérifiez qu’aucun débit n’a été effectué avant de réessayer depuis Mes commandes.', 502)
  }

  if (!response.ok) {
    console.error('[Bictorys] Charge creation request rejected', {
      orderId: order.id,
      status: response.status,
    })
    return errorResponse('Vérifiez qu’aucun débit n’a été effectué avant de réessayer depuis Mes commandes.', 502)
  }

  let charge: unknown
  try {
    charge = await response.json()
  } catch {
    console.error('[Bictorys] Invalid charge response', {
      orderId: order.id,
      reason: 'invalid_json',
    })
    return errorResponse('Vérifiez qu’aucun débit n’a été effectué avant de réessayer depuis Mes commandes.', 502)
  }

  const link = isRecord(charge) ? charge.link : undefined
  const chargeId = isRecord(charge) ? charge.chargeId : undefined
  if (typeof link !== 'string' || !link.trim()) {
    console.error('[Bictorys] Invalid charge response', {
      orderId: order.id,
      reason: 'missing_link',
    })
    return errorResponse('Bictorys n’a pas renvoyé le lien. Vérifiez qu’aucun débit n’a été effectué avant de réessayer.', 502)
  }
  if (typeof chargeId !== 'string' || !chargeId.trim()) {
    console.error('[Bictorys] Invalid charge response', {
      orderId: order.id,
      reason: 'missing_charge_id',
    })
    return errorResponse('Bictorys n’a pas renvoyé la référence du paiement. Vérifiez qu’aucun débit n’a été effectué avant de réessayer.', 502)
  }

  let redirectUrl: URL
  try {
    redirectUrl = new URL(link.trim())
  } catch {
    return errorResponse('Bictorys a renvoyé un lien invalide. Vérifiez qu’aucun débit n’a été effectué avant de réessayer.', 502)
  }
  if (
    redirectUrl.protocol !== 'https:'
    || redirectUrl.username
    || redirectUrl.password
    || (redirectUrl.hostname !== 'bictorys.com' && !redirectUrl.hostname.endsWith('.bictorys.com'))
  ) {
    return errorResponse('Bictorys a renvoyé un lien non sécurisé ou invalide. Vérifiez qu’aucun débit n’a été effectué avant de réessayer.', 502)
  }

  const { data: updatedOrder, error: updateError } = await supabase
    .from('orders')
    .update({ payment_reference: chargeId.trim() })
    .eq('id', order.id)
    .eq('status', 'pending_payment')
    .eq('payment_reference', attemptReference)
    .select('id')
    .maybeSingle()

  if (updateError || !updatedOrder) {
    console.error('[Bictorys] Could not persist charge reference on order', {
      orderId: order.id,
      reason: updateError ? 'database_error' : 'no_matching_order',
      databaseCode: updateError?.code ?? null,
    })
    return errorResponse('Impossible d’enregistrer la référence du paiement sur la commande.', updateError ? 500 : 409)
  }

  return Response.json({ redirect_url: redirectUrl.toString() })
}
