'use client'

import Link from 'next/link'
import { useState } from 'react'
import QuantityInput from '../../ui/quantity-input'

export default function ProductPurchaseControls({ productId, minimumQuantity, unavailable }: { productId: string; minimumQuantity: number; unavailable: boolean }) {
  const [quantity, setQuantity] = useState(String(minimumQuantity))
  const parsedQuantity = Number.parseInt(quantity, 10)
  const orderQuantity = Number.isFinite(parsedQuantity) ? Math.max(minimumQuantity, parsedQuantity) : minimumQuantity
  const checkoutUrl = `/checkout?product=${encodeURIComponent(productId)}&quantity=${orderQuantity}`

  return (
    <div className="detail-purchase">
      <div className="detail-quantity-block">
        <span>Quantité</span>
        <div className="quantity-control" aria-label="Choisir la quantité">
          <button type="button" aria-label="Diminuer la quantité" onClick={() => setQuantity(String(Math.max(minimumQuantity, (Number(quantity) || minimumQuantity) - 1)))}>−</button>
          <QuantityInput ariaLabel="Quantité" minimum={minimumQuantity} value={quantity} onChange={setQuantity} />
          <button type="button" aria-label="Augmenter la quantité" onClick={() => setQuantity(String((Number(quantity) || minimumQuantity) + 1))}>+</button>
        </div>
      </div>
      {unavailable ? (
        <button className="order-button detail-order-button" type="button" disabled>Indisponible</button>
      ) : (
        <Link className="order-button detail-order-button" href={checkoutUrl}>
          Continuer vers la commande <span aria-hidden="true">→</span>
        </Link>
      )}
    </div>
  )
}