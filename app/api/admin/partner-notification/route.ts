import { NextResponse } from 'next/server'
import { authorizeJalimsAdminRequest } from '../../../../lib/admin-route-auth'
import { loadAdminOrderDeliveryDetails } from '../../../../lib/admin-order-delivery-details'
import { localOrderStatusOptions } from '../../../../lib/order-tracking'
import { createSupabaseAdminClient } from '../../../../lib/paytech-admin'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const paidStatuses = new Set<string>(localOrderStatusOptions
  .map(([status]) => status)
  .filter((status) => status !== 'pending_payment' && status !== 'cancelled'))

type VariantLine = {
  attribute_values: Record<string, string>
  quantity: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatVariant(values: Record<string, string>) {
  const entries = Object.entries(values)
    .map(([key, value]) => `${key.replaceAll('_', ' ')} : ${value}`)
  return entries.length > 0 ? entries.join(', ') : 'Standard'
}

export async function POST(request: Request) {
  const authorization = await authorizeJalimsAdminRequest(request, 'Admin partner notification')
  if ('response' in authorization) return authorization.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'La demande de notification est illisible.' }, { status: 400 })
  }
  if (
    !isRecord(body)
    || typeof body.orderId !== 'string'
    || !uuidPattern.test(body.orderId)
    || (body.resend !== undefined && typeof body.resend !== 'boolean')
  ) {
    return NextResponse.json({ error: 'La commande demandée est invalide.' }, { status: 400 })
  }

  const orderId = body.orderId
  const resend = body.resend === true

  try {
    const supabase = createSupabaseAdminClient()
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, user_id, product_id, jalims_code, quantity, variant_id, variant_values, origin, delivery_delay, delivery_region, delivery_neighborhood, status, partner_id, partner_notified_at')
      .eq('id', orderId)
      .maybeSingle()

    if (orderError) {
      console.error('[Admin partner notification] Order lookup failed', orderError.message)
      return NextResponse.json({ error: 'Impossible de vérifier la commande.' }, { status: 500 })
    }
    if (!order) return NextResponse.json({ error: 'Commande introuvable.' }, { status: 404 })
    if (order.origin !== 'local') return NextResponse.json({ error: 'Cette action est réservée aux commandes locales.' }, { status: 400 })
    if (!paidStatuses.has(order.status)) {
      return NextResponse.json({ error: 'Le paiement de cette commande n’est pas encore confirmé.' }, { status: 409 })
    }
    if (!order.partner_id) {
      return NextResponse.json({ error: 'Aucun partenaire n’est associé à cette commande.' }, { status: 409 })
    }
    if (order.partner_notified_at && !resend) {
      return NextResponse.json({ error: 'Le partenaire a déjà été prévenu. Confirmez le renvoi.' }, { status: 409 })
    }

    const [{ data: partner, error: partnerError }, { data: product, error: productError }, { data: variantLines, error: variantLinesError }, deliveryDetailsResult] = await Promise.all([
      supabase.from('partners')
        .select('id, name, whatsapp_phone')
        .eq('id', order.partner_id)
        .maybeSingle(),
      supabase.from('products')
        .select('name')
        .eq('id', order.product_id)
        .maybeSingle(),
      supabase.from('order_variant_lines')
        .select('attribute_values, quantity')
        .eq('order_id', order.id)
        .returns<VariantLine[]>(),
      loadAdminOrderDeliveryDetails(supabase, [order.id]),
    ])

    if (partnerError || productError || variantLinesError || deliveryDetailsResult.error) {
      console.error('[Admin partner notification] Message details lookup failed', {
        partner: partnerError?.message,
        product: productError?.message,
        variants: variantLinesError?.message,
        delivery: deliveryDetailsResult.error,
      })
      return NextResponse.json({ error: 'Impossible de réunir les informations nécessaires au message.' }, { status: 500 })
    }
    if (!partner) return NextResponse.json({ error: 'Le partenaire associé à la commande est introuvable.' }, { status: 409 })
    if (!/^[1-9][0-9]{7,14}$/.test(partner.whatsapp_phone)) {
      return NextResponse.json({ error: 'Le numéro WhatsApp du partenaire est invalide. Corrigez-le dans la gestion des partenaires.' }, { status: 409 })
    }
    if (!product) return NextResponse.json({ error: 'Le produit de cette commande est introuvable.' }, { status: 409 })

    const customer = deliveryDetailsResult.details.find((detail) => detail.order_id === order.id)
    if (!order.delivery_region?.trim()) {
      return NextResponse.json({ error: 'Envoi bloqué : la région de livraison de cette commande est manquante.' }, { status: 400 })
    }
    if (!order.delivery_neighborhood?.trim()) {
      return NextResponse.json({ error: 'Envoi bloqué : le quartier ou la zone de livraison de cette commande est manquant.' }, { status: 400 })
    }
    if (!customer?.customer_name.trim()) {
      return NextResponse.json({ error: 'Envoi bloqué : le nom complet du client est manquant dans son profil.' }, { status: 400 })
    }
    if (!customer?.customer_phone.trim()) {
      return NextResponse.json({ error: 'Envoi bloqué : le téléphone du client est manquant dans son profil.' }, { status: 400 })
    }
    if (!order.delivery_delay?.trim()) {
      return NextResponse.json({ error: 'Envoi bloqué : le délai de livraison promis est manquant sur la commande.' }, { status: 400 })
    }

    const lines: VariantLine[] = variantLines?.length
      ? variantLines
      : [{
        attribute_values: (order.variant_values ?? {}) as Record<string, string>,
        quantity: order.quantity,
      }]
    const totalItems = lines.reduce((sum, line) => sum + line.quantity, 0)
    const variantSummary = lines
      .map((line) => `${formatVariant(line.attribute_values)} × ${line.quantity}`)
      .join('\n')
    const message = [
      `Bonjour ${partner.name},`,
      `Commande ${order.jalims_code}.`,
      'Paiement : payée en ligne, rien à encaisser.',
      `Produit : ${product.name}`,
      'Variantes :',
      variantSummary,
      `Nombre total d’articles : ${totalItems}`,
      `Livraison : ${order.delivery_neighborhood.trim()}, ${order.delivery_region.trim()}. Client : ${customer.customer_name.trim()}, ${customer.customer_phone.trim()}.`,
      `Délai promis au client : ${order.delivery_delay.trim()}.`,
      'Peux-tu me confirmer la disponibilité et la date de livraison ? Réponds OUI ou NON (rupture).',
    ].join('\n')
    const whatsappUrl = `https://wa.me/${partner.whatsapp_phone}?text=${encodeURIComponent(message)}`
    const notifiedAt = new Date().toISOString()

    let update = supabase.from('orders')
      .update({ partner_notified_at: notifiedAt, partner_notified_by: authorization.user.id })
      .eq('id', order.id)
      .eq('status', order.status)
      .eq('origin', 'local')
      .eq('partner_id', partner.id)
    if (resend) {
      update = update.eq('partner_notified_at', order.partner_notified_at)
    } else {
      update = update.is('partner_notified_at', null)
    }
    const { data: updatedOrder, error: updateError } = await update
      .select('partner_notified_at')
      .maybeSingle()

    if (updateError) {
      console.error('[Admin partner notification] Notification timestamp update failed', updateError.message)
      return NextResponse.json({ error: 'La notification n’a pas pu être enregistrée.' }, { status: 500 })
    }
    if (!updatedOrder) {
      return NextResponse.json({ error: 'La commande a changé. Rechargez la page puis réessayez.' }, { status: 409 })
    }

    return NextResponse.json({
      whatsapp_url: whatsappUrl,
      partner_notified_at: updatedOrder.partner_notified_at,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[Admin partner notification] Request failed', error)
    return NextResponse.json({ error: 'Le message du partenaire n’a pas pu être préparé.' }, { status: 500 })
  }
}
