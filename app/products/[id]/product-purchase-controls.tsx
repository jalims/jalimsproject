'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import QuantityInput from '../../ui/quantity-input'
import { readVariantCart, saveVariantCart } from '../../../lib/variant-cart'

type VariantAttribute = {
  key: string
  label: string
  values: string[]
}

type ProductVariant = {
  id: string
  attributeValues: Record<string, string>
  stock: number | null
  priceAdjustment: number
}

type ProductPurchaseControlsProps = {
  attributes: VariantAttribute[]
  basePrice: number
  colorValues: Record<string, string>
  initialQuantity: number
  minimumQuantity: number
  productId: string
  unavailable: boolean
  variants: ProductVariant[]
}

export default function ProductPurchaseControls({ attributes, basePrice, colorValues, initialQuantity, minimumQuantity, productId, unavailable, variants }: ProductPurchaseControlsProps) {
  const router = useRouter()
  const [quantity, setQuantity] = useState(String(Math.max(minimumQuantity, initialQuantity)))
  const [variantQuantities, setVariantQuantities] = useState<Record<string, string>>({})
  const [cartMessage, setCartMessage] = useState('')
  const parsedQuantity = Number.parseInt(quantity, 10)
  const orderQuantity = Number.isFinite(parsedQuantity) ? Math.max(minimumQuantity, parsedQuantity) : minimumQuantity
  const checkoutParams = new URLSearchParams({ product: productId, quantity: String(orderQuantity) })
  const checkoutUrl = `/checkout?${checkoutParams.toString()}`

  function addVariantLinesToCart() {
    setCartMessage('')
    const cart = readVariantCart()
    if (cart && cart.productId !== productId) {
      setCartMessage('Le panier contient déjà un autre produit. Finalisez ou videz-le avant d’ajouter celui-ci.')
      return
    }

    const lines = new Map((cart?.lines ?? []).map((line) => [line.variantId, line.quantity]))
    let addedQuantity = 0
    let skippedLines = 0

    for (const variant of variants) {
      const requestedQuantity = Number.parseInt(variantQuantities[variant.id] ?? '0', 10)
      if (!Number.isInteger(requestedQuantity) || requestedQuantity <= 0) continue

      const nextQuantity = (lines.get(variant.id) ?? 0) + requestedQuantity
      if (variant.stock !== null && nextQuantity > variant.stock) {
        skippedLines += 1
        continue
      }

      lines.set(variant.id, nextQuantity)
      addedQuantity += requestedQuantity
    }

    if (addedQuantity === 0) {
      setCartMessage(skippedLines > 0
        ? 'Les quantités demandées dépassent le stock des combinaisons concernées.'
        : 'Indique une quantité supérieure à zéro pour ajouter une combinaison.')
      return
    }

    saveVariantCart({
      productId,
      lines: [...lines].map(([variantId, lineQuantity]) => ({ variantId, quantity: lineQuantity })),
    })

    if (skippedLines > 0) {
      setCartMessage(`${addedQuantity} unité(s) ajoutée(s). ${skippedLines} combinaison(s) ignorée(s), stock insuffisant.`)
      return
    }

    router.push('/panier')
  }

  return (
    <div className="detail-purchase">
      {attributes.length > 0 ? (
        <>
          <div className="variant-quantity-table-wrap">
            <table className="variant-quantity-table">
              <thead><tr><th>Combinaison</th><th>Prix unitaire</th><th>Stock</th><th>Quantité</th></tr></thead>
              <tbody>
                {variants.map((variant) => {
                  const unitPrice = basePrice + variant.priceAdjustment
                  const outOfStock = variant.stock !== null && variant.stock <= 0
                  return (
                    <tr key={variant.id}>
                      <th scope="row">
                        <div className="variant-quantity-values">
                          {attributes.map((attribute) => {
                            const value = variant.attributeValues[attribute.key]
                            return attribute.key === 'color' ? (
                              <span className="variant-color-choice" key={attribute.key}>
                                <i style={{ backgroundColor: colorValues[value] ?? '#808080' }} />{value}
                              </span>
                            ) : <span key={attribute.key}>{attribute.label} : {value}</span>
                          })}
                        </div>
                      </th>
                      <td>{unitPrice.toLocaleString('fr-FR')} FCFA</td>
                      <td>{outOfStock ? 'Rupture' : variant.stock === null ? 'Illimité' : variant.stock}</td>
                      <td>
                        <input
                          aria-label={`Quantité ${attributes.map((attribute) => variant.attributeValues[attribute.key]).join(' ')}`}
                          disabled={outOfStock}
                          min="0"
                          step="1"
                          type="number"
                          value={variantQuantities[variant.id] ?? '0'}
                          onChange={(event) => setVariantQuantities((current) => ({ ...current, [variant.id]: event.target.value }))}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {cartMessage && <p className="variant-stock-message" role="status">{cartMessage} <Link href="/panier">Voir le panier</Link></p>}
          <button className="order-button detail-order-button" type="button" onClick={addVariantLinesToCart} disabled={variants.length === 0}>
            Ajouter au panier <span aria-hidden="true">→</span>
          </button>
        </>
      ) : (
        <>
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
        </>
      )}
    </div>
  )
}