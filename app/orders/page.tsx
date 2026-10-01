'use client'

import Image from 'next/image'
import Link from 'next/link'
import { Suspense } from 'react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import PayOrderButton from './pay-order-button'

type Order = {
  id: string
  product_id: string
  pickup_point_id: string | null
  jalims_code: string
  quantity: number
  total_price: number
  variant_id: string | null
  variant_values: Record<string, string>
  variant_stock_committed: boolean
  variant_lines: { id: string; attribute_values: Record<string, string>; quantity: number; unit_price: number; line_total: number }[]
  status: string
  created_at: string
  products: { name: string; image_url: string | null } | null
  pickup_points: { name: string; address: string; city: string } | null
}

const statusLabels: Record<string, string> = {
  pending_payment: 'En attente de paiement',
  payé: 'Payé',
  'commandé_fournisseur': 'Commandé au fournisseur',
  'chez_transitaire': 'Chez le transitaire',
  en_transit: 'En transit vers le Sénégal',
  arrivé: 'Arrivé au Sénégal',
  récupéré: 'Récupéré',
  cancelled: 'Annulé',
}

const attributeLabels: Record<string, string> = {
  color: 'Couleur',
  size: 'Taille',
  capacity: 'Capacité / volume',
  dimensions: 'Dimensions',
  model: 'Modèle',
  weight: 'Poids',
}

