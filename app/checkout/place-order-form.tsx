'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { logClientError } from '../../lib/user-facing-errors'

type PickupPoint = {
  id: string
  name: string
  address: string
  city: string
}

type PlaceOrderFormProps = {
  productId: string
  quantity: number
  pickupPoints: PickupPoint[]
  variantValues: Record<string, string>
  variantUnavailable: boolean
}

const paymentMethods = ['Wave', 'Orange Money', 'Free Money', 'Carte Bancaire'] as const

export default function PlaceOrderForm({ productId, quantity, pickupPoints, variantValues, variantUnavailable }: PlaceOrderFormProps) {
  const [authLoading, setAuthLoading] = useState(true)
  const [signedIn, setSignedIn] = useState(false)
  const [pickupPointId, setPickupPointId] = useState(pickupPoints[0]?.id ?? '')
  const [paymentMethod, setPaymentMethod] = useState<(typeof paymentMethods)[number]>('Wave')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [createdOrderCode, setCreatedOrderCode] = useState('')

  useEffect(() => {
    let active = true
    void supabase.auth.getUser().then(({ data }) => {
      if (!active) return
      setSignedIn(Boolean(data.user))
      setAuthLoading(false)
    })
    return () => {
      active = false
    }
  }, [])

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setErrorMessage('')
    setCreatedOrderCode('')

    const { data, error } = await supabase.rpc('place_order', {
      p_product_id: productId,
      p_quantity: quantity,
      p_pickup_point_id: pickupPointId || null,
      p_variant_values: variantValues,
    })

    if (error) {
      logClientError('Order creation failed', error)
      setErrorMessage('La commande n’a pas pu être créée. Vérifiez vos informations et réessayez.')
      setSubmitting(false)
      return
    }

    const order = Array.isArray(data)
      ? data[0] as { order_id?: string; jalims_code?: string; total_price?: number } | undefined
      : undefined
    if (!order?.order_id || typeof order.total_price !== 'number') {
      setErrorMessage('La commande a été créée, mais ses informations de paiement sont indisponibles.')
      setSubmitting(false)
      return
    }

    setCreatedOrderCode(order.jalims_code ?? '')

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !sessionData.session) {
        throw new Error('Votre session a expiré. Reconnectez-vous pour payer.')
      }

      const response = await fetch('/api/payment/create', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          order_id: order.order_id,
          paymentMethod,
        }),
      })
      const payment = await response.json() as { redirect_url?: string; error?: string }

      if (!response.ok || !payment.redirect_url) {
        throw new Error('Impossible de démarrer le paiement.')
      }

      window.location.assign(payment.redirect_url)
    } catch (paymentError) {
      logClientError('Payment startup failed', paymentError)
      setErrorMessage('Impossible de démarrer le paiement. Vous pourrez le reprendre depuis vos commandes.')
      setSubmitting(false)
    }
  }

  if (authLoading) {
    return <div className="place-order-status" role="status">Vérification de votre connexion...</div>
  }

  if (!signedIn) {
    const next = `/checkout?product=${encodeURIComponent(productId)}&quantity=${quantity}`
    return (
      <div className="place-order-login">
        <p>Connectez-vous pour enregistrer votre commande et la suivre.</p>
        <Link className="order-button checkout-return" href={`/login?next=${encodeURIComponent(next)}`}>Se connecter pour continuer <span aria-hidden="true">→</span></Link>
      </div>
    )
  }

  return (
    <form className="place-order-form" onSubmit={submitOrder}>
      <label className="pickup-select">
        <span>Moyen de paiement</span>
        <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as (typeof paymentMethods)[number])}>
          {paymentMethods.map((method) => (
            <option key={method} value={method}>{method}</option>
          ))}
        </select>
        {paymentMethod === 'Wave' && <small className="payment-method-note">Nécessite l’application Wave installée sur votre téléphone.</small>}
      </label>
      {pickupPoints.length > 0 ? (
        <label className="pickup-select">
          <span>Point de retrait</span>
          <select value={pickupPointId} onChange={(event) => setPickupPointId(event.target.value)} required>
            {pickupPoints.map((point) => (
              <option key={point.id} value={point.id}>{point.name} · {point.city} — {point.address}</option>
            ))}
          </select>
        </label>
      ) : (
        <p className="pickup-pending">Le point de retrait sera confirmé par Jalims avant le paiement.</p>
      )}
      {variantUnavailable && <p className="variant-stock-message" role="alert">La quantité demandée dépasse le stock disponible pour cette variante. Retournez à la fiche produit.</p>}
      {errorMessage && (
        <div className="admin-feedback error" role="alert">
          {createdOrderCode
            ? `Commande ${createdOrderCode} enregistrée, mais le paiement n’a pas pu démarrer : ${errorMessage}`
            : errorMessage}
          {createdOrderCode && <Link href="/orders">Reprendre le paiement dans Mes commandes</Link>}
        </div>
      )}
      <button className="order-button checkout-confirm" type="submit" disabled={submitting || variantUnavailable || (pickupPoints.length > 0 && !pickupPointId)}>
        {submitting ? 'Ouverture du paiement...' : 'Confirmer ma commande'}
        {!submitting && <span aria-hidden="true">→</span>}
      </button>
      <p className="payment-disclaimer">Après confirmation, vous serez redirigé vers PayTech pour finaliser votre paiement par {paymentMethod}.</p>
    </form>
  )
}
