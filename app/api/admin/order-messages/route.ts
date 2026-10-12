import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { hasJalimsAdminAccess } from '../../../../lib/admin-access'
import {
  OrderMessageError,
  prepareOrderMessage,
  prepareOrderWhatsApp,
  sendOrderEmail,
} from '../../../../lib/order-message-service'
import { createSupabaseAdminClient } from '../../../../lib/paytech-admin'
import {
  isAllowedOrderMessageSender,
  isOrderMessageTemplateKey,
  isValidOrderMessageReplyTo,
  normalizeSenegalPhone,
  ORDER_MESSAGE_SAMPLE_VARIABLES,
  ORDER_MESSAGE_TEMPLATE_KEYS,
  renderOrderMessage,
} from '../../../../lib/order-messages'

const templateNames = {
  commande_confirmee: 'Commande confirmée',
  en_transit: 'En transit',
  prete_a_retirer: 'Prête à retirer',
  retard: 'Retard de livraison',
  remboursement: 'Remboursement',
} as const

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

async function authorizeAdmin(request: Request) {
  const accessToken = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!accessToken) {
    return { response: jsonError('Connectez-vous avec le compte administrateur pour continuer.', 401) }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) {
    console.error('[Order messages] Supabase public environment is not configured')
    return { response: jsonError('Le service de messages n’est pas configuré correctement.', 500) }
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await authClient.auth.getUser(accessToken)
  if (error) {
    console.error('[Order messages] Admin authentication failed', error.message)
    return { response: jsonError('Votre session n’a pas pu être vérifiée. Reconnectez-vous puis réessayez.', 401) }
  }
  if (!hasJalimsAdminAccess(data.user)) {
    return { response: jsonError('Ce compte ne dispose pas des droits administrateur.', 403) }
  }

  return { user: data.user }
}

export async function GET(request: Request) {
  const authorization = await authorizeAdmin(request)
  if ('response' in authorization) return authorization.response

  try {
    const supabase = createSupabaseAdminClient()
    const [{ data: templates, error: templatesError }, { data: settings, error: settingsError }] = await Promise.all([
      supabase.from('order_message_templates')
        .select('template_key, name, subject, body, active')
        .order('template_key'),
      supabase.from('order_message_settings')
        .select('pickup_address, pickup_hours, whatsapp_jalims, from_email, reply_to, reporting_delay_hours, refund_delay, delai_estime_par_defaut')
        .eq('id', 1)
        .maybeSingle(),
    ])
    if (templatesError || settingsError) {
      console.error('[Order messages] Configuration load failed', {
        templates: templatesError?.message,
        settings: settingsError?.message,
      })
      return jsonError('Impossible de charger les modèles ou les réglages des messages.', 500)
    }
    if (!settings || templates?.length !== ORDER_MESSAGE_TEMPLATE_KEYS.length) {
      return jsonError('Les modèles ou les réglages des messages ne sont pas encore configurés.', 503)
    }

    return NextResponse.json({ templates, settings })
  } catch (error) {
    console.error('[Order messages] Configuration load failed', error)
    return jsonError('Impossible de charger les modèles ou les réglages des messages.', 500)
  }
}

