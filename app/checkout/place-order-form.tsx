'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

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
}

export default function PlaceOrderForm({ productId, quantity, pickupPoints }: PlaceOrderFormProps) {
  const router = useRouter()
  const [authLoading, setAuthLoading] = useState(true)
  const [signedIn, setSignedIn] = useState(false)
  const [pickupPointId, setPickupPointId] = useState(pickupPoints[0]?.id ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

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

    const { data, error } = await supabase.rpc('place_order', {
      p_product_id: productId,
      p_quantity: quantity,
      p_pickup_point_id: pickupPointId || null,
    })

    setSubmitting(false)

    if (error) {
      setErrorMessage(error.message.replaceAll('_', ' '))
      return
    }

    const order = Array.isArray(data) ? data[0] as { jalims_code?: string } | undefined : undefined
    const orderCode = order?.jalims_code ?? ''
    router.push(`/orders${orderCode ? `?new=${encodeURIComponent(orderCode)}` : ''}`)
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
      {errorMessage && <p className="admin-feedback error" role="alert">La commande n’a pas été enregistrée : {errorMessage}</p>}
      <button className="order-button checkout-confirm" type="submit" disabled={submitting || (pickupPoints.length > 0 && !pickupPointId)}>
        {submitting ? 'Enregistrement...' : 'Confirmer ma commande'}
        {!submitting && <span aria-hidden="true">→</span>}
      </button>
      <p className="payment-disclaimer">Votre commande sera enregistrée en attente de paiement. Aucun prélèvement n’est effectué pour le moment.</p>
    </form>
  )
}
