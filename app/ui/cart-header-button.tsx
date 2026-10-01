'use client'

import Link from 'next/link'
import { ShoppingCart } from 'lucide-react'
import { useEffect, useState } from 'react'
import { readVariantCart, subscribeToVariantCart } from '../../lib/variant-cart'

export default function CartHeaderButton() {
  const [itemCount, setItemCount] = useState(0)

  useEffect(() => {
    function refreshCount() {
      setItemCount(readVariantCart()?.lines.reduce((total, line) => total + line.quantity, 0) ?? 0)
    }

    refreshCount()
    return subscribeToVariantCart(refreshCount)
  }, [])

  return (
    <Link className="cart-header-button" href="/panier" aria-label={`Panier, ${itemCount} article${itemCount === 1 ? '' : 's'}`} title="Voir le panier">
      <ShoppingCart aria-hidden="true" size={21} strokeWidth={2} />
      <span className="cart-header-badge" aria-live="polite">{itemCount > 99 ? '99+' : itemCount}</span>
    </Link>
  )
}