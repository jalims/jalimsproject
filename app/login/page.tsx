'use client'

import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useRouter } from 'next/navigation'
import { hasJalimsAdminAccess } from '../../lib/admin-access'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [forgotPassword, setForgotPassword] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [needsConfirmation, setNeedsConfirmation] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  function getDestination(isAdmin: boolean) {
    const requestedPath = new URLSearchParams(window.location.search).get('next')
    if (isAdmin) return '/admin'
    return requestedPath?.startsWith('/') && !requestedPath.startsWith('//') ? requestedPath : '/'
  }

  function getConfirmationUrl() {
    const next = getDestination(false)
    return `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setNeedsConfirmation(false)
    setLoading(true)

    const normalizedEmail = email.trim().toLowerCase()

    try {
      if (forgotPassword) {
        const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
          redirectTo: `${window.location.origin}/reset-password`,
        })
        if (error) throw error
        setSuccess('Si cette adresse correspond à un compte, un lien de réinitialisation va lui être envoyé.')
      } else if (isSignUp) {
        if (password.length < 8) {
          setError('Choisissez un mot de passe d’au moins 8 caractères.')
          return
        }

        const { data, error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: { emailRedirectTo: getConfirmationUrl() },
        })
        if (error) throw error

        if (data.user?.identities?.length === 0) {
          setIsSignUp(false)
          setSuccess('Un compte existe peut-être déjà avec cette adresse. Connectez-vous ou utilisez « Mot de passe oublié ? ».')
        } else if (!data.session) {
          setIsSignUp(false)
          setNeedsConfirmation(true)
          setSuccess('Inscription enregistrée. Ouvrez l’e-mail de confirmation envoyé par Supabase, puis revenez vous connecter.')
        } else {
          router.replace(getDestination(hasJalimsAdminAccess(data.user)))
          router.refresh()
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password })
        if (error) {
          if (error.code === 'email_not_confirmed') setNeedsConfirmation(true)
          throw error
        }

        router.replace(getDestination(hasJalimsAdminAccess(data.user)))
        router.refresh()
      }
    } catch (caughtError) {
      const authError = caughtError instanceof Error ? caughtError : new Error('Erreur de connexion inconnue.')
      const message = authError.message.toLowerCase()
      if (message.includes('rate limit') || message.includes('email rate limit')) {
        setError('Supabase limite temporairement les e-mails. Attendez avant de réessayer ou configurez un SMTP dans Supabase → Authentication → SMTP Settings.')
      } else if (message.includes('invalid login credentials')) {
        setError('Adresse e-mail ou mot de passe incorrect. Si le compte vient d’être créé, confirmez d’abord l’adresse e-mail.')
      } else if (message.includes('email not confirmed')) {
        setError('Adresse e-mail non confirmée. Ouvrez le message de confirmation envoyé par Supabase.')
      } else if (message.includes('weak_password')) {
        setError('Le mot de passe est trop faible. Utilisez au moins 8 caractères.')
      } else {
        setError(authError.message)
      }
    } finally {
      setLoading(false)
    }
  }

  async function resendConfirmation() {
    setError('')
    setSuccess('')
    setLoading(true)
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim().toLowerCase(),
        options: { emailRedirectTo: getConfirmationUrl() },
      })
      if (error) throw error
      setSuccess('Lien de confirmation renvoyé. Vérifiez aussi le dossier indésirable.')
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : 'Erreur de renvoi inconnue.'
      setError(message.toLowerCase().includes('rate limit')
        ? 'Limite d’e-mails Supabase atteinte. Attendez ou configurez un SMTP avant de renvoyer le lien.'
        : message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-b from-orange-50 to-white p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold text-orange-500 tracking-tight">Jalims</h1>
          <p className="text-gray-400 text-sm mt-1">
            {forgotPassword ? 'Recevoir un lien pour choisir un nouveau mot de passe' : isSignUp ? 'Crée ton compte en quelques secondes' : 'Content de te revoir'}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white p-6 rounded-2xl shadow-lg shadow-orange-100 border border-orange-100"
        >
          <div className="space-y-3">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-gray-200 rounded-xl p-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition"
              required
            />
            {!forgotPassword && (
              <input
                type="password"
                placeholder="Mot de passe"
                minLength={isSignUp ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-gray-200 rounded-xl p-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition"
                required
              />
            )}
          </div>

          {error && (
            <p className="text-red-500 text-xs mt-3 bg-red-50 rounded-lg p-2">{error}</p>
          )}

          {success && (
            <p className="text-green-700 text-xs mt-3 bg-green-50 rounded-lg p-2" role="status">{success}</p>
          )}

          {needsConfirmation && !forgotPassword && (
            <button className="login-text-button" type="button" disabled={loading} onClick={() => void resendConfirmation()}>
              Renvoyer l’e-mail de confirmation
            </button>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-orange-500 hover:bg-orange-600 active:scale-[0.98] text-white font-semibold py-3 rounded-xl mt-5 transition disabled:opacity-60"
          >
            {loading ? 'Chargement...' : forgotPassword ? 'Envoyer le lien' : isSignUp ? "S'inscrire" : 'Se connecter'}
          </button>

          {!isSignUp && !forgotPassword && (
            <button className="login-text-button" type="button" onClick={() => { setError(''); setSuccess(''); setForgotPassword(true) }}>
              Mot de passe oublié ?
            </button>
          )}

          <button
            className="login-text-button"
            type="button"
            onClick={() => {
              setError('')
              setSuccess('')
              if (forgotPassword) setForgotPassword(false)
              else setIsSignUp(!isSignUp)
            }}
          >
            {forgotPassword
              ? 'Retour à la connexion'
              : isSignUp
                ? 'Déjà un compte ? Se connecter'
                : 'Pas de compte ? Créer un compte'}
          </button>
        </form>
      </div>
    </main>
  )
}