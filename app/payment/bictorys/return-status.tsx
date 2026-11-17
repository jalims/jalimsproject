'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { getOrderStatusLabel } from '../../../lib/order-tracking'
import { supabase } from '../../../lib/supabase'
import { logClientError } from '../../../lib/user-facing-errors'

const orderIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type BictorysReturnStatusProps = {
  mode: 'success' | 'error'
  orderId: string | null
}

type LookupState = 'loading' | 'resolved' | 'timed_out' | 'unauthenticated' | 'not_found' | 'error' | 'invalid'

type OrderPaymentState = {
  status: string
  origin: string
}

export default function BictorysReturnStatus({ mode, orderId }: BictorysReturnStatusProps) {
  const [lookupState, setLookupState] = useState<LookupState>(() => (
    orderId && orderIdPattern.test(orderId) ? 'loading' : 'invalid'
  ))
  const [orderPaymentState, setOrderPaymentState] = useState<OrderPaymentState | null>(null)
  const currentLookupState = orderId && orderIdPattern.test(orderId) ? lookupState : 'invalid'

  useEffect(() => {
    if (!orderId || !orderIdPattern.test(orderId)) return

    let active = true
    let pollTimer: ReturnType<typeof setTimeout> | undefined
    const deadline = Date.now() + 30_000

    async function readOrderStatus() {
      if (!active) return
      if (Date.now() >= deadline) {
        setLookupState('timed_out')
        return
      }

      try {
        const { data: userData, error: authError } = await supabase.auth.getUser()
        if (!active) return
        const user = userData.user
        if (authError?.name === 'AuthSessionMissingError' || (!authError && !user)) {
          setLookupState('unauthenticated')
          return
        }
        if (authError) throw authError
        if (!user) {
          setLookupState('unauthenticated')
          return
        }

        const { data, error } = await supabase
          .from('orders')
          .select('status, origin')
          .eq('id', orderId)
          .eq('user_id', user.id)
          .maybeSingle()

        if (!active) return
        if (error) throw error
        if (!data) {
          setLookupState('not_found')
          return
        }

        const currentState = { status: data.status, origin: data.origin ?? 'import' }
        setOrderPaymentState(currentState)
        setLookupState('resolved')

        if (currentState.status === 'pending_payment') {
          pollTimer = setTimeout(() => void readOrderStatus(), Math.min(3_000, deadline - Date.now()))
        }
      } catch (error) {
        if (!active) return
        logClientError('Bictorys return order status lookup failed', error)
        setLookupState('error')
      }
    }

    void readOrderStatus()
    return () => {
      active = false
      if (pollTimer) clearTimeout(pollTimer)
    }
  }, [orderId])

  const statusLabel = orderPaymentState
    ? getOrderStatusLabel(orderPaymentState.status, orderPaymentState.origin)
    : null
  const isPending = orderPaymentState?.status === 'pending_payment'
  const loginUrl = `/login?next=${encodeURIComponent(`/payment/bictorys/${mode}?order_id=${orderId ?? ''}`)}`

  return (
    <main className="orders-page">
      <div className="orders-shell">
        <header className="orders-heading">
          <p className="eyebrow">PAIEMENT BICTORYS</p>
          <h1>Retour de paiement</h1>
          <p>Consultez l’état réel de votre commande.</p>
        </header>

        {currentLookupState === 'loading' && (
          <div className="order-created-banner" role="status">
            <strong>Vérification de la commande</strong>
            <span>Nous lisons son état actuel avant de vous informer du résultat.</span>
          </div>
        )}

        {(currentLookupState === 'resolved' && isPending || currentLookupState === 'timed_out') && (
          <div className="order-created-banner" role="status">
            <strong>Paiement en cours de vérification</strong>
            <span>Nous attendons la confirmation du paiement. Cette page ne modifie pas le statut de la commande.</span>
          </div>
        )}

        {currentLookupState === 'resolved' && !isPending && orderPaymentState && (
          <div className="order-created-banner" role="status">
            <strong>{orderPaymentState.status === 'payé' ? 'Paiement confirmé' : 'État de la commande'}</strong>
            <span>Statut actuel : {statusLabel}.</span>
          </div>
        )}

        {(currentLookupState === 'error' || currentLookupState === 'not_found' || currentLookupState === 'invalid') && (
          <div className="order-created-banner" role="alert">
            <strong>{currentLookupState === 'error' ? 'État temporairement indisponible' : 'Commande introuvable'}</strong>
            <span>
              {currentLookupState === 'error'
                ? 'Nous ne pouvons pas lire l’état de la commande pour le moment. La page de retour ne valide ni ne modifie aucun paiement.'
                : 'Vérifiez que vous êtes connecté au compte utilisé pour cette commande.'}
            </span>
          </div>
        )}

        {currentLookupState === 'unauthenticated' && (
          <div className="order-created-banner" role="status">
            <strong>Connexion requise</strong>
            <span>Connectez-vous au compte utilisé pour cette commande afin d’en consulter le statut.</span>
          </div>
        )}

        {currentLookupState === 'unauthenticated' && (
          <Link className="destination-action" href={loginUrl}>Se connecter</Link>
        )}
        {currentLookupState !== 'unauthenticated' && (
          <Link className="destination-action" href="/orders">Mes commandes</Link>
        )}
      </div>
    </main>
  )
}
