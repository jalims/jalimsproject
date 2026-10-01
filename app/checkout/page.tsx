import Image from 'next/image'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import PlaceOrderForm from './place-order-form'

type CheckoutPageProps = {
  searchParams: Promise<{ product?: string; quantity?: string; variant?: string }>
}

export default async function CheckoutPage({ searchParams }: CheckoutPageProps) {
  const { product: productId, quantity: quantityParam, variant: variantParam } = await searchParams

  if (!productId) notFound()

  const { data: product } = await supabase
    .from('products')
    .select('id, name, price, image_url, category, moq, active')
    .eq('id', productId)
    .eq('active', true)
    .maybeSingle()

  if (!product) notFound()

  const requestedQuantity = Number.parseInt(quantityParam ?? '1', 10)
  const quantity = Number.isFinite(requestedQuantity)
    ? Math.max(product.moq ?? 1, Math.min(requestedQuantity, 1000))
    : product.moq ?? 1

  const { data: configuredAttributes } = await supabase
    .from('product_attributes')
    .select('attribute_key, attribute_values')
    .eq('product_id', productId)
    .order('sort_order')

  const variantValues: Record<string, string> = {}
  let selectedVariant: { stock: number | null; price_adjustment: number } | null = null
  if ((configuredAttributes ?? []).length > 0) {
    let parsedVariant: unknown
    try {
      parsedVariant = JSON.parse(variantParam ?? '')
    } catch {
      redirect(`/products/${encodeURIComponent(productId)}?quantity=${quantity}`)
    }

    const parsedValues = parsedVariant as Record<string, unknown>
    const configuredKeys = (configuredAttributes ?? []).map((attribute) => attribute.attribute_key)
    const validSelection = parsedValues
      && typeof parsedValues === 'object'
      && !Array.isArray(parsedValues)
      && Object.keys(parsedValues).length === configuredKeys.length
      && configuredKeys.every((key) => (
        typeof parsedValues[key] === 'string'
        && (configuredAttributes?.find((attribute) => attribute.attribute_key === key)?.attribute_values as string[]).includes(parsedValues[key] as string)
      ))

    if (!validSelection) {
      redirect(`/products/${encodeURIComponent(productId)}?quantity=${quantity}`)
    }

    Object.assign(variantValues, parsedValues)
    const { data: variants } = await supabase
      .from('product_variants')
      .select('attribute_values, stock, price_adjustment')
      .eq('product_id', productId)
      .eq('active', true)
    const variant = (variants ?? []).find((candidate) => {
      const candidateValues = candidate.attribute_values as Record<string, string>
      return Object.keys(candidateValues).length === configuredKeys.length
        && configuredKeys.every((key) => candidateValues[key] === variantValues[key])
    })

    if (!variant) {
      redirect(`/products/${encodeURIComponent(productId)}?quantity=${quantity}`)
    }
    selectedVariant = { stock: variant.stock, price_adjustment: Number(variant.price_adjustment ?? 0) }
  }

  const { data: pickupPoints } = await supabase
    .from('pickup_points')
    .select('id, name, address, city')
    .eq('active', true)
    .order('city')

  const unitPrice = Number(product.price) + (selectedVariant?.price_adjustment ?? 0)
  const total = unitPrice * quantity
  const variantUnavailable = selectedVariant !== null
    && selectedVariant.stock !== null
    && selectedVariant.stock < quantity

  const attributeLabels = new Map((configuredAttributes ?? []).map((attribute) => [attribute.attribute_key, attribute.attribute_key]))
  if ((configuredAttributes ?? []).length > 0) {
    const { data: definitions } = await supabase
      .from('product_attribute_definitions')
      .select('attribute_key, label')
      .in('attribute_key', (configuredAttributes ?? []).map((attribute) => attribute.attribute_key))
    for (const definition of definitions ?? []) attributeLabels.set(definition.attribute_key, definition.label)
  }

  return (
    <main className="checkout-page">
      <div className="checkout-shell">
        <Link className="back-link" href={`/products/${encodeURIComponent(String(product.id))}`}>
          ← <span>Retour au produit</span>
        </Link>
        <div className="checkout-heading">
          <p className="eyebrow">DERNIÈRE ÉTAPE</p>
          <h1>Récapitulatif de commande</h1>
          <p>Vérifiez votre sélection avant de continuer.</p>
        </div>

        <div className="checkout-layout">
          <section className="checkout-summary" aria-labelledby="summary-title">
            <h2 id="summary-title">Votre sélection</h2>
            <div className="checkout-product">
              <div className="checkout-product-image">
                {product.image_url ? (
                  <Image src={product.image_url} alt={product.name} fill sizes="96px" unoptimized />
                ) : (
                  <span className="image-placeholder" aria-hidden="true">J</span>
                )}
              </div>
              <div className="checkout-product-info">
                <strong>{product.name}</strong>
                <span>Quantité : {quantity}</span>
                <span>{unitPrice.toLocaleString('fr-FR')} FCFA l’unité</span>
                {Object.entries(variantValues).map(([key, value]) => (
                  <span key={key}>{attributeLabels.get(key) ?? key} : {value}</span>
                ))}
              </div>
            </div>
            <div className="checkout-total">
              <span>Total des produits</span>
              <strong>{total.toLocaleString('fr-FR')} FCFA</strong>
            </div>
            <p className="checkout-shipping-note">Les détails du transport et du retrait au Sénégal seront confirmés avant validation définitive.</p>
          </section>

          <section className="payment-panel" aria-labelledby="payment-title">
            <h2 id="payment-title">Paiement</h2>
            <div className="payment-placeholder">
              <span className="payment-icon" aria-hidden="true">₣</span>
              <div>
                <strong>Commande avec prix tout compris</strong>
                <p>Le montant affiché inclut le produit, le transport et le dédouanement.</p>
              </div>
            </div>
            <PlaceOrderForm
              productId={String(product.id)}
              quantity={quantity}
              pickupPoints={pickupPoints ?? []}
              variantValues={variantValues}
              variantUnavailable={variantUnavailable}
            />
            <Link className="checkout-edit-link" href={`/products/${encodeURIComponent(String(product.id))}`}>
              Modifier ma sélection
            </Link>
          </section>
        </div>
      </div>
    </main>
  )
}