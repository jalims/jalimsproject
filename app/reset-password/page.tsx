'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { getAuthErrorMessage, logClientError } from '../../lib/user-facing-errors'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [validRecovery, setValidRecovery] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  useEffect(() => {
    let active = true
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) logClientError('Password recovery session check failed', error)
      setValidRecovery(!error && Boolean(data.session))
      setChecking(false)
    })
    return () => {
      active = false
    }
  }, [])

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage('')
    setSuccessMessage('')

    if (password.length < 8) {
      setErrorMessage('Choisissez un mot de passe d’au moins 8 caractères.')
      return
    }
    if (password !== confirmation) {
      setErrorMessage('Les deux mots de passe ne correspondent pas.')
      return
    }

    setSubmitting(true)
    const { error } = await supabase.auth.updateUser({ password })
    setSubmitting(false)

    if (error) {
      setErrorMessage(getAuthErrorMessage(error))
      return
    }

    setSuccessMessage('Votre mot de passe est modifié. Vous pouvez vous connecter.')
    await supabase.auth.signOut()
    window.setTimeout(() => router.push('/login'), 1200)
  }

  return (
    <main className="password-reset-page">
      <section className="password-reset-panel">
        <Link className="password-reset-brand" href="/">Jalims</Link>
        <p className="eyebrow">SÉCURITÉ DU COMPTE</p>
        <h1>Nouveau mot de passe</h1>
        {checking ? (
          <p className="password-reset-note" role="status">Vérification du lien...</p>
        ) : !validRecovery ? (
          <>
            <p className="password-reset-note">Ce lien est invalide ou expiré. Demandez un nouveau lien de réinitialisation.</p>
            <Link className="destination-action" href="/login">Retour à la connexion</Link>
          </>
        ) : (
          <form className="password-reset-form" onSubmit={updatePassword}>
            <label>
              <span>Nouveau mot de passe</span>
              <input autoComplete="new-password" minLength={8} required type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            <label>
              <span>Confirmer le mot de passe</span>
              <input autoComplete="new-password" minLength={8} required type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
            </label>
            {errorMessage && <p className="password-reset-message error" role="alert">{errorMessage}</p>}
            {successMessage && <p className="password-reset-message success" role="status">{successMessage}</p>}
            <button className="destination-action" type="submit" disabled={submitting}>{submitting ? 'Modification...' : 'Enregistrer le mot de passe'}</button>
          </form>
        )}
      </section>
    </main>
  )
}
