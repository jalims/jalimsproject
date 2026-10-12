import { Resend } from 'resend'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  formatOrderProductList,
  isAllowedOrderMessageSender,
  isValidOrderMessageReplyTo,
  normalizeSenegalPhone,
  renderOrderMessage,
  type OrderMessageTemplateKey,
  type OrderMessageVariables,
  type OrderMessageVariantLine,
} from './order-messages'
import { createSupabaseAdminClient } from './paytech-admin'

type MessageSource = 'automatic' | 'manual'

type OrderMessageData = {
  orderId: string
  templateKey: OrderMessageTemplateKey
  to: string
  customerPhone: string
  from: string
  replyTo: string
  subject: string
  text: string
  html: string
  warnings: string[]
}

export class OrderMessageError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
    this.name = 'OrderMessageError'
  }
}

function throwDatabaseError(context: string, error: { message: string }) {
  console.error(`[Order messages] ${context}`, error.message)
  throw new OrderMessageError('Impossible de préparer le message. Vérifiez la configuration et réessayez.', 500)
}

function formatFcfa(value: number) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value)
}

function customerFirstName(fullName: string) {
  return fullName.trim().split(/\s+/)[0] ?? ''
}

function validateExtraVariables(
  templateKey: OrderMessageTemplateKey,
  value: unknown,
): Record<string, string> {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OrderMessageError('Les champs complémentaires du message sont invalides.')
  }

  const permittedVariables: Readonly<Record<OrderMessageTemplateKey, readonly string[]>> = {
    commande_confirmee: [],
    en_transit: ['date_estimee'],
    prete_a_retirer: [],
    retard: ['motif', 'date_estimee'],
    remboursement: ['motif', 'montant_rembourse', 'moyen_remboursement'],
  }
  const row = value as Record<string, unknown>
  const allowed = new Set(permittedVariables[templateKey])
  const variables: Record<string, string> = {}

  for (const [key, fieldValue] of Object.entries(row)) {
    if (!allowed.has(key)) {
      throw new OrderMessageError(`Le champ « ${key} » ne peut pas être modifié pour ce modèle.`)
    }
    if (typeof fieldValue !== 'string' || fieldValue.trim() === '' || fieldValue.length > 2000) {
      throw new OrderMessageError(`Le champ « ${key} » doit être un texte renseigné de 2 000 caractères maximum.`)
    }
    variables[key] = fieldValue.trim()
  }

  return variables
}

