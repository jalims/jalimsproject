'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { hasJalimsAdminAccess } from '../../../lib/admin-access'

type AdminOrder = {
  id: string
  product_id: string
  pickup_point_id: string | null
  jalims_code: string
  quantity: number
  total_price: number
  variant_id: string | null
  variant_values: Record<string, string>
  variant_stock_committed: boolean
  status: string
  created_at: string
  products: { name: string; image_url: string | null } | null
  pickup_points: { name: string; address: string; city: string } | null
}

const statuses = [
  ['pending_payment', 'En attente de paiement'],
  ['payé', 'Payé'],
  ['commandé_fournisseur', 'Commandé au fournisseur'],
  ['chez_transitaire', 'Chez le transitaire'],
  ['en_transit', 'En transit'],
  ['arrivé', 'Arrivé au Sénégal'],
  ['récupéré', 'Récupéré'],
  ['cancelled', 'Annulé'],
]

const attributeLabels: Record<string, string> = {
  color: 'Couleur',
  size: 'Taille',
  capacity: 'Capacité / volume',
  dimensions: 'Dimensions',
  model: 'Modèle',
  weight: 'Poids',
}

export default function AdminOrdersPage() {
  const [checking, setChecking] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [errorMessage, setErrorMessage] = useState('')
  const [savingId, setSavingId] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      const { data: userData, error: authError } = await supabase.auth.getUser()
      if (!active) return
      if (authError || !hasJalimsAdminAccess(userData.user)) {
        setChecking(false)
        return
      }
      const { data, error } = await supabase
        .from('orders')
        .select('id, product_id, pickup_point_id, jalims_code, quantity, total_price, variant_id, variant_values, variant_stock_committed, status, created_at')
        .order('created_at', { ascending: false })
      if (!active) return
      if (error) {
        const isRlsError = error.message.toLowerCase().includes('row-level security') || error.code === '42501'
        setErrorMessage(isRlsError
          ? `Supabase bloque la lecture des commandes (RLS). Exécutez la migration supabase/migrations/20260926_designate_jalims_admin.sql, puis reconnectez le compte admin. Détail : ${error.message}`
          : error.message)
      }
      else {
        const orderRows = data ?? []
        const productIds = [...new Set(orderRows.map((order) => order.product_id))]
        const pickupPointIds = [...new Set(orderRows.map((order) => order.pickup_point_id).filter((id): id is string => Boolean(id)))]
        const [{ data: products, error: productsError }, { data: pickupPoints, error: pickupError }] = await Promise.all([
          productIds.length
            ? supabase.from('products').select('id, name, image_url').in('id', productIds)
            : Promise.resolve({ data: [], error: null }),
          pickupPointIds.length
            ? supabase.from('pickup_points').select('id, name, address, city').in('id', pickupPointIds)
            : Promise.resolve({ data: [], error: null }),
        ])
        if (!active) return
        if (productsError || pickupError) {
          const detailError = productsError ?? pickupError
          const isRlsError = detailError?.message.toLowerCase().includes('row-level security') || detailError?.code === '42501'
          setErrorMessage(isRlsError
            ? `Les commandes sont chargées, mais Supabase bloque les détails (RLS). Vérifiez la migration designate_jalims_admin.sql. Détail : ${detailError?.message}`
            : detailError?.message ?? 'Impossible de charger les détails des commandes.')
        } else {
          const productById = new Map((products ?? []).map((product) => [product.id, product]))
          const pickupPointById = new Map((pickupPoints ?? []).map((point) => [point.id, point]))
          setOrders(orderRows.map((order) => ({
            ...order,
            products: productById.get(order.product_id) ?? null,
            pickup_points: order.pickup_point_id ? pickupPointById.get(order.pickup_point_id) ?? null : null,
          })) as AdminOrder[])
        }
      }
      setAuthorized(true)
      setChecking(false)
    }
    void load()
    return () => {
      active = false
    }
  }, [])

  async function updateStatus(orderId: string, status: string) {
    setSavingId(orderId)
    setErrorMessage('')
    const { error } = await supabase.from('orders').update({ status }).eq('id', orderId)
    setSavingId('')
    if (error) {
      const isRlsError = error.message.toLowerCase().includes('row-level security') || error.code === '42501'
      setErrorMessage(isRlsError
        ? `Supabase a refusé la mise à jour (RLS). Vérifiez que le compte est jalimsofficiel@gmail.com avec le rôle admin et appliquez la migration designate_jalims_admin.sql. Détail : ${error.message}`
        : error.message)
      return
    }
    setOrders((current) => current.map((order) => order.id === orderId ? { ...order, status } : order))
  }

  if (checking) return <main className="admin-page"><div className="admin-state">Vérification de l’accès...</div></main>
  if (!authorized) {
    return (
      <main className="admin-page"><section className="admin-access-state">
        <p className="eyebrow">JALIMS · ADMINISTRATION</p><h1>Accès réservé</h1>
        <p>Connectez-vous avec un compte administrateur pour gérer les commandes.</p>
        <Link className="admin-primary-link" href="/login?next=%2Fadmin%2Fcommandes">Se connecter</Link>
      </section></main>
    )
  }

  return (
    <main className="admin-page">
      <div className="admin-shell">
        <header className="admin-header">
          <div><p className="eyebrow">JALIMS · ADMINISTRATION</p><h1>Commandes</h1><p>Actualisez le statut après chaque étape du parcours.</p></div>
          <Link className="admin-catalog-link" href="/admin">Gestion des produits →</Link>
        </header>
        {errorMessage && <p className="admin-feedback error" role="alert">Erreur Supabase : {errorMessage}</p>}
        {orders.length === 0 ? (
          <div className="orders-state">Aucune commande enregistrée pour le moment.</div>
        ) : (
          <div className="admin-orders-list">
            {orders.map((order) => (
              <article className="admin-order-row" key={order.id}>
                <div className="order-product-thumb">{order.products?.image_url && <Image src={order.products.image_url} alt="" fill sizes="58px" unoptimized />}</div>
                <div className="admin-order-main">
                  <strong>{order.products?.name ?? 'Produit Jalims'}</strong>
                  <span>{order.jalims_code} · {order.quantity} unité{order.quantity === 1 ? '' : 's'}</span>
                  {Object.entries(order.variant_values ?? {}).map(([key, value]) => <span key={key}>{attributeLabels[key] ?? key.replaceAll('_', ' ')} : {value}</span>)}
                  {order.variant_id && !['pending_payment', 'cancelled'].includes(order.status) && !order.variant_stock_committed && <span className="variant-stock-warning">Paiement tardif : vérifier le stock de cette variante.</span>}
                  <span>{order.pickup_points ? `${order.pickup_points.name}, ${order.pickup_points.city}` : 'Point de retrait à confirmer'}</span>
                </div>
                <b className="admin-order-total">{Number(order.total_price).toLocaleString('fr-FR')} FCFA</b>
                <label className="admin-order-status">
                  <span>Statut</span>
                  <select value={order.status} disabled={savingId === order.id} onChange={(event) => void updateStatus(order.id, event.target.value)}>
                    {statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
