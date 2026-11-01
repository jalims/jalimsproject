import { createSupabaseAdminClient } from '../../../lib/paytech-admin'
import { NextResponse, type NextRequest } from 'next/server'

const visitorCookieName = 'jalims_visitor'
const visitorCookieMaxAge = 60 * 60 * 24 * 30 * 13
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const maximumBodyBytes = 1024

type SearchEvent = { type: 'search'; term: string; result_count: number }
type ProductEvent = { type: 'view' | 'add_to_cart' | 'favorite'; product_id: string }

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function normalizeSearchTerm(term: string) {
  return term
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('fr-FR')
}

function containsLikelyPersonalSearchTerm(term: string) {
  if (term.includes('@')) return true

  const phoneCandidates = term.match(/(?:^|[^\p{L}\p{N}])\+?\d(?:[\d\s()./-]*\d)(?=$|[^\p{L}\p{N}])/gu) ?? []
  return phoneCandidates.some((candidate) => (candidate.match(/\d/g) ?? []).length >= 7)
}

function hasExactKeys(payload: Record<string, unknown>, keys: string[]) {
  return Object.keys(payload).length === keys.length && keys.every((key) => Object.hasOwn(payload, key))
}

function setVisitorCookie(response: NextResponse, signedVisitorId: string, secure: boolean) {
  response.cookies.set(visitorCookieName, signedVisitorId, {
    maxAge: visitorCookieMaxAge,
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure,
  })
}

async function getVisitorSigningKey() {
  const secret = process.env.ANALYTICS_VISITOR_SECRET
  if (!secret || new TextEncoder().encode(secret).byteLength < 32) {
    throw new Error('ANALYTICS_VISITOR_SECRET must contain at least 32 bytes')
  }

  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

function toBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
}

async function signVisitorId(visitorId: string, key: CryptoKey) {
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(visitorId))
  return `${visitorId}.${toBase64Url(new Uint8Array(signature))}`
}

async function verifyVisitorCookie(value: string | undefined, key: CryptoKey) {
  if (!value) return null
  const [visitorId, signature, ...extraParts] = value.split('.')
  if (!uuidPattern.test(visitorId ?? '') || !signature || extraParts.length > 0) return null

  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      fromBase64Url(signature),
      new TextEncoder().encode(visitorId),
    )
    return valid ? visitorId : null
  } catch {
    return null
  }
}

async function readLimitedBody(request: NextRequest) {
  const reader = request.body?.getReader()
  if (!reader) return ''

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > maximumBodyBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? ''
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return errorResponse('Le format de la demande est invalide.', 415)
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (declaredLength > maximumBodyBytes) {
    return errorResponse('La demande dépasse la taille autorisée.', 413)
  }

  let rawBody: string | null
  try {
    rawBody = await readLimitedBody(request)
  } catch {
    return errorResponse('La demande est illisible.', 400)
  }
  if (rawBody === null) {
    return errorResponse('La demande dépasse la taille autorisée.', 413)
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return errorResponse('Le format JSON de la demande est invalide.', 400)
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return errorResponse('La demande est invalide.', 400)
  }

  const payload = body as Record<string, unknown>
  let event: SearchEvent | ProductEvent
  if (payload.type === 'search') {
    if (!hasExactKeys(payload, ['type', 'term', 'result_count'])
      || typeof payload.term !== 'string'
      || Array.from(payload.term).length < 1
      || Array.from(payload.term).length > 80
      || payload.term !== payload.term.trim()
      || containsLikelyPersonalSearchTerm(payload.term)
      || typeof payload.result_count !== 'number'
      || !Number.isInteger(payload.result_count)
      || payload.result_count < 0
      || payload.result_count > 1000000
    ) {
      return errorResponse('Les données de recherche sont invalides.', 400)
    }

    const normalizedTerm = normalizeSearchTerm(payload.term)
    if (!normalizedTerm || Array.from(normalizedTerm).length > 80) {
      return errorResponse('Le terme de recherche est invalide.', 400)
    }
    event = { type: 'search', term: normalizedTerm, result_count: payload.result_count }
  } else if (payload.type === 'view' || payload.type === 'add_to_cart' || payload.type === 'favorite') {
    if (!hasExactKeys(payload, ['type', 'product_id'])
      || typeof payload.product_id !== 'string'
      || !uuidPattern.test(payload.product_id)
    ) {
      return errorResponse('Les données du produit sont invalides.', 400)
    }
    event = { type: payload.type, product_id: payload.product_id }
  } else {
    return errorResponse('Ce type d’événement n’est pas autorisé.', 400)
  }

  const secure = new URL(request.url).protocol === 'https:'
  const cookieVisitorId = request.cookies.get(visitorCookieName)?.value

  try {
    const signingKey = await getVisitorSigningKey()
    const verifiedVisitorId = await verifyVisitorCookie(cookieVisitorId, signingKey)
    const visitorId = verifiedVisitorId ?? crypto.randomUUID()
    const signedVisitorId = verifiedVisitorId ? null : await signVisitorId(visitorId, signingKey)
    const supabase = createSupabaseAdminClient()
    const { data, error } = await supabase.rpc('record_analytics_event', {
      p_event_type: event.type,
      p_visitor_id: visitorId,
      p_product_id: event.type === 'search' ? null : event.product_id,
      p_search_term: event.type === 'search' ? event.term : null,
      p_result_count: event.type === 'search' ? event.result_count : null,
    })
    if (error) {
      console.error('[Analytics] Event recording failed')
      return errorResponse('Le suivi est momentanément indisponible.', 503)
    }
    if (data === 'invalid_product') {
      return errorResponse('Le produit demandé n’existe pas.', 404)
    }
    if (data === 'rate_limited') {
      const limitedResponse = errorResponse('Trop d’événements ont été envoyés. Réessayez plus tard.', 429)
      if (signedVisitorId) {
        setVisitorCookie(limitedResponse, signedVisitorId, secure)
      }
      return limitedResponse
    }
    if (data !== 'recorded') {
      console.error('[Analytics] Event recording returned an unexpected result')
      return errorResponse('Le suivi est momentanément indisponible.', 503)
    }

    const response = new NextResponse(null, { status: 204 })
    if (signedVisitorId) {
      setVisitorCookie(response, signedVisitorId, secure)
    }
    return response
  } catch {
    console.error('[Analytics] Event endpoint failed')
    return errorResponse('Le suivi est momentanément indisponible.', 503)
  }
}