export async function PUT(request: Request) {
  const authorization = await authorizeAdmin(request)
  if ('response' in authorization) return authorization.response

  let body: unknown
  try {
    body = await request.json()
  } catch (error) {
    console.error('[Order messages] Invalid configuration JSON', {
      errorName: error instanceof Error ? error.name : 'unknown',
    })
    return jsonError('Les réglages reçus sont illisibles.', 400)
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return jsonError('Les réglages reçus sont invalides.', 400)
  }

  const payload = body as Record<string, unknown>
  if (!Array.isArray(payload.templates) || payload.templates.length !== ORDER_MESSAGE_TEMPLATE_KEYS.length) {
    return jsonError('Les cinq modèles de message doivent être renseignés.', 400)
  }
  if (typeof payload.settings !== 'object' || payload.settings === null || Array.isArray(payload.settings)) {
    return jsonError('Les réglages généraux sont invalides.', 400)
  }

  const templateRows = new Map<string, { template_key: string; name: string; subject: string; body: string; active: boolean }>()
  for (const item of payload.templates) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return jsonError('Un modèle de message est invalide.', 400)
    }
    const row = item as Record<string, unknown>
    if (!isOrderMessageTemplateKey(row.template_key) || templateRows.has(row.template_key)) {
      return jsonError('Une clé de modèle est inconnue ou présente plusieurs fois.', 400)
    }
    if (
      typeof row.subject !== 'string' || !row.subject.trim() || row.subject.length > 200
      || typeof row.body !== 'string' || !row.body.trim() || row.body.length > 10000
      || typeof row.active !== 'boolean'
    ) {
      return jsonError(`L’objet, le corps ou l’état du modèle « ${row.template_key} » est invalide.`, 400)
    }
    try {
      renderOrderMessage({
        template_key: row.template_key,
        subject: row.subject,
        body: row.body,
      }, ORDER_MESSAGE_SAMPLE_VARIABLES)
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : 'Le modèle contient une variable invalide.', 400)
    }
    templateRows.set(row.template_key, {
      template_key: row.template_key,
      name: templateNames[row.template_key],
      subject: row.subject.trim(),
      body: row.body.trim(),
      active: row.active,
    })
  }

  const settingsInput = payload.settings as Record<string, unknown>
  const settingTextFields = [
    'pickup_address',
    'pickup_hours',
    'whatsapp_jalims',
    'from_email',
    'reply_to',
    'refund_delay',
    'delai_estime_par_defaut',
  ] as const
  if (settingTextFields.some((field) => typeof settingsInput[field] !== 'string')) {
    return jsonError('Tous les champs de réglage doivent être du texte.', 400)
  }
  const settings = Object.fromEntries(
    settingTextFields.map((field) => [field, (settingsInput[field] as string).trim()]),
  ) as Record<(typeof settingTextFields)[number], string>
  const reportingDelay = settingsInput.reporting_delay_hours
  if (
    typeof reportingDelay !== 'number' || !Number.isInteger(reportingDelay)
    || reportingDelay < 1 || reportingDelay > 720
  ) {
    return jsonError('Le délai de signalement doit être un nombre d’heures compris entre 1 et 720.', 400)
  }
  if (!settings.delai_estime_par_defaut || settings.delai_estime_par_defaut.length > 120) {
    return jsonError('Le délai estimé par défaut doit être renseigné (120 caractères maximum).', 400)
  }
  if (!isAllowedOrderMessageSender(settings.from_email)) {
    return jsonError('L’expéditeur doit être une adresse valide qui se termine par @jalims.com.', 400)
  }
  if (settings.reply_to && !isValidOrderMessageReplyTo(settings.reply_to)) {
    return jsonError('L’adresse Reply-To est invalide.', 400)
  }
  if (settings.whatsapp_jalims && !normalizeSenegalPhone(settings.whatsapp_jalims)) {
    return jsonError('Le numéro WhatsApp Jalims doit être un numéro sénégalais valide.', 400)
  }
  if (settings.pickup_address.length > 500 || settings.pickup_hours.length > 500 || settings.refund_delay.length > 200) {
    return jsonError('Un réglage dépasse la longueur maximale autorisée.', 400)
  }

  try {
    const supabase = createSupabaseAdminClient()
    const { error: settingsError } = await supabase.from('order_message_settings').upsert({
      id: 1,
      ...settings,
      reporting_delay_hours: reportingDelay,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
    if (settingsError) {
      console.error('[Order messages] Configuration settings save failed', settingsError.message)
      return jsonError('Les réglages généraux n’ont pas pu être enregistrés.', 500)
    }

    const { error: templatesError } = await supabase
      .from('order_message_templates')
      .upsert([...templateRows.values()], { onConflict: 'template_key' })
    if (templatesError) {
      console.error('[Order messages] Message templates save failed', templatesError.message)
      return jsonError('Les modèles n’ont pas pu être enregistrés. Vérifiez leur état puis réessayez.', 500)
    }

    return NextResponse.json({ message: 'Les modèles et réglages des messages ont été enregistrés.' })
  } catch (error) {
    console.error('[Order messages] Configuration save failed', error)
    return jsonError('Les modèles et réglages des messages n’ont pas pu être enregistrés.', 500)
  }
}

export async function POST(request: Request) {
  const authorization = await authorizeAdmin(request)
  if ('response' in authorization) return authorization.response

  let body: unknown
  try {
    body = await request.json()
  } catch (error) {
    console.error('[Order messages] Invalid JSON request body', {
      errorName: error instanceof Error ? error.name : 'unknown',
    })
    return jsonError('La requête de message est illisible.', 400)
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return jsonError('La requête de message est invalide.', 400)
  }

  const payload = body as Record<string, unknown>
  if (payload.action !== 'preview' && payload.action !== 'send' && payload.action !== 'prepare-whatsapp') {
    return jsonError('Cette opération de message n’est pas reconnue.', 400)
  }
  if (typeof payload.orderId !== 'string' || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(payload.orderId)) {
    return jsonError('La référence de commande est invalide.', 400)
  }
  if (!isOrderMessageTemplateKey(payload.templateKey)) {
    return jsonError('Le modèle de message sélectionné est invalide.', 400)
  }

  try {
    if (payload.action === 'preview') {
      const prepared = await prepareOrderMessage(
        payload.orderId,
        payload.templateKey,
        payload.variables,
      )
      return NextResponse.json({
        subject: prepared.subject,
        text: prepared.text,
        html: prepared.html,
        warnings: prepared.warnings,
      })
    }

    if (payload.action === 'prepare-whatsapp') {
      const result = await prepareOrderWhatsApp(
        payload.orderId,
        payload.templateKey,
        payload.variables,
      )
      return NextResponse.json({
        message: 'Le message WhatsApp est prêt à être ouvert.',
        messageId: result.messageId,
        url: result.url,
        warnings: result.warnings,
      })
    }

    const result = await sendOrderEmail(
      payload.orderId,
      payload.templateKey,
      'manual',
      payload.variables,
    )
    if (result.alreadyAttempted) {
      return jsonError('Ce message a déjà été réservé pour envoi.', 409)
    }

    return NextResponse.json({
      message: 'Le courriel a été accepté pour envoi.',
      messageId: result.messageId,
      providerMessageId: result.providerMessageId,
      warnings: result.warnings,
    })
  } catch (error) {
    if (error instanceof OrderMessageError) return jsonError(error.message, error.status)
    console.error('[Order messages] Admin request failed', error)
    return jsonError('Le message n’a pas pu être préparé ou envoyé. Réessayez.', 500)
  }
}
