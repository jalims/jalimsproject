'use client'

import { useState } from 'react'
import { supabase } from '../../../../lib/supabase'

type MockWaveActionsProps = {
  orderId: string
}

export default function MockWaveActions({ orderId }: MockWaveActionsProps) {
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  async function completeMockPayment(outcome: 'paid' | 'error') {
    setSubmitting(true)
    setErrorMessage('')

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !sessionData.session) {
        throw new Error('Votre session a expiré. Reconnectez-vous pour continuer.')
      }

      const response = await fetch('/api/payment/wave/mock', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ order_id: orderId, outcome }),
      })
      const result = await response.json() as { redirect_url?: string; error?: string }
      if (!response.ok || !result.redirect_url) {
        throw new Error(result.error ?? 'La simulation Wave n’a pas pu aboutir.')
      }

      window.location.assign(result.redirect_url)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'La simulation Wave n’a pas pu aboutir.')
      setSubmitting(false)
    }
  }

  return (
    <section className="orders-state">
      <p>Commande de test : {orderId}</p>
      {errorMessage && <p className="admin-feedback error" role="alert">{errorMessage}</p>}
      <div className="order-pay-actions">
        <button className="order-pay-button" type="button" onClick={() => void completeMockPayment('paid')} disabled={submitting}>
          {submitting ? 'Envoi en cours...' : 'Payer'}
        </button>
        <button className="order-pay-button" type="button" onClick={() => void completeMockPayment('error')} disabled={submitting}>
          Échec
        </button>
      </div>
    </section>
  )
}
