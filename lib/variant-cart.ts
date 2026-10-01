export type VariantCartLine = {
  variantId: string
  quantity: number
}

export type VariantCart = {
  productId: string
  lines: VariantCartLine[]
}

const storageKey = 'jalims-variant-cart-v1'
const cartUpdatedEvent = 'jalims:variant-cart-updated'

export function readVariantCart(): VariantCart | null {
  try {
    const stored = localStorage.getItem(storageKey)
    if (!stored) return null

    const cart = JSON.parse(stored) as VariantCart
    if (!cart.productId || !Array.isArray(cart.lines)) return null

    return {
      productId: cart.productId,
      lines: cart.lines.filter((line) => (
        typeof line.variantId === 'string'
        && Number.isInteger(line.quantity)
        && line.quantity > 0
      )),
    }
  } catch {
    return null
  }
}

export function saveVariantCart(cart: VariantCart) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(cart))
    window.dispatchEvent(new Event(cartUpdatedEvent))
  } catch {
    return
  }
}

export function clearVariantCart() {
  try {
    localStorage.removeItem(storageKey)
    window.dispatchEvent(new Event(cartUpdatedEvent))
  } catch {
    return
  }
}

export function subscribeToVariantCart(callback: () => void) {
  window.addEventListener(cartUpdatedEvent, callback)
  window.addEventListener('storage', callback)
  return () => {
    window.removeEventListener(cartUpdatedEvent, callback)
    window.removeEventListener('storage', callback)
  }
}