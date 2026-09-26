import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import PlaceOrderForm from './place-order-form'

type CheckoutPageProps = {
  searchParams: Promise<{ product?: string; quantity?: string }>
}

export default async function CheckoutPage({ searchParams }: CheckoutPageProps) {
  const { product: productId, quantity: quantityParam } = await searchParams

  if (!productId) notFound()

  const { data: product } = await supabase
    .from('products')
    .select('id, name, price, image_url, category, moq, active')
    .eq('id', productId)
    .eq('active', true)
    .maybeSingle()

  if (!product) notFound()

  const { data: pickupPoints } = await supabase
    .from('pickup_points')
    .select('id, name, address, city')
    .eq('active', true)
    .order('city')

  const requestedQuantity = Number.parseInt(quantityParam ?? '1', 10)
  const quantity = Number.isFinite(requestedQuantity)
    ? Math.max(product.moq ?? 1, Math.min(requestedQuantity, 1000))
    : product.moq ?? 1
  const total = Number(product.price) * quantity

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
                <span>{Number(product.price).toLocaleString('fr-FR')} FCFA l’unité</span>
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