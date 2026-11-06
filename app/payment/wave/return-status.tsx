'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { getOrderStatusLabel } from '../../../lib/order-tracking'
import { supabase } from '../../../lib/supabase'
import { logClientError } from '../../../lib/user-facing-errors'

const orderIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type WaveReturnStatusProps = {
  mode: 'success' | 'error'
  orderId: string | null
}

type LookupState = 'loading' | 'resolved' | 'timed_out' | 'unauthenticated' | 'not_found' | 'error' | 'invalid'

type OrderPaymentState = {
  status: string
  origin: string
}

export default function WaveReturnStatus({ mode, orderId }: WaveReturnStatusProps) {
  const [lookupState, setLookupState] = useState<LookupState>(() => (
    orderId && orderIdPattern.test(orderId) ? 'loading' : 'invalid'
  ))
  const [orderPaymentState, setOrderPaymentState] = useState<OrderPaymentState | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState('')
  const currentLookupState = orderId && orderIdPattern.test(orderId) ? lookupState : 'invalid'

  useEffect(() => {
    if (!orderId || !orderIdPattern.test(orderId)) {
      return
    }

    let active = true
    let pollTimer: ReturnType<typeof setTimeout> | undefined
    const deadline = Date.now() + 30_000

    async function readOrderStatus() {
      if (!active) return
      if (mode === 'success' && Date.now() >= deadline) {
        setLookupState('timed_out')
        return
      }

      try {
        const { data: userData, error: authError } = await supabase.auth.getUser()
        if (!active) return
        if (authError?.name === 'AuthSessionMissingError') {
          setLookupState('unauthenticated')
          return
        }
        if (authError) throw authError
        if (!userData.user) {
          setLookupState('unauthenticated')
          return
        }

        const { data, error } = await supabase
          .from('orders')
          .select('status, origin')
          .eq('id', orderId)
          .eq('user_id', userData.user.id)
          .maybeSingle()

        if (!active) return
        if (error) throw error
        if (!data) {
          setLookupState('not_found')
          return
        }

        const currentState = { status: data.status, origin: data.origin ?? 'import' }
        setOrderPaymentState(currentState)
        if (mode === 'success' && currentState.status === 'pending_payment') {
          setLookupState('resolved')
          const delay = Math.min(3_000, Math.max(0, deadline - Date.now()))
          pollTimer = setTimeout(() => void readOrderStatus(), delay)
          return
        }

        setLookupState('resolved')
      } catch (error) {
        if (!active) return
        logClientError('Wave return order status lookup failed', error)
        setLookupState('error')
      }
    }

    void readOrderStatus()
    return () => {
      active = false
      if (pollTimer) clearTimeout(pollTimer)
    }
  }, [mode, orderId])

  async function retryWavePayment() {
    if (!orderId) return
    setRetrying(true)
    setRetryError('')

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !sessionData.session) {
        throw new Error('Votre session a expiré. Reconnectez-vous pour réessayer.')
      }

      const response = await fetch('/api/payment/wave/create', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ order_id: orderId }),
      })
      const result = await response.json() as { redirect_url?: string; error?: string }
      if (!response.ok || !result.redirect_url) {
        throw new Error(result.error ?? 'Impossible de relancer le paiement Wave.')
      }

      const redirectUrl = new URL(result.redirect_url, window.location.origin)
      if ((redirectUrl.protocol !== 'https:' && redirectUrl.origin !== window.location.origin)
        || redirectUrl.username
        || redirectUrl.password) {
        throw new Error('Wave a renvoyé un lien de paiement invalide.')
      }
      window.location.assign(redirectUrl.toString())
    } catch (error) {
      logClientError('Wave payment retry failed', error)
      setRetryError(error instanceof Error ? error.message : 'Impossible de relancer le paiement Wave.')
      setRetrying(false)
    }
  }

  const statusLabel = orderPaymentState
    ? getOrderStatusLabel(orderPaymentState.status, orderPaymentState.origin)
    : null
  const isPending = orderPaymentState?.status === 'pending_payment'
  const canRetry = mode === 'error' && (isPending || currentLookupState === 'error')
  const loginUrl = `/login?next=${encodeURIComponent(`/payment/wave/${mode}?order_id=${orderId ?? ''}`)}`

  return (
    <main className="orders-page">
      <div className="orders-shell">
        <header className="orders-heading">
          <p className="eyebrow">PAIEMENT WAVE</p>
          <h1>{mode === 'success' ? 'Retour de paiement' : 'Paiement interrompu'}</h1>
          <p>Consultez l’état réel de votre commande.</p>
        </header>

        {currentLookupState === 'loading' && (
          <div className="order-created-banner" role="status">
            <strong>Vérification de la commande</strong>
            <span>Nous lisons son état actuel avant de vous informer du résultat.</span>
          </div>
        )}

        {mode === 'success' && currentLookupState === 'resolved' && isPending && (
          <div className="order-created-banner" role="status">
            <strong>Paiement en cours de vérification</strong>
            <span>Nous vérifions la confirmation du paiement. Cette page se met à jour automatiquement.</span>
          </div>
        )}

        {mode === 'success' && currentLookupState === 'timed_out' && (
          <div className="order-created-banner" role="status">
            <strong>Paiement toujours en cours de vérification</strong>
            <span>La confirmation n’est pas encore visible. Consultez « Mes commandes » pour suivre l’état actualisé.</span>
          </div>
        )}

        {currentLookupState === 'resolved' && !isPending && orderPaymentState && (
          <div className="order-created-banner" role="status">
            <strong>{orderPaymentState.status === 'payé' ? 'Paiement confirmé' : 'État de la commande'}</strong>
            <span>Statut actuel : {statusLabel}.</span>
          </div>
        )}

        {mode === 'error' && currentLookupState === 'resolved' && isPending && (
          <div className="order-created-banner" role="status">
            <strong>Paiement non terminé</strong>
            <span>Votre commande est toujours en attente de paiement. Cette page ne modifie pas son statut.</span>
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

        {mode === 'error' && canRetry && (
          <div className="order-pay-actions">
            {retryError && <p className="order-pay-error" role="alert">{retryError}</p>}
            <button className="order-pay-button" type="button" onClick={() => void retryWavePayment()} disabled={retrying}>
              {retrying ? 'Ouverture de Wave...' : 'Réessayer'}
            </button>
            <Link className="destination-action" href="/orders">
              Choisir un autre moyen de paiement
            </Link>
          </div>
        )}

        {mode === 'error' && currentLookupState === 'unauthenticated' && (
          <Link className="destination-action" href={loginUrl}>Se connecter</Link>
        )}

        {(mode === 'success' || (mode === 'error' && !canRetry && currentLookupState !== 'unauthenticated')) && (
          <Link className="destination-action" href="/orders">Mes commandes</Link>
        )}
      </div>
    </main>
  )
}
