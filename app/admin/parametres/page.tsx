'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useState } from 'react'
import { canAccessAdminPath, getStaffRoleForUser, type StaffRole } from '../../../lib/admin-staff-client'
import { supabase } from '../../../lib/supabase'

type Settings = {
  transport_price_per_kg_fcfa: number
  commission_percent: number
  customs_percent: number
  cny_to_fcfa_rate: number | null
  updated_at?: string | null
}

export default function AdminSettingsPage() {
  const [checking, setChecking] = useState(true)
  const [hasSession, setHasSession] = useState(false)
  const [role, setRole] = useState<StaffRole | null>(null)
  const [settings, setSettings] = useState<Settings>({
    transport_price_per_kg_fcfa: 0,
    commission_percent: 0,
    customs_percent: 0,
    cny_to_fcfa_rate: null,
  })
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null)

  useEffect(() => {
    let active = true
    async function init() {
      const { data } = await supabase.auth.getSession()
      const user = data.session?.user
      if (!active) return
      setHasSession(Boolean(user))
      if (!user) {
        setChecking(false)
        return
      }
      const staffRole = await getStaffRoleForUser(user)
      if (!active) return
      setRole(staffRole)
      if (!canAccessAdminPath(staffRole, '/admin/parametres')) {
        setChecking(false)
        return
      }
      try {
        const token = data.session?.access_token
        const res = await fetch('/api/admin/app-settings', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          cache: 'no-store',
        })
        const body = await res.json()
        if (res.ok && body?.settings) {
          setSettings({
            transport_price_per_kg_fcfa: Number(body.settings.transport_price_per_kg_fcfa ?? 0),
            commission_percent: Number(body.settings.commission_percent ?? 0),
            customs_percent: Number(body.settings.customs_percent ?? 0),
            cny_to_fcfa_rate: body.settings.cny_to_fcfa_rate == null || body.settings.cny_to_fcfa_rate === '' ? null : Number(body.settings.cny_to_fcfa_rate),
            updated_at: body.settings.updated_at ?? null,
          })
        }
      } catch {
        // keep defaults
      }
      if (active) setChecking(false)
    }
    void init()
    return () => { active = false }
  }, [])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setFeedback(null)
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) throw new Error('Votre session a expiré. Reconnectez-vous.')
      const res = await fetch('/api/admin/app-settings', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Les paramètres n’ont pas pu être enregistrés.')
      if (body?.settings) {
        setSettings({
          transport_price_per_kg_fcfa: Number(body.settings.transport_price_per_kg_fcfa),
          commission_percent: Number(body.settings.commission_percent),
          customs_percent: Number(body.settings.customs_percent ?? 0),
          cny_to_fcfa_rate: body.settings.cny_to_fcfa_rate == null || body.settings.cny_to_fcfa_rate === '' ? null : Number(body.settings.cny_to_fcfa_rate),
          updated_at: body.settings.updated_at ?? null,
        })
      }
      setFeedback({ text: 'Paramètres enregistrés. Les prix des produits importés seront recalculés avec ces valeurs.', error: false })
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : 'Les paramètres n’ont pas pu être enregistrés.', error: true })
    } finally {
      setSaving(false)
    }
  }

  if (checking) return <main className="admin-page"><div className="admin-state">Vérification de l’accès…</div></main>
  if (!hasSession) return <main className="admin-page"><section className="admin-access-state"><h1>Accès réservé</h1><p>Connectez-vous avec un compte autorisé.</p><Link className="admin-primary-link" href="/login?next=%2Fadmin%2Fparametres">Se connecter</Link></section></main>
  if (!canAccessAdminPath(role, '/admin/parametres')) {
    return (
      <main className="admin-page"><section className="admin-access-state">
        <h1>Accès refusé</h1>
        <p>Votre rôle ne permet pas d’accéder à cette page.</p>
        <Link className="admin-primary-link" href="/admin">Retour</Link>
      </section></main>
    )
  }

  const missingCnyRate = settings.cny_to_fcfa_rate == null || !Number.isFinite(Number(settings.cny_to_fcfa_rate)) || Number(settings.cny_to_fcfa_rate) <= 0

  return (
    <main className="admin-page">
      <div className="admin-shell">
        <header className="admin-header">
          <div>
            <p className="eyebrow">JALIMS · ADMINISTRATION</p>
            <h1>Paramètres</h1>
            <p>Paramètres de calcul du prix des produits importés (origine Chine). Les produits locaux ne sont pas impactés.</p>
          </div>
          <Link className="admin-catalog-link" href="/admin">Gestion des produits →</Link>
        </header>
        <nav className="admin-shortcuts" aria-label="Outils d’administration">
          <Link className="admin-nav-item" href="/admin">Produits</Link>
          <Link className="admin-nav-item" href="/admin/commandes">Commandes</Link>
          {(role === 'owner' || role === 'admin') && <Link className="admin-nav-item" href="/admin/equipe">Équipe</Link>}
          {(role === 'owner' || role === 'admin') && <Link className="admin-nav-item current" href="/admin/parametres">Paramètres</Link>}
          <Link className="admin-nav-item" href="/admin/partenaires">Partenaires</Link>
          <Link className="admin-nav-item" href="/admin/clients">Clients</Link>
          <Link className="admin-nav-item" href="/admin/statistiques">Statistiques</Link>
          <Link className="admin-nav-item" href="/admin/messages">Messages</Link>
          <Link className="admin-nav-item" href="/admin/retraits">Points de retrait</Link>
        </nav>

        <div className="admin-layout" style={{ gridTemplateColumns: 'minmax(0, 720px)' }}>
          <section className="admin-form-panel">
            <div className="admin-section-heading">
              <div>
                <p className="eyebrow">PRODUITS IMPORTÉS</p>
                <h2>Calcul du prix</h2>
              </div>
            </div>
            <form className="admin-product-form" onSubmit={onSubmit}>
              <label>
                <span>Prix du transport par kg (FCFA)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={settings.transport_price_per_kg_fcfa}
                  onChange={(e) => setSettings((s) => ({ ...s, transport_price_per_kg_fcfa: Number(e.target.value) }))}
                />
                <small>Utilisé pour les produits importés : transport = poids (kg) × prix par kg.</small>
              </label>
              <label>
                <span>Dédouanement (%)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={settings.customs_percent}
                  onChange={(e) => setSettings((s) => ({ ...s, customs_percent: Number(e.target.value) }))}
                />
                <small>Dédouanement appliqué sur (prix produit converti + transport + autres frais), inclus dans la base avant commission.</small>
              </label>
              <label>
                <span>Commission Jalims (%)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={settings.commission_percent}
                  onChange={(e) => setSettings((s) => ({ ...s, commission_percent: Number(e.target.value) }))}
                />
                <small>Commission appliquée sur la base (prix produit + transport + autres frais + dédouanement) des produits importés.</small>
              </label>
              <label>
                <span>Taux de change : 1 yuan (CNY) = X FCFA</span>
                <input
                  type="number"
                  min="0.000001"
                  step="0.000001"
                  value={settings.cny_to_fcfa_rate ?? ''}
                  onChange={(e) => setSettings((s) => ({ ...s, cny_to_fcfa_rate: e.target.value === '' ? null : Number(e.target.value) }))}
                />
                <small>Si le prix de base d’un produit importé est en yuan, il est converti en FCFA avec ce taux. Laissez vide si non renseigné.</small>
              </label>
              {missingCnyRate && (
                <p className="admin-feedback error" role="alert">
                  Taux CNY/FCFA manquant : le calcul dynamique n’est pas appliqué aux produits importés dont le prix de base est en yuan ; le prix enregistré du produit (<code>products.price</code>) sera utilisé.
                </p>
              )}
              {feedback && <p className={`admin-feedback ${feedback.error ? 'error' : 'success'}`} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
              <button className="admin-submit" disabled={saving} type="submit">{saving ? 'Enregistrement…' : 'Enregistrer les paramètres'} <span aria-hidden="true">→</span></button>
            </form>
          </section>
        </div>
      </div>
    </main>
  )
}