export async function prepareOrderMessage(
  orderId: string,
  templateKey: OrderMessageTemplateKey,
  extraVariables: unknown = {},
): Promise<OrderMessageData> {
  const supabase = createSupabaseAdminClient()
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, user_id, product_id, quantity, total_price, jalims_code, status')
    .eq('id', orderId)
    .maybeSingle()

  if (orderError) throwDatabaseError('Order lookup failed', orderError)
  if (!order) throw new OrderMessageError('Commande introuvable.', 404)

  const [{ data: template, error: templateError }, { data: settings, error: settingsError }, { data: product, error: productError }, { data: profile, error: profileError }, { data: lines, error: linesError }, { data: userResult, error: userError }] = await Promise.all([
    supabase.from('order_message_templates').select('template_key, subject, body, active').eq('template_key', templateKey).maybeSingle(),
    supabase.from('order_message_settings').select('pickup_address, pickup_hours, whatsapp_jalims, from_email, reply_to, reporting_delay_hours, refund_delay, delai_estime_par_defaut').eq('id', 1).maybeSingle(),
    supabase.from('products').select('name, delivery_estimate').eq('id', order.product_id).maybeSingle(),
    supabase.from('profiles').select('full_name, phone').eq('id', order.user_id).maybeSingle(),
    supabase.from('order_variant_lines').select('attribute_values, quantity').eq('order_id', order.id),
    supabase.auth.admin.getUserById(order.user_id),
  ])

  if (templateError) throwDatabaseError('Template lookup failed', templateError)
  if (settingsError) throwDatabaseError('Message settings lookup failed', settingsError)
  if (productError) throwDatabaseError('Product lookup failed', productError)
  if (profileError) throwDatabaseError('Customer profile lookup failed', profileError)
  if (linesError) throwDatabaseError('Order variant lookup failed', linesError)
  if (userError) throwDatabaseError('Order owner lookup failed', userError)
  if (!template || !template.active) throw new OrderMessageError('Ce modèle est introuvable ou désactivé.', 404)
  if (!settings) throw new OrderMessageError('Les réglages des messages ne sont pas configurés.', 503)
  if (!product?.name) throw new OrderMessageError('Le produit de cette commande est introuvable.', 500)

  const email = userResult.user?.email?.trim()
  if (!email) throw new OrderMessageError('Le compte propriétaire de la commande n’a pas d’adresse e-mail.', 400)

  const fullName = profile?.full_name?.trim()
    || (typeof userResult.user?.user_metadata?.full_name === 'string'
      ? userResult.user.user_metadata.full_name.trim()
      : '')
  if (!fullName) throw new OrderMessageError('Le nom du client n’est pas renseigné dans son profil.', 400)

  if (!isAllowedOrderMessageSender(settings.from_email)) {
    throw new OrderMessageError('L’adresse d’expédition doit être une adresse valide du domaine @jalims.com.', 400)
  }
  if (settings.reply_to && !isValidOrderMessageReplyTo(settings.reply_to)) {
    throw new OrderMessageError('L’adresse de réponse configurée est invalide.', 400)
  }
  if (templateKey === 'prete_a_retirer' && (
    !settings.pickup_address.trim() || !settings.pickup_hours.trim()
  )) {
    throw new OrderMessageError('Renseignez l’adresse et les horaires du point de retrait avant d’envoyer ce message.', 400)
  }
  if (templateKey === 'prete_a_retirer' && order.status !== 'prête_a_retirer') {
    throw new OrderMessageError('Le code de retrait ne peut être envoyé que lorsque la commande est prête à retirer.', 409)
  }
  if (templateKey === 'commande_confirmee' && !product.delivery_estimate?.trim()) {
    console.warn('[Order messages] Product has no delivery estimate; using the configured default', {
      orderId: order.id,
      productId: order.product_id,
    })
  }
  if (
    templateKey === 'commande_confirmee'
    && !product.delivery_estimate?.trim()
    && !settings.delai_estime_par_defaut.trim()
  ) {
    throw new OrderMessageError('Le délai estimé du produit et le délai par défaut ne sont pas renseignés.', 503)
  }
  if (templateKey === 'remboursement' && !settings.refund_delay.trim()) {
    throw new OrderMessageError('Renseignez le délai de remboursement dans les réglages des messages.', 400)
  }

  const extra = validateExtraVariables(templateKey, extraVariables)
  const variantLines = (lines ?? []) as OrderMessageVariantLine[]
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '')
  if (!siteUrl && templateKey === 'commande_confirmee') {
    throw new OrderMessageError('L’adresse du site n’est pas configurée pour créer le lien de suivi.', 503)
  }

  const variables: OrderMessageVariables = {
    ...extra,
    prenom: customerFirstName(fullName),
    montant: formatFcfa(Number(order.total_price)),
    numero_commande: order.jalims_code,
    liste_produits: formatOrderProductList(product.name, order.quantity, variantLines),
    delai_estime: product.delivery_estimate?.trim() || settings.delai_estime_par_defaut.trim(),
    lien_commande: siteUrl ? `${siteUrl}/orders` : '',
    whatsapp_jalims: settings.whatsapp_jalims.trim(),
    point_retrait: settings.pickup_address.trim(),
    horaires: settings.pickup_hours.trim(),
    code_retrait: order.jalims_code,
    delai_signalement: `${settings.reporting_delay_hours} heures`,
    delai_remboursement: settings.refund_delay.trim(),
  }
  const rendered = renderOrderMessage(template, variables)
  const warnings = [
    ...(!settings.reply_to.trim() ? ['Aucune adresse Reply-To n’est configurée.'] : []),
    ...(!settings.whatsapp_jalims.trim() ? ['Le numéro WhatsApp Jalims n’est pas renseigné.'] : []),
  ]

  return {
    orderId: order.id,
    templateKey,
    to: email,
    customerPhone: typeof profile?.phone === 'string' ? profile.phone : '',
    from: settings.from_email,
    replyTo: settings.reply_to.trim(),
    ...rendered,
    warnings,
  }
}

