'use client'

import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { logClientError } from '../../lib/user-facing-errors'

const paymentMethods = ['Wave', 'Orange Money', 'Free Money', 'Carte Bancaire'] as const

type PayOrderButtonProps = {
  orderId: string
}

export default function PayOrderButton({ orderId }: PayOrderButtonProps) {
  const [paymentMethod, setPaymentMethod] = useState<(typeof paymentMethods)[number]>('Wave')
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
      const response = await fetch('/api/payment/create', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ order_id: orderId, paymentMethod }),
      })
      const result = await response.json() as { redirect_url?: string; error?: string }

      if (!response.ok || !result.redirect_url) {
        throw new Error('Impossible de démarrer le paiement.')
      }

      window.location.assign(result.redirect_url)
    } catch (error) {
      logClientError('Order payment startup failed', error)
      setErrorMessage('Impossible de démarrer le paiement. Veuillez réessayer.')
      setLoading(false)
    }
  }

  return (
    <div className="order-pay-actions">
      {errorMessage && <p className="order-pay-error" role="alert">{errorMessage}</p>}
      <label className="pickup-select">
        <span>Moyen de paiement</span>
        <select
          value={paymentMethod}
          onChange={(event) => setPaymentMethod(event.target.value as (typeof paymentMethods)[number])}
          disabled={loading}
        >
          {paymentMethods.map((method) => (
            <option key={method} value={method}>{method}</option>
          ))}
        </select>
        {paymentMethod === 'Wave' && <small className="payment-method-note">Nécessite l’application Wave installée sur votre téléphone.</small>}
      </label>
      <button className="order-pay-button" type="button" onClick={startPayment} disabled={loading}>
        {loading ? 'Connexion à PayTech...' : 'Payer'}
      </button>
    </div>
  )
}