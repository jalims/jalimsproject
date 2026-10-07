import { randomUUID } from 'node:crypto'
import { createSupabaseAdminClient } from '../../../../lib/paytech-admin'

type CreatePaymentBody = {
  order_id?: unknown
  paymentMethod?: unknown
}

const paymentMethods = ['Wave', 'Orange Money', 'Free Money', 'Carte Bancaire'] as const
const paytechIpnUrl = 'https://jalims.com/api/payment/ipn'

function normalizeSenegalPhone(phone: string) {
  let compact = phone.trim().replace(/[\s().-]/g, '')

  if (compact.startsWith('00221')) {
    compact = `+${compact.slice(2)}`
  } else if (/^221\d{9}$/.test(compact)) {
    compact = `+${compact}`
  } else if (/^\d{9}$/.test(compact)) {
    compact = `+221${compact}`
  }

  if (!/^\+221\d{9}$/.test(compact)) return null

  return { international: compact, national: compact.slice(4) }
}

export async function POST(request: Request) {
  const apiKey = process.env.PAYTECH_API_KEY
  const apiSecret = process.env.PAYTECH_API_SECRET
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '')
  if (!apiKey || !apiSecret || !siteUrl) {
    return Response.json({ error: 'Configuration de paiement incomplète.' }, { status: 500 })
  }

  const authorization = request.headers.get('authorization')
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!accessToken) {
    return Response.json({ error: 'Connexion requise.' }, { status: 401 })
  }

  let body: CreatePaymentBody
  try {
    body = await request.json() as CreatePaymentBody
  } catch {
    return Response.json({ error: 'Requête invalide.' }, { status: 400 })
  }

  if (typeof body.order_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.order_id)) {
    return Response.json({ error: 'Identifiant de commande invalide.' }, { status: 400 })
  }
  if (typeof body.paymentMethod !== 'string' || !paymentMethods.includes(body.paymentMethod as (typeof paymentMethods)[number])) {
    return Response.json({ error: 'Moyen de paiement manquant ou invalide.' }, { status: 400 })
  }
  const paymentMethod = body.paymentMethod as (typeof paymentMethods)[number]

  let supabase
  try {
    supabase = createSupabaseAdminClient()
  } catch (error) {
    console.error('[Payment] Server payment configuration unavailable', error)
    return Response.json({ error: 'Le paiement est momentanément indisponible. Veuillez réessayer plus tard.' }, { status: 500 })
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken)
  if (authError || !authData.user) {
    return Response.json({ error: 'Session invalide.' }, { status: 401 })
  }

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, user_id, total_price, status, jalims_code, product_id')
    .eq('id', body.order_id)
    .eq('user_id', authData.user.id)
    .maybeSingle()

  if (orderError) {
    return Response.json({ error: 'Impossible de charger la commande.' }, { status: 500 })
  }
  if (!order) {
    return Response.json({ error: 'Commande introuvable.' }, { status: 404 })
  }
  if (order.status !== 'pending_payment') {
    return Response.json({ error: 'Cette commande n’est plus en attente de paiement.' }, { status: 409 })
  }

  const orderAmount = Number(order.total_price)
  if (!Number.isFinite(orderAmount) || orderAmount <= 0) {
    return Response.json({ error: 'Le montant enregistré sur la commande est invalide.' }, { status: 500 })
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('full_name, phone')
    .eq('id', authData.user.id)
    .maybeSingle()

  if (profileError) {
    return Response.json({ error: 'Impossible de charger votre profil client.' }, { status: 500 })
  }
  if (!profile?.full_name.trim()) {
    return Response.json({ error: 'Ajoutez votre nom complet à votre profil avant de payer.' }, { status: 400 })
  }

  const customerPhone = normalizeSenegalPhone(profile.phone)
  if (!customerPhone) {
    return Response.json({ error: 'Ajoutez un numéro sénégalais valide au format +221XXXXXXXXX dans votre profil.' }, { status: 400 })
  }

  const { data: product, error: productError } = await supabase
    .from('products')
    .select('name')
    .eq('id', order.product_id)
    .maybeSingle()

  if (productError || !product) {
    return Response.json({ error: 'Impossible de charger le produit de la commande.' }, { status: 500 })
  }

  const paytechRefCommand = `PAY-${randomUUID()}`

  console.info('[PayTech] Creating payment request', {
    ipnUrl: paytechIpnUrl,
    refCommand: paytechRefCommand,
  })

  let paytechResponse: Response
  try {
    paytechResponse = await fetch('https://paytech.sn/api/payment/request-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        API_KEY: apiKey,
        API_SECRET: apiSecret,
      },
      body: JSON.stringify({
        item_name: product.name,
        item_price: orderAmount,
        currency: 'XOF',
        ref_command: paytechRefCommand,
        command_name: `Commande ${order.jalims_code} - ${product.name}`,
        target_payment: paymentMethod,
        env: 'test',
        ipn_url: paytechIpnUrl,
        success_url: `${siteUrl}/orders?payment=return`,
        cancel_url: `${siteUrl}/orders?payment=cancelled`,
        custom_field: JSON.stringify({ order_id: order.id }),
      }),
      cache: 'no-store',
    })
  } catch {
    console.error('[PayTech] Payment request failed', { reason: 'network_error' })
    return Response.json({ error: 'PayTech est momentanément inaccessible.' }, { status: 502 })
  }

  const responseText = await paytechResponse.text()
  let payment: { success?: number; token?: string; redirect_url?: string; message?: string; error?: string }
  try {
    payment = JSON.parse(responseText) as typeof payment
  } catch {
    const details = responseText.trim().slice(0, 500)
    console.error('[PayTech] Non-JSON response', { status: paytechResponse.status, details })
    return Response.json({
      error: `Réponse PayTech invalide (HTTP ${paytechResponse.status})${details ? ` : ${details}` : '.'}`,
    }, { status: 502 })
  }

  if (!paytechResponse.ok || payment.success !== 1 || !payment.token || !payment.redirect_url) {
    const paytechMessage = payment.message ?? payment.error ?? 'Aucun message fourni par PayTech.'
    console.error('[PayTech] Payment request rejected', {
      status: paytechResponse.status,
      success: payment.success ?? null,
      message: paytechMessage,
    })
    return Response.json({
      error: 'PayTech n’a pas pu démarrer le paiement. Veuillez réessayer.',
    }, { status: 502 })
  }
  console.info('[PayTech] Payment request accepted', {
    status: paytechResponse.status,
    refCommand: paytechRefCommand,
  })

  let redirectUrl: URL
  try {
    redirectUrl = new URL(payment.redirect_url)
  } catch {
    return Response.json({ error: 'URL de paiement PayTech invalide.' }, { status: 502 })
  }
  if (redirectUrl.protocol !== 'https:' || redirectUrl.hostname !== 'paytech.sn') {
    return Response.json({ error: 'URL de paiement PayTech invalide.' }, { status: 502 })
  }

  const autofillParameters = new URLSearchParams(redirectUrl.search)
  autofillParameters.set('pn', customerPhone.international)
  autofillParameters.set('nn', customerPhone.national)
  autofillParameters.set('fn', profile.full_name.trim())
  autofillParameters.set('tp', paymentMethod)
  autofillParameters.set('nac', paymentMethod === 'Carte Bancaire' ? '0' : '1')
  const encodedQuery = [...autofillParameters.entries()]
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
  redirectUrl.search = encodedQuery ? `?${encodedQuery}` : ''

  const { data: updatedOrder, error: updateError } = await supabase
    .from('orders')
    .update({ paytech_token: payment.token, paytech_ref_command: paytechRefCommand })
    .eq('id', order.id)
    .eq('status', 'pending_payment')
    .select('id')
    .maybeSingle()

  if (updateError || !updatedOrder) {
    console.error('[Payment] Could not persist PayTech payment on order', {
      orderId: order.id,
      paytechRefCommand,
      reason: updateError ? 'database_error' : 'no_matching_order',
      databaseError: updateError ? {
        code: updateError.code,
        message: updateError.message,
        details: updateError.details,
        hint: updateError.hint,
      } : null,
    })
    return Response.json(
      { error: 'Impossible d’enregistrer le paiement sur la commande.' },
      { status: updateError ? 500 : 409 },
    )
  }

  console.info('[PayTech] Payment linked to order', {
    orderId: order.id,
    refCommand: paytechRefCommand,
  })

  return Response.json({ redirect_url: redirectUrl.toString() })
}