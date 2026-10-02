'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { clearVariantCart, readVariantCart, saveVariantCart, type VariantCart } from '../../lib/variant-cart'

type Product = {
  id: string
  name: string
  price: number
  image_url: string | null
  moq: number
}

type Variant = {
  id: string
  product_id: string
  attribute_values: Record<string, string>
  stock: number | null
  price_adjustment: number
}

type Attribute = {
  attribute_key: string
  label: string
  attribute_colors: Record<string, string>
}

const paymentMethods = ['Wave', 'Orange Money', 'Free Money', 'Carte Bancaire'] as const

const attributeLabels: Record<string, string> = {
  color: 'Couleur',
  size: 'Taille',
  capacity: 'Capacité / volume',
  dimensions: 'Dimensions',
  model: 'Modèle',
  weight: 'Poids',
}

export default function VariantCartPage() {
  const [cart, setCart] = useState<VariantCart | null>(null)
  const [product, setProduct] = useState<Product | null>(null)
  const [variants, setVariants] = useState<Variant[]>([])
  const [attributes, setAttributes] = useState<Attribute[]>([])
  const [pickupPoints, setPickupPoints] = useState<{ id: string; name: string; city: string }[]>([])
  const [pickupPointId, setPickupPointId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<(typeof paymentMethods)[number]>('Wave')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [createdOrderCode, setCreatedOrderCode] = useState('')

  useEffect(() => {
    let active = true

    async function loadCart() {
      const savedCart = readVariantCart()
      if (!savedCart || savedCart.lines.length === 0) {
        setLoading(false)
        return
      }

      const [{ data: loadedProduct, error: productError }, { data: loadedVariants, error: variantsError }, { data: loadedAttributes, error: attributesError }, { data: loadedPickupPoints }] = await Promise.all([
        supabase.from('products').select('id, name, price, image_url, moq, active').eq('id', savedCart.productId).eq('active', true).maybeSingle(),
        supabase.from('product_variants').select('id, product_id, attribute_values, stock, price_adjustment').in('id', savedCart.lines.map((line) => line.variantId)).eq('active', true),
        supabase.from('product_attributes').select('attribute_key, attribute_colors').eq('product_id', savedCart.productId).order('sort_order'),
        supabase.from('pickup_points').select('id, name, city').eq('active', true).order('city'),
      ])

      if (!active) return
      if (productError || variantsError || attributesError || !loadedProduct) {
        setErrorMessage(productError?.message ?? variantsError?.message ?? attributesError?.message ?? 'Ce produit n’est plus disponible.')
        setLoading(false)
        return
      }

      const variantRows = (loadedVariants ?? []) as Variant[]
      const validVariantIds = new Set(variantRows.filter((variant) => variant.product_id === savedCart.productId).map((variant) => variant.id))
      const validLines = savedCart.lines.filter((line) => validVariantIds.has(line.variantId))
      const cleanCart = { ...savedCart, lines: validLines }
      if (validLines.length !== savedCart.lines.length) saveVariantCart(cleanCart)

      setCart(cleanCart)
      setProduct(loadedProduct as Product)
      setVariants(variantRows.filter((variant) => variant.product_id === savedCart.productId))
      setAttributes((loadedAttributes ?? []).map((attribute) => ({
        ...attribute,
        attribute_colors: (attribute.attribute_colors ?? {}) as Record<string, string>,
      })) as Attribute[])
      setPickupPoints(loadedPickupPoints ?? [])
      setLoading(false)
    }

    void loadCart()
    return () => {
      active = false
    }
  }, [])

  const variantById = new Map(variants.map((variant) => [variant.id, variant]))
  const cartLines = (cart?.lines ?? []).flatMap((line) => {
    const variant = variantById.get(line.variantId)
    return variant ? [{ ...line, variant, unitPrice: Number(product?.price ?? 0) + Number(variant.price_adjustment ?? 0) }] : []
  })
  const availableCartLines = cartLines.filter((line) => line.variant.stock === null || line.quantity <= line.variant.stock)
  const total = availableCartLines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0)
  const totalQuantity = availableCartLines.reduce((sum, line) => sum + line.quantity, 0)
  const hasInvalidStock = availableCartLines.length !== cartLines.length
  const belowMinimum = Boolean(product && totalQuantity < product.moq)

  function updateCart(nextCart: VariantCart) {
    setCart(nextCart)
    saveVariantCart(nextCart)
    setErrorMessage('')
  }

  function removeLine(variantId: string) {
    if (!cart) return
    const nextCart = { ...cart, lines: cart.lines.filter((line) => line.variantId !== variantId) }
    if (nextCart.lines.length === 0) {
      clearVariantCart()
      setCart(null)
    } else {
      updateCart(nextCart)
    }
  }

  function changeQuantity(variantId: string, value: string) {
    if (!cart) return
    const quantity = Number.parseInt(value, 10)
    if (!Number.isInteger(quantity) || quantity < 1) return
    const variant = variantById.get(variantId)
    if (variant?.stock !== null && variant?.stock !== undefined && quantity > variant.stock) {
      setErrorMessage(`Stock insuffisant pour cette combinaison : ${variant.stock} disponible(s).`)
      return
    }
    updateCart({
      ...cart,
      lines: cart.lines.map((line) => line.variantId === variantId ? { ...line, quantity } : line),
    })
  }

  async function placeOrder() {
    if (!cart || !product || availableCartLines.length === 0 || belowMinimum) return
    setSubmitting(true)
    setErrorMessage('')

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !sessionData.session) {
      setErrorMessage('Connectez-vous pour confirmer votre panier.')
      setSubmitting(false)
      return
    }

    const { data, error } = await supabase.rpc('place_variant_bundle_order', {
      p_product_id: product.id,
      p_lines: availableCartLines.map((line) => ({ variant_id: line.variant.id, quantity: line.quantity })),
      p_pickup_point_id: pickupPointId || null,
    })

    if (error) {
      setErrorMessage(error.message.replaceAll('_', ' '))
      setSubmitting(false)
      return
    }

    const order = Array.isArray(data) ? data[0] as { order_id?: string; jalims_code?: string } | undefined : undefined
    if (!order?.order_id) {
      setErrorMessage('La commande a été créée, mais son identifiant est indisponible.')
      setSubmitting(false)
      return
    }

    setCreatedOrderCode(order.jalims_code ?? '')
    const availableVariantIds = new Set(availableCartLines.map((line) => line.variantId))
    const remainingCart = { ...cart, lines: cart.lines.filter((line) => !availableVariantIds.has(line.variantId)) }
    if (remainingCart.lines.length > 0) {
      saveVariantCart(remainingCart)
      setCart(remainingCart)
    } else {
      clearVariantCart()
      setCart(null)
    }

    try {
      const response = await fetch('/api/payment/create', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ order_id: order.order_id, paymentMethod }),
      })
      const payment = await response.json() as { redirect_url?: string; error?: string }
      if (!response.ok || !payment.redirect_url) {
        throw new Error(payment.error ?? 'Impossible de démarrer le paiement.')
      }
      window.location.assign(payment.redirect_url)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'La commande est créée, mais le paiement n’a pas pu démarrer.')
      setSubmitting(false)
    }
  }

  if (loading) return <main className="orders-page"><div className="orders-state" role="status">Chargement du panier...</div></main>

  return (
    <main className="orders-page">
      <div className="orders-shell variant-cart-shell">
        <header className="orders-heading">
          <p className="eyebrow">VOTRE SÉLECTION</p>
          <h1>Panier</h1>
          <p>Plusieurs combinaisons, regroupées dans une seule commande.</p>
        </header>

        {errorMessage && <p className="admin-feedback error" role="alert">{createdOrderCode ? `Commande ${createdOrderCode} enregistrée, paiement à reprendre : ` : ''}{errorMessage}</p>}

        {!cart || !product || cartLines.length === 0 ? (
          <section className="orders-state orders-empty">
            <h2>Votre panier est vide</h2>
            <p>Choisissez les variantes et quantités souhaitées sur une fiche produit.</p>
            <Link className="destination-action" href={createdOrderCode ? '/orders' : '/'}>{createdOrderCode ? 'Reprendre le paiement' : 'Découvrir les produits'}</Link>
          </section>
        ) : (
          <>
            <section className="variant-cart-product">
              {product.image_url && <Image src={product.image_url} alt="" width={64} height={64} unoptimized />}
              <div><strong>{product.name}</strong><span>{product.moq} unité(s) minimum par commande</span></div>
            </section>

            <div className="variant-cart-lines">
              {cartLines.map((line) => (
                <article className="variant-cart-line" key={line.variantId}>
                  <div className="variant-cart-line-values">
                    {Object.entries(line.variant.attribute_values).map(([key, value]) => {
                      const attribute = attributes.find((entry) => entry.attribute_key === key)
                      const label = attribute?.label ?? attributeLabels[key] ?? key
                      return key === 'color' ? (
                        <span className="variant-color-choice" key={key}>
                          <i style={{ backgroundColor: attribute?.attribute_colors[value] ?? '#808080' }} />{value}
                        </span>
                      ) : <span key={key}>{label} : {value}</span>
                    })}
                  </div>
                  <div className="variant-cart-line-stock">
                      {line.variant.stock === null ? 'Stock illimité' : line.variant.stock === 0 ? 'Rupture de stock' : `${line.variant.stock} en stock`}
                  </div>
                  <label className="variant-cart-quantity">
                    <span>Quantité</span>
                    <input
                      aria-label={`Quantité de la variante ${line.variantId}`}
                      min="1"
                      type="number"
                      value={line.quantity}
                      onChange={(event) => changeQuantity(line.variantId, event.target.value)}
                    />
                  </label>
                  <strong>{(line.unitPrice * line.quantity).toLocaleString('fr-FR')} FCFA</strong>
                  <button className="variant-cart-remove" type="button" onClick={() => removeLine(line.variantId)} aria-label="Retirer cette variante">Retirer</button>
                  {line.variant.stock !== null && line.quantity > line.variant.stock && <p className="variant-stock-message" role="alert">Stock insuffisant pour cette ligne.</p>}
                </article>
              ))}
            </div>

            <section className="variant-cart-checkout">
              {hasInvalidStock && <p className="variant-stock-message" role="status">Les combinaisons en rupture resteront dans le panier; les autres peuvent être commandées.</p>}
              {pickupPoints.length > 0 && (
                <label className="pickup-select">
                  <span>Point de retrait</span>
                  <select value={pickupPointId} onChange={(event) => setPickupPointId(event.target.value)}>
                    <option value="">Confirmer plus tard</option>
                    {pickupPoints.map((point) => <option key={point.id} value={point.id}>{point.name} · {point.city}</option>)}
                  </select>
                </label>
              )}
              <label className="pickup-select">
                <span>Moyen de paiement</span>
                <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as (typeof paymentMethods)[number])}>
                  {paymentMethods.map((method) => <option key={method} value={method}>{method}</option>)}
                </select>
                {paymentMethod === 'Wave' && <small className="payment-method-note">Nécessite l’application Wave installée sur votre téléphone.</small>}
              </label>
              <div className="checkout-total"><span>Total ({totalQuantity} unité(s))</span><strong>{total.toLocaleString('fr-FR')} FCFA</strong></div>
              {belowMinimum && <p className="variant-stock-message" role="alert">La quantité totale doit atteindre le minimum de commande : {product.moq}.</p>}
              <button className="order-button checkout-confirm" type="button" onClick={() => void placeOrder()} disabled={submitting || availableCartLines.length === 0 || belowMinimum}>
                {submitting ? 'Création de la commande...' : 'Confirmer et payer'}
                {!submitting && <span aria-hidden="true">→</span>}
              </button>
            </section>
          </>
        )}
      </div>
    </main>
  )
}