'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { logClientError } from '../../lib/user-facing-errors'
import { SENEGAL_REGIONS } from '../../lib/senegal-regions'

type PickupPoint = {
  id: string
  name: string
  address: string
  city: string
}

type PlaceOrderFormProps = {
  productId: string
  origin: 'local' | 'import'
  quantity: number
  pickupPoints: PickupPoint[]
  variantValues: Record<string, string>
  variantUnavailable: boolean
  hasPublishedTerms: boolean
}

const paymentMethods = ['Wave', 'Orange Money', 'Free Money', 'Carte Bancaire'] as const

export default function PlaceOrderForm({ productId, origin, quantity, pickupPoints, variantValues, variantUnavailable, hasPublishedTerms }: PlaceOrderFormProps) {
  const [authLoading, setAuthLoading] = useState(true)
  const [signedIn, setSignedIn] = useState(false)
  const [pickupPointId, setPickupPointId] = useState(pickupPoints[0]?.id ?? '')
  const [deliveryRegion, setDeliveryRegion] = useState('')
  const [deliveryNeighborhood, setDeliveryNeighborhood] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<(typeof paymentMethods)[number]>('Wave')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [createdOrderCode, setCreatedOrderCode] = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const termsRef = useRef<HTMLDivElement>(null)

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
    if (hasPublishedTerms && !termsAccepted) {
      setErrorMessage('Veuillez lire et accepter les conditions générales avant de poursuivre le paiement.')
      termsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    setSubmitting(true)
    setErrorMessage('')
    setCreatedOrderCode('')

    const { data, error } = await supabase.rpc('place_order', {
      p_product_id: productId,
      p_quantity: quantity,
      p_pickup_point_id: pickupPointId || null,
      p_variant_values: variantValues,
      p_delivery_region: deliveryRegion,
      p_delivery_neighborhood: deliveryNeighborhood.trim(),
    })

    if (error) {
      logClientError('Order creation failed', error)
      const message = error.message
      setErrorMessage(message.includes('delivery_region_required')
        ? 'Veuillez choisir votre région de livraison.'
        : message.includes('delivery_region_invalid')
          ? 'La région choisie est invalide. Sélectionnez une région dans la liste.'
          : message.includes('delivery_neighborhood_required')
            ? 'Veuillez renseigner votre quartier ou zone de livraison.'
            : message.includes('delivery_neighborhood_too_long')
              ? 'Le quartier ou la zone ne doit pas dépasser 160 caractères.'
              : 'La commande n’a pas pu être créée. Vérifiez vos informations et réessayez.')
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

    let wavePaymentError: string | null = null
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !sessionData.session) {
        throw new Error('Votre session a expiré. Reconnectez-vous pour payer.')
      }

      if (hasPublishedTerms) {
        try {
          const acceptanceResponse = await fetch('/api/terms/accept', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${sessionData.session.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ accepted: true }),
            signal: AbortSignal.timeout(5000),
          })
          if (!acceptanceResponse.ok) {
            console.error('[Terms acceptance] Échec non bloquant.', { status: acceptanceResponse.status })
          }
        } catch (acceptanceError) {
          console.error('[Terms acceptance] Échec non bloquant.', {
            errorName: acceptanceError instanceof Error ? acceptanceError.name : 'unknown',
          })
        }
      }

      const paymentEndpoint = paymentMethod === 'Wave'
        ? '/api/payment/wave/create'
        : '/api/payment/create'
      const response = await fetch(paymentEndpoint, {
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
        wavePaymentError = paymentMethod === 'Wave' ? payment.error ?? null : null
        throw new Error('Payment startup failed')
      }

      window.location.assign(payment.redirect_url)
    } catch (paymentError) {
      logClientError('Payment startup failed', paymentError)
      setErrorMessage(wavePaymentError ?? 'Impossible de démarrer le paiement. Vous pourrez le reprendre depuis vos commandes.')
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
      {origin === 'local' && (
        <section className="local-delivery-address" aria-labelledby="local-delivery-title">
          <h3 id="local-delivery-title">Adresse de livraison</h3>
          <label className="pickup-select">
            <span>Région</span>
            <select value={deliveryRegion} onChange={(event) => setDeliveryRegion(event.target.value)} required>
              <option value="">Choisir une région</option>
              {SENEGAL_REGIONS.map((region) => <option key={region} value={region}>{region}</option>)}
            </select>
          </label>
          <label className="pickup-select">
            <span>Quartier ou zone</span>
            <input
              type="text"
              value={deliveryNeighborhood}
              onChange={(event) => setDeliveryNeighborhood(event.target.value)}
              maxLength={160}
              placeholder="Ex. Parcelles Assainies, Unité 14"
              required
            />
          </label>
          <p>Votre nom, téléphone et adresse seront transmis au partenaire qui livre votre commande.</p>
        </section>
      )}
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
      {hasPublishedTerms && (
        <>
          <aside className="legal-checkout-note">
            <strong>À savoir avant de payer</strong>
            <p>Prenez connaissance des conditions générales avant de confirmer votre commande.</p>
          </aside>
          <div className="legal-checkout-acceptance" ref={termsRef}>
            <label>
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(event) => {
                  setTermsAccepted(event.target.checked)
                  if (event.target.checked) setErrorMessage('')
                }}
              />
              <span>J’ai lu et j’accepte les <Link className="legal-checkout-link" href="/conditions">conditions générales</Link></span>
            </label>
          </div>
        </>
      )}
      {errorMessage && (
        <div className="admin-feedback error" role="alert">
          {createdOrderCode
            ? `Commande ${createdOrderCode} enregistrée, mais le paiement n’a pas pu démarrer : ${errorMessage}`
            : errorMessage}
          {createdOrderCode && <Link href="/orders">Reprendre le paiement dans Mes commandes</Link>}
        </div>
      )}
      <button className="order-button checkout-confirm" type="submit" disabled={submitting || variantUnavailable || (pickupPoints.length > 0 && !pickupPointId)}>
        {submitting ? (paymentMethod === 'Wave' ? 'Ouverture de Wave...' : 'Ouverture du paiement...') : 'Confirmer ma commande'}
        {!submitting && <span aria-hidden="true">→</span>}
      </button>
      <p className="payment-disclaimer">
        Après confirmation, vous serez redirigé vers {paymentMethod === 'Wave' ? 'Wave' : 'PayTech'} pour finaliser votre paiement par {paymentMethod}.
      </p>
    </form>
  )
}