function OrdersContent() {
  const searchParams = useSearchParams()
  const newOrderCode = searchParams.get('new')
  const paymentResult = searchParams.get('payment')
  const [loading, setLoading] = useState(true)
  const [signedIn, setSignedIn] = useState(false)
  const [orders, setOrders] = useState<Order[]>([])
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let active = true

    async function loadOrders() {
      const { data: userData, error: authError } = await supabase.auth.getUser()
      if (!active) return
      if (authError || !userData.user) {
        setSignedIn(false)
        setLoading(false)
        return
      }

      setSignedIn(true)
      const { data, error } = await supabase
        .from('orders')
        .select('id, product_id, pickup_point_id, jalims_code, quantity, total_price, variant_id, variant_values, variant_stock_committed, status, created_at')
        .order('created_at', { ascending: false })

      if (!active) return
      if (error) {
        setErrorMessage(error.message)
      } else {
        const orderRows = data ?? []
        const orderIds = orderRows.map((order) => order.id)
        const productIds = [...new Set(orderRows.map((order) => order.product_id))]
        const pickupPointIds = [...new Set(orderRows.map((order) => order.pickup_point_id).filter((id): id is string => Boolean(id)))]
        const [{ data: products, error: productsError }, { data: pickupPoints, error: pickupError }, { data: variantLines, error: variantLinesError }] = await Promise.all([
          productIds.length
            ? supabase.from('products').select('id, name, image_url').in('id', productIds)
            : Promise.resolve({ data: [], error: null }),
          pickupPointIds.length
            ? supabase.from('pickup_points').select('id, name, address, city').in('id', pickupPointIds)
            : Promise.resolve({ data: [], error: null }),
          orderIds.length
            ? supabase.from('order_variant_lines').select('id, order_id, attribute_values, quantity, unit_price, line_total').in('order_id', orderIds)
            : Promise.resolve({ data: [], error: null }),
        ])

        if (!active) return
        if (productsError || pickupError || variantLinesError) {
          setErrorMessage(productsError?.message ?? pickupError?.message ?? variantLinesError?.message ?? 'Impossible de charger les détails des commandes.')
        } else {
          const productById = new Map((products ?? []).map((product) => [product.id, product]))
          const pickupPointById = new Map((pickupPoints ?? []).map((point) => [point.id, point]))
          const linesByOrderId = new Map<string, Order['variant_lines']>()
          for (const line of variantLines ?? []) {
            const lines = linesByOrderId.get(line.order_id) ?? []
            lines.push(line as Order['variant_lines'][number])
            linesByOrderId.set(line.order_id, lines)
          }
          setOrders(orderRows.map((order) => ({
            ...order,
            variant_lines: linesByOrderId.get(order.id) ?? [],
            products: productById.get(order.product_id) ?? null,
            pickup_points: order.pickup_point_id ? pickupPointById.get(order.pickup_point_id) ?? null : null,
          })) as Order[])
        }
      }
      setLoading(false)
    }

    void loadOrders()
    return () => {
      active = false
    }
  }, [])

  return (
    <main className="orders-page">
      <div className="orders-shell">
        <header className="orders-heading">
          <p className="eyebrow">VOTRE ESPACE JALIMS</p>
          <h1>Mes commandes</h1>
          <p>Suivez chaque étape, de la commande au retrait.</p>
        </header>

        {newOrderCode && (
          <div className="order-created-banner" role="status">
            <strong>Commande enregistrée</strong>
            <span>Votre référence Jalims : <b>{newOrderCode}</b>. Elle est en attente de paiement.</span>
          </div>
        )}

        {paymentResult === 'return' && (
          <div className="order-created-banner" role="status">
            <strong>Retour de PayTech reçu</strong>
            <span>La confirmation du paiement est en cours. Le statut sera mis à jour après vérification.</span>
          </div>
        )}

        {paymentResult === 'cancelled' && (
          <div className="order-created-banner" role="status">
            <strong>Paiement interrompu</strong>
            <span>La commande reste visible ici. Vous pourrez relancer le paiement si elle est toujours en attente.</span>
          </div>
        )}

        {loading ? (
          <div className="orders-state" role="status">Chargement de vos commandes...</div>
        ) : !signedIn ? (
          <section className="orders-state orders-empty">
            <span className="destination-icon" aria-hidden="true">↗</span>
            <h2>Connectez-vous pour continuer</h2>
            <p>Votre historique et le suivi de vos commandes sont réservés à votre compte.</p>
            <Link className="destination-action" href="/login?next=%2Forders">Se connecter</Link>
          </section>
        ) : errorMessage ? (
          <div className="orders-state orders-error" role="alert">Impossible de charger vos commandes : {errorMessage}</div>
        ) : orders.length === 0 ? (
          <section className="orders-state orders-empty">
            <span className="destination-icon" aria-hidden="true">⌁</span>
            <h2>Pas encore de commande</h2>
            <p>Vos achats apparaîtront ici avec leur référence et leur statut de livraison.</p>
            <Link className="destination-action" href="/">Découvrir les produits</Link>
          </section>
        ) : (
          <div className="orders-list">
            {orders.map((order) => (
              <article className="order-card" key={order.id}>
                <div className="order-card-heading">
                  <div><span>Référence Jalims</span><strong>{order.jalims_code}</strong></div>
                  <span className={`order-status status-${order.status.replaceAll('_', '-')}`}>{statusLabels[order.status] ?? order.status}</span>
                </div>
                <div className="order-card-product">
                  <div className="order-product-thumb">
                    {order.products?.image_url && <Image src={order.products.image_url} alt="" fill sizes="64px" unoptimized />}
                  </div>
                  <div className="order-product-name">
                    <strong>{order.products?.name ?? 'Produit Jalims'}</strong>
                    <span>Quantité : {order.quantity}</span>
                    {order.variant_lines.length > 0 ? order.variant_lines.map((line) => (
                      <span key={line.id}>
                        {Object.entries(line.attribute_values).map(([key, value]) => `${attributeLabels[key] ?? key.replaceAll('_', ' ')} : ${value}`).join(' · ')} · {line.quantity} × {Number(line.unit_price).toLocaleString('fr-FR')} FCFA
                      </span>
                    )) : Object.entries(order.variant_values ?? {}).map(([key, value]) => <span key={key}>{attributeLabels[key] ?? key.replaceAll('_', ' ')} : {value}</span>)}
                    {(order.variant_id || order.variant_lines.length > 0) && !['pending_payment', 'cancelled'].includes(order.status) && !order.variant_stock_committed && <span className="variant-stock-warning">Notre équipe confirme la disponibilité de certaines variantes.</span>}
                    {order.pickup_points && <span>Retrait : {order.pickup_points.name}, {order.pickup_points.city}</span>}
                  </div>
                  <b className="order-total">{Number(order.total_price).toLocaleString('fr-FR')} FCFA</b>
                </div>
                <div className="order-card-footer">
                  <span>Passée le {new Date(order.created_at).toLocaleDateString('fr-FR')}</span>
                  <span>{order.status === 'pending_payment' ? 'Paiement sécurisé via Orange Money, Wave ou Free Money.' : 'Le statut sera actualisé au fil de l’acheminement.'}</span>
                </div>
                {order.status === 'pending_payment' && (
                  <PayOrderButton orderId={order.id} />
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}

export default function OrdersPage() {
  return <Suspense fallback={<main className="orders-page"><div className="orders-state">Chargement de vos commandes...</div></main>}><OrdersContent /></Suspense>
}