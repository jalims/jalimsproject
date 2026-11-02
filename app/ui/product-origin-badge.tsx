import { hasFreshLocalStock } from '../../lib/product-origin'

type ProductOriginBadgeProps = {
  origin: string
  localStock: number | null
  city: string | null
  deliveryDelay: string | null
  stockUpdatedAt: string | null
}

export default function ProductOriginBadge({
  origin,
  localStock,
  city,
  deliveryDelay,
  stockUpdatedAt,
}: ProductOriginBadgeProps) {
  const hasLocalStock = hasFreshLocalStock({
    origin,
    local_stock: localStock,
    stock_updated_at: stockUpdatedAt,
  })

  if (hasLocalStock) {
    return (
      <div className="product-origin-indicator">
        <span className="product-origin-badge product-origin-badge-local">🇸🇳 Disponible au Sénégal</span>
        <p className="product-origin-details">
          {city?.trim() || 'Ville à confirmer'} · livraison {deliveryDelay?.trim() || 'à confirmer'}
        </p>
      </div>
    )
  }

  if (origin === 'import') {
    return (
      <div className="product-origin-indicator">
        <span className="product-origin-badge product-origin-badge-import">Import Chine</span>
      </div>
    )
  }

  return null
}
