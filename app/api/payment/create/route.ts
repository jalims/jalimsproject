import { createSupabaseAdminClient } from '../../../../lib/paytech-admin'

type CreatePaymentBody = {
  order_id?: unknown
  amount?: unknown
  paymentMethod?: unknown
}

const paymentMethods = ['Wave', 'Orange Money', 'Free Money', 'Carte Bancaire'] as const

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

  if (
    typeof body.order_id !== 'string'
    || typeof body.amount !== 'number'
    || !Number.isFinite(body.amount)
    || typeof body.paymentMethod !== 'string'
    || !paymentMethods.includes(body.paymentMethod as (typeof paymentMethods)[number])
  ) {
    return Response.json({ error: 'Commande ou montant invalide.' }, { status: 400 })
  }
  const paymentMethod = body.paymentMethod as (typeof paymentMethods)[number]

  let supabase
  try {
    supabase = createSupabaseAdminClient()
  } catch {
    return Response.json({ error: 'Ajoutez SUPABASE_SERVICE_ROLE_KEY aux variables serveur Supabase.' }, { status: 500 })
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
  if (!Number.isFinite(orderAmount) || Math.abs(orderAmount - body.amount) > 0.001) {
    return Response.json({ error: 'Le montant ne correspond pas à la commande.' }, { status: 400 })
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

  let ipnUrl: URL
  try {
    ipnUrl = new URL('/api/payment/ipn', siteUrl)
  } catch {
    return Response.json({ error: 'URL du site invalide.' }, { status: 500 })
  }
  if (ipnUrl.protocol !== 'https:') {
    return Response.json({ error: 'L’URL IPN PayTech doit utiliser HTTPS.' }, { status: 500 })
  }

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
        ref_command: order.jalims_code,
        command_name: `Commande ${order.jalims_code} - ${product.name}`,
        target_payment: paymentMethod,
        env: 'test',
        ipn_url: ipnUrl.toString(),
        success_url: `${siteUrl}/orders?payment=return`,
        cancel_url: `${siteUrl}/orders?payment=cancelled`,
        custom_field: JSON.stringify({ order_id: order.id }),
      }),
      cache: 'no-store',
    })
  } catch {
    return Response.json({ error: 'PayTech est momentanément inaccessible.' }, { status: 502 })
  }

  let payment: { success?: number; token?: string; redirect_url?: string }
  try {
    payment = await paytechResponse.json() as typeof payment
  } catch {
    return Response.json({ error: 'Réponse PayTech invalide.' }, { status: 502 })
  }

  if (!paytechResponse.ok || payment.success !== 1 || !payment.token || !payment.redirect_url) {
    return Response.json({ error: 'PayTech n’a pas pu créer le paiement.' }, { status: 502 })
  }

  let redirectUrl: URL
  try {
    redirectUrl = new URL(payment.redirect_url)
  } catch {
    return Response.json({ error: 'URL de paiement PayTech invalide.' }, { status: 502 })
  }
  if (redirectUrl.protocol !== 'https:' || redirectUrl.hostname !== 'paytech.sn') {
    return Response.json({ error: 'URL de paiement PayTech invalide.' }, { status: 502 })
  }

  redirectUrl.searchParams.set('pn', customerPhone.international)
  redirectUrl.searchParams.set('nn', customerPhone.national)
  redirectUrl.searchParams.set('fn', profile.full_name.trim())
  redirectUrl.searchParams.set('tp', paymentMethod)
  redirectUrl.searchParams.set('nac', paymentMethod === 'Carte Bancaire' ? '0' : '1')

  const { data: updatedOrder, error: updateError } = await supabase
    .from('orders')
    .update({ paytech_token: payment.token })
    .eq('id', order.id)
    .eq('status', 'pending_payment')
    .select('id')
    .maybeSingle()

  if (updateError || !updatedOrder) {
    return Response.json({ error: 'Impossible d’enregistrer le paiement sur la commande.' }, { status: 409 })
  }

  return Response.json({ redirect_url: redirectUrl.toString() })
}