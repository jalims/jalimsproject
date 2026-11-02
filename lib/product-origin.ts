const LOCAL_STOCK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

type LocalStockProduct = {
  origin: string
  local_stock: number | null
  stock_updated_at: string | null
}

export function hasFreshLocalStock(product: LocalStockProduct): boolean {
  if (product.origin !== 'local' || !product.local_stock || !product.stock_updated_at) return false

  const updatedAt = Date.parse(product.stock_updated_at)
  return Number.isFinite(updatedAt) && Date.now() - updatedAt <= LOCAL_STOCK_MAX_AGE_MS
}