async function reserveMessageLog(
  supabase: SupabaseClient,
  orderId: string,
  templateKey: OrderMessageTemplateKey,
  source: MessageSource,
  channel: 'email' | 'whatsapp' = 'email',
  status: 'en_cours' | 'prepare' = 'en_cours',
) {
  const { data, error } = await supabase
    .from('order_messages')
    .insert({
      order_id: orderId,
      template_key: templateKey,
      channel,
      source,
      status,
    })
    .select('id')
    .single()

  if (error) {
    if (source === 'automatic' && error.code === '23505') return null
    throwDatabaseError('Message journal reservation failed', error)
  }
  if (!data) throw new OrderMessageError('Le journal n’a pas confirmé la réservation du message.', 500)

  return data.id
}

export async function prepareOrderWhatsApp(
  orderId: string,
  templateKey: OrderMessageTemplateKey,
  extraVariables: unknown = {},
) {
  const prepared = await prepareOrderMessage(orderId, templateKey, extraVariables)
  const phone = normalizeSenegalPhone(prepared.customerPhone)
  if (!phone) {
    throw new OrderMessageError('Le numéro du client est manquant ou invalide. Corrigez son profil avant de préparer WhatsApp.', 400)
  }

  const supabase = createSupabaseAdminClient()
  const messageId = await reserveMessageLog(
    supabase,
    orderId,
    templateKey,
    'manual',
    'whatsapp',
    'prepare',
  )
  if (!messageId) {
    throw new OrderMessageError('Ce message WhatsApp a déjà été préparé.', 409)
  }

  return {
    messageId,
    url: `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(prepared.text)}`,
    warnings: prepared.warnings,
  }
}

async function markMessageFailed(supabase: SupabaseClient, messageId: string, error: unknown) {
  const message = error instanceof Error ? error.message : 'Erreur d’envoi inconnue.'
  const { error: updateError } = await supabase
    .from('order_messages')
    .update({ status: 'echec', error: message })
    .eq('id', messageId)

  if (updateError) {
    console.error('[Order messages] Failed to mark message as failed', {
      messageId,
      error: updateError.message,
    })
  }
}

export async function sendOrderEmail(
  orderId: string,
  templateKey: OrderMessageTemplateKey,
  source: MessageSource,
  extraVariables: unknown = {},
) {
  const supabase = createSupabaseAdminClient()
  const messageId = await reserveMessageLog(supabase, orderId, templateKey, source)
  if (!messageId) return { alreadyAttempted: true as const }

  let providerAccepted = false
  try {
    const prepared = await prepareOrderMessage(orderId, templateKey, extraVariables)
    const apiKey = process.env.RESEND_API_KEY?.trim()
    if (!apiKey) {
      throw new OrderMessageError('Le service d’envoi n’est pas configuré : RESEND_API_KEY est absente.', 503)
    }

    const resend = new Resend(apiKey)
    const { data, error } = await resend.emails.send({
      from: prepared.from,
      to: prepared.to,
      subject: prepared.subject,
      text: prepared.text,
      html: prepared.html,
      ...(prepared.replyTo ? { replyTo: prepared.replyTo } : {}),
    })
    if (error) throw new Error(error.message)
    if (!data?.id) throw new Error('Resend n’a retourné aucun identifiant pour cet envoi.')
    providerAccepted = true

    const { error: updateError } = await supabase
      .from('order_messages')
      .update({
        status: 'envoye',
        provider_message_id: data.id,
        sent_at: new Date().toISOString(),
        error: null,
      })
      .eq('id', messageId)
    if (updateError) {
      console.error('[Order messages] Email sent but journal update failed', {
        messageId,
        providerMessageId: data.id,
        error: updateError.message,
      })
      throw new OrderMessageError('Le courriel a été accepté, mais son journal n’a pas pu être mis à jour. Vérifiez le tableau de bord Resend avant tout nouvel envoi.', 500)
    }

    return {
      alreadyAttempted: false as const,
      messageId,
      providerMessageId: data.id,
      warnings: prepared.warnings,
    }
  } catch (error) {
    if (!providerAccepted) await markMessageFailed(supabase, messageId, error)
    throw error
  }
}

export async function sendAutomaticOrderConfirmation(orderId: string) {
  return sendOrderEmail(orderId, 'commande_confirmee', 'automatic')
}
