'use client'

import Link from 'next/link'
import { useState } from 'react'
import QuantityInput from '../../ui/quantity-input'

type VariantAttribute = {
  key: string
  label: string
  values: string[]
}

type ProductVariant = {
  id: string
  attributeValues: Record<string, string>
  stock: number
  priceAdjustment: number
}

type ProductPurchaseControlsProps = {
  attributes: VariantAttribute[]
  basePrice: number
  initialQuantity: number
  minimumQuantity: number
  productId: string
  unavailable: boolean
  variants: ProductVariant[]
}

export default function ProductPurchaseControls({ attributes, basePrice, initialQuantity, minimumQuantity, productId, unavailable, variants }: ProductPurchaseControlsProps) {
  const [quantity, setQuantity] = useState(String(Math.max(minimumQuantity, initialQuantity)))
  const [selectedValues, setSelectedValues] = useState<Record<string, string>>({})
  const parsedQuantity = Number.parseInt(quantity, 10)
  const orderQuantity = Number.isFinite(parsedQuantity) ? Math.max(minimumQuantity, parsedQuantity) : minimumQuantity
  const selectedVariant = attributes.length > 0
    ? variants.find((variant) => attributes.every((attribute) => selectedValues[attribute.key] === variant.attributeValues[attribute.key]))
    : undefined
  const variantStockUnavailable = attributes.length > 0 && (!selectedVariant || selectedVariant.stock <= 0)
  const quantityUnavailable = selectedVariant !== undefined && orderQuantity > selectedVariant.stock
  const isUnavailable = attributes.length > 0 ? variantStockUnavailable || quantityUnavailable : unavailable
  const checkoutParams = new URLSearchParams({ product: productId, quantity: String(orderQuantity) })
  if (selectedVariant) checkoutParams.set('variant', JSON.stringify(selectedValues))
  const checkoutUrl = `/checkout?${checkoutParams.toString()}`

  return (
    <div className="detail-purchase">
      {attributes.map((attribute) => (
        <label className="variant-selector" key={attribute.key}>
          <span>{attribute.label}</span>
          <select
            value={selectedValues[attribute.key] ?? ''}
            onChange={(event) => setSelectedValues((current) => ({ ...current, [attribute.key]: event.target.value }))}
            required
          >
            <option value="">Choisir {attribute.label.toLocaleLowerCase()}</option>
            {attribute.values.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      ))}
      {selectedVariant && selectedVariant.priceAdjustment !== 0 && (
        <p className="variant-price">Prix de cette variante : {(basePrice + selectedVariant.priceAdjustment).toLocaleString('fr-FR')} FCFA</p>
      )}
      {attributes.length > 0 && selectedVariant?.stock === 0 && (
        <p className="variant-stock-message" role="status">Rupture de stock pour cette combinaison.</p>
      )}
      {quantityUnavailable && selectedVariant && (
        <p className="variant-stock-message" role="status">Stock disponible pour cette combinaison : {selectedVariant.stock}.</p>
      )}
      <div className="detail-quantity-block">
        <span>Quantité</span>
        <div className="quantity-control" aria-label="Choisir la quantité">
          <button type="button" aria-label="Diminuer la quantité" onClick={() => setQuantity(String(Math.max(minimumQuantity, (Number(quantity) || minimumQuantity) - 1)))}>−</button>
          <QuantityInput ariaLabel="Quantité" minimum={minimumQuantity} value={quantity} onChange={setQuantity} />
          <button type="button" aria-label="Augmenter la quantité" onClick={() => setQuantity(String((Number(quantity) || minimumQuantity) + 1))}>+</button>
        </div>
      </div>
      {isUnavailable ? (
        <button className="order-button detail-order-button" type="button" disabled>
          {attributes.length > 0 && !selectedVariant ? 'Choisir une variante' : attributes.length > 0 ? 'Indisponible' : 'Indisponible'}
        </button>
      ) : (
        <Link className="order-button detail-order-button" href={checkoutUrl}>
          Continuer vers la commande <span aria-hidden="true">→</span>
        </Link>
      )}
    </div>
  )
}