'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { supabase } from '../../../lib/supabase'
import { hasJalimsAdminAccess } from '../../../lib/admin-access'
import { getAuthErrorMessage } from '../../../lib/user-facing-errors'

function AuthCallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [message, setMessage] = useState('Vérification de votre adresse e-mail...')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true

    async function completeAuth() {
      const { data, error } = await supabase.auth.getSession()
      if (!active) return

      if (error || !data.session) {
        setFailed(true)
        if (error) setMessage(getAuthErrorMessage(error))
        else setMessage('Le lien est expiré ou invalide. Demandez un nouvel e-mail de confirmation.')
        return
      }

      const requestedPath = searchParams.get('next')
      const destination = hasJalimsAdminAccess(data.session.user)
        ? '/admin'
        : requestedPath?.startsWith('/') && !requestedPath.startsWith('//')
          ? requestedPath
          : '/'

      setMessage('Adresse confirmée. Ouverture de votre espace...')
      router.replace(destination)
      router.refresh()
    }

    void completeAuth()
    return () => {
      active = false
    }
  }, [router, searchParams])

  return (
    <main className="auth-callback-page">
      <section className="auth-callback-panel">
        <span className={`auth-callback-mark${failed ? ' failed' : ''}`} aria-hidden="true">{failed ? '!' : 'J'}</span>
        <p className="eyebrow">SÉCURITÉ DU COMPTE</p>
        <h1>{failed ? 'Confirmation impossible' : 'Connexion sécurisée'}</h1>
        <p className={failed ? 'auth-callback-error' : 'auth-callback-message'} role={failed ? 'alert' : 'status'}>{message}</p>
        {failed && <Link className="destination-action" href="/login">Retour à la connexion</Link>}
      </section>
    </main>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<main className="auth-callback-page"><div className="auth-callback-panel">Vérification de votre connexion...</div></main>}>
      <AuthCallbackContent />
    </Suspense>
  )
}
