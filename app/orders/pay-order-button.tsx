'use client'

import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { logClientError } from '../../lib/user-facing-errors'

type PayOrderButtonProps = {
  orderId: string
}

export default function PayOrderButton({ orderId }: PayOrderButtonProps) {
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  async function startPayment() {
    setLoading(true)
    setErrorMessage('')

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !sessionData.session) {
      setErrorMessage('Votre session a expiré. Reconnectez-vous pour payer.')
      setLoading(false)
      return
    }

    try {
      const response = await fetch('/api/payments/bictorys/create', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ order_id: orderId }),
      })
      const result = await response.json() as { redirect_url?: string; error?: string }

      if (!response.ok || !result.redirect_url) {
        throw new Error(result.error ?? 'Payment startup failed')
      }

      window.location.assign(result.redirect_url)
    } catch (error) {
      logClientError('Order payment startup failed', error)
      setErrorMessage(error instanceof Error && error.message !== 'Payment startup failed'
        ? error.message
        : 'Impossible de démarrer le paiement. Veuillez réessayer.')
      setLoading(false)
    }
  }

  return (
    <div className="order-pay-actions">
      {errorMessage && <p className="order-pay-error" role="alert">{errorMessage}</p>}
      <p className="payment-disclaimer">Paiement sécurisé par Wave, Orange Money, Free Money ou carte bancaire via Bictorys.</p>
      <button className="order-pay-button" type="button" onClick={startPayment} disabled={loading}>
        {loading ? 'Ouverture du paiement...' : 'Payer'}
      </button>
    </div>
  )
}