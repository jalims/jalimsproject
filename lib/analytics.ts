const visitorCookieName = 'jalims_visitor'
const visitorCookieMaxAge = 60 * 60 * 24 * 30 * 13

type ProductEventType = 'view' | 'add_to_cart' | 'favorite'

function getVisitorId() {
  const existing = document.cookie
    .split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${visitorCookieName}=`))
    ?.slice(visitorCookieName.length + 1)

  if (existing && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)) {
    return existing
  }

  const visitorId = crypto.randomUUID()
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${visitorCookieName}=${visitorId}; Path=/; Max-Age=${visitorCookieMaxAge}; SameSite=Lax${secure}`
  return visitorId
}

function normalizeSearchTerm(term: string) {
  const normalized = term
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('fr-FR')
  return Array.from(normalized).slice(0, 80).join('')
}

function isSensitiveSearchTerm(term: string) {
  return term.includes('@') || /\d{7,}/.test(term)
}

function sendEvent(payload: Record<string, string | number>) {
  try {
    const body = JSON.stringify(payload)
    const beaconBody = new Blob([body], { type: 'application/json' })
    if (navigator.sendBeacon('/api/track', beaconBody)) return

    void fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'same-origin',
    }).catch(() => console.warn('[Analytics] Event request failed'))
  } catch {
    console.warn('[Analytics] Event could not be sent')
  }
}

export function trackSearch(term: string, resultCount: number) {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return

  const searchTerm = normalizeSearchTerm(term)
  if (!searchTerm || isSensitiveSearchTerm(searchTerm)) return

  try {
    getVisitorId()
    sendEvent({ type: 'search', term: searchTerm, result_count: resultCount })
  } catch {
    console.warn('[Analytics] Search event could not be sent')
  }
}

export function trackProductEvent(type: ProductEventType, productId: string) {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productId)) return

  try {
    getVisitorId()
    sendEvent({ type, product_id: productId })
  } catch {
    console.warn('[Analytics] Product event could not be sent')
  }
}
