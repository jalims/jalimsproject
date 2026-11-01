type ProductEventType = 'view' | 'add_to_cart' | 'favorite'

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
  if (term.includes('@')) return true

  const phoneCandidates = term.match(/(?:^|[^\p{L}\p{N}])\+?\d(?:[\d\s()./-]*\d)(?=$|[^\p{L}\p{N}])/gu) ?? []
  return phoneCandidates.some((candidate) => (candidate.match(/\d/g) ?? []).length >= 7)
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
    sendEvent({ type: 'search', term: searchTerm, result_count: resultCount })
  } catch {
    console.warn('[Analytics] Search event could not be sent')
  }
}

export function trackProductEvent(type: ProductEventType, productId: string) {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productId)) return

  try {
    sendEvent({ type, product_id: productId })
  } catch {
    console.warn('[Analytics] Product event could not be sent')
  }
}
