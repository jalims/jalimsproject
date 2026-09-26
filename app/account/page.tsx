'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { hasJalimsAdminAccess } from '../../lib/admin-access'

export default function AccountPage() {
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState('')
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    void supabase.auth.getUser().then(async ({ data }) => {
      if (!active) return
      const user = data.user
      setEmail(user?.email ?? '')
      setUserId(user?.id ?? '')
      setIsAdmin(hasJalimsAdminAccess(user))
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, phone')
          .eq('id', user.id)
          .maybeSingle()
        if (!active) return
        setFullName(profile?.full_name ?? String(user.user_metadata?.full_name ?? ''))
        setPhone(profile?.phone ?? String(user.user_metadata?.phone ?? ''))
      }
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [])

  async function signOut() {
    const { error } = await supabase.auth.signOut()
    setMessage(error ? `Déconnexion impossible : ${error.message}` : 'Vous êtes déconnecté.')
    if (!error) setEmail('')
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')
    setSaving(true)

    const { error } = await supabase.from('profiles').upsert({
      id: userId,
      full_name: fullName.trim(),
      phone: phone.trim(),
      updated_at: new Date().toISOString(),
    })

    setSaving(false)
    setMessage(error ? `Profil non enregistré : ${error.message}` : 'Profil enregistré.')
  }

  return (
    <main className="orders-page">
      <div className="orders-shell">
        <header className="orders-heading">
          <p className="eyebrow">VOTRE ESPACE JALIMS</p>
          <h1>Mon compte</h1>
          <p>Gérez l’accès à vos commandes et à vos produits enregistrés.</p>
        </header>
        {loading ? (
          <div className="orders-state" role="status">Chargement du compte...</div>
        ) : email ? (
          <section className="account-panel">
            <div className="account-profile-mark" aria-hidden="true">{email.slice(0, 1).toUpperCase()}</div>
            <span className="account-overline">CONNECTÉ AVEC</span>
            <strong className="account-email">{email}</strong>
            <form className="account-profile-form" onSubmit={saveProfile}>
              <label>
                <span>Nom complet</span>
                <input autoComplete="name" maxLength={120} required value={fullName} onChange={(event) => setFullName(event.target.value)} />
              </label>
              <label>
                <span>Téléphone</span>
                <input autoComplete="tel" maxLength={30} required type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
              </label>
              <button className="account-save-profile" type="submit" disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer mon profil'}</button>
            </form>
            {isAdmin && (
              <>
                <p className="account-role-status is-admin">Accès administrateur activé</p>
                <Link className="account-admin-link" href="/admin">Accéder à l’administration →</Link>
              </>
            )}
            <div className="account-shortcuts">
              <Link href="/orders">Mes commandes <span>→</span></Link>
              <Link href="/favorites">Mes favoris <span>→</span></Link>
            </div>
            {message && <p className="orders-error" role="status">{message}</p>}
            <button className="account-logout" type="button" onClick={() => void signOut()}>Se déconnecter</button>
          </section>
        ) : (
          <section className="orders-state orders-empty">
            <span className="destination-icon" aria-hidden="true">○</span>
            <h2>Connectez-vous à votre compte</h2>
            <p>Retrouvez votre historique de commande et votre liste de favoris.</p>
            <Link className="destination-action" href="/login?next=%2Faccount">Se connecter</Link>
          </section>
        )}
      </div>
    </main>
  )
}
