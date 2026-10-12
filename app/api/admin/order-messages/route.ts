import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { hasJalimsAdminAccess } from '../../../../lib/admin-access'
import {
  OrderMessageError,
  prepareOrderMessage,
  sendOrderEmail,
} from '../../../../lib/order-message-service'
import { isOrderMessageTemplateKey } from '../../../../lib/order-messages'

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
  if (payload.action !== 'preview' && payload.action !== 'send') {
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
