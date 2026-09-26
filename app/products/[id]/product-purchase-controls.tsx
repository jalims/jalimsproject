'use client'

import Link from 'next/link'
import { useState } from 'react'

export default function ProductPurchaseControls({ productId, minimumQuantity, unavailable }: { productId: string; minimumQuantity: number; unavailable: boolean }) {
  const [quantity, setQuantity] = useState(minimumQuantity)
  const checkoutUrl = `/checkout?product=${encodeURIComponent(productId)}&quantity=${quantity}`

  return (
    <div className="detail-purchase">
      <div className="detail-quantity-block">
        <span>Quantité</span>
        <div className="quantity-control" aria-label="Choisir la quantité">
          <button type="button" aria-label="Diminuer la quantité" onClick={() => setQuantity((value) => Math.max(minimumQuantity, value - 1))}>−</button>
          <span aria-live="polite">{quantity}</span>
          <button type="button" aria-label="Augmenter la quantité" onClick={() => setQuantity((value) => value + 1)}>+</button>
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