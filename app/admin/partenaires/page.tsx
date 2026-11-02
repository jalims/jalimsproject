'use client'

import Link from 'next/link'
import { FormEvent, useCallback, useEffect, useState } from 'react'
import { hasJalimsAdminAccess } from '../../../lib/admin-access'
import { logClientError } from '../../../lib/user-facing-errors'
import { supabase } from '../../../lib/supabase'

type Partner = {
  id: string
  name: string
  whatsapp_phone: string
  city: string
  active: boolean
  created_at: string
}

const emptyForm = { name: '', whatsapp_phone: '', city: '' }

export default function AdminPartnersPage() {
  const [checking, setChecking] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [partners, setPartners] = useState<Partner[]>([])
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState('')
  const [editingActive, setEditingActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null)

  const requestPartners = useCallback(async (method: 'GET' | 'POST' | 'PATCH', payload?: Record<string, unknown>) => {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !sessionData.session?.access_token) {
      if (sessionError) logClientError('Admin partners session read failed', sessionError)
      throw new Error('Votre session administrateur a expiré. Reconnectez-vous puis réessayez.')
    }

    const response = await fetch('/api/admin/partners', {
      method,
      headers: {
        Authorization: `Bearer ${sessionData.session.access_token}`,
        ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    })
    let body: unknown
    try {
      body = await response.json()
    } catch (error) {
      logClientError('Admin partners response parsing failed', error)
      throw new Error('La réponse du serveur est invalide.')
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new Error('La réponse du serveur est invalide.')
    }
    if (!response.ok) {
      const message = 'error' in body && typeof body.error === 'string' ? body.error : 'La demande a échoué.'
      throw new Error(message)
    }
    return body as Record<string, unknown>
  }, [])

  const loadPartners = useCallback(async () => {
    try {
      const body = await requestPartners('GET')
      if (!Array.isArray(body.partners)) throw new Error('La liste des partenaires reçue est invalide.')
      setPartners(body.partners as Partner[])
    } catch (error) {
      logClientError('Admin partner list load failed', error)
      setFeedback({ text: error instanceof Error ? error.message : 'Impossible de charger les partenaires.', error: true })
    }
  }, [requestPartners])

  useEffect(() => {
    let active = true
    void supabase.auth.getUser().then(async ({ data, error }) => {
      if (!active) return
      const isAdmin = !error && hasJalimsAdminAccess(data.user)
      setAuthorized(isAdmin)
      setChecking(false)
      if (isAdmin) await loadPartners()
    })
    return () => {
      active = false
    }
  }, [loadPartners])

  async function savePartner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setFeedback(null)
    try {
      await requestPartners(editingId ? 'PATCH' : 'POST', {
        ...(editingId ? { id: editingId, active: editingActive } : {}),
        name: form.name.trim(),
        whatsapp_phone: form.whatsapp_phone.trim(),
        city: form.city.trim(),
      })
      setFeedback({ text: editingId ? 'Partenaire modifié.' : 'Partenaire ajouté.', error: false })
      setEditingId('')
      setEditingActive(true)
      setForm(emptyForm)
      await loadPartners()
    } catch (error) {
      logClientError('Admin partner save failed', error)
      setFeedback({ text: error instanceof Error ? error.message : 'Le partenaire n’a pas pu être enregistré.', error: true })
    } finally {
      setSaving(false)
    }
  }

  async function togglePartner(partner: Partner) {
    setFeedback(null)
    try {
      await requestPartners('PATCH', {
        id: partner.id,
        name: partner.name,
        whatsapp_phone: partner.whatsapp_phone,
        city: partner.city,
        active: !partner.active,
      })
      setFeedback({ text: partner.active ? 'Partenaire désactivé.' : 'Partenaire activé.', error: false })
      await loadPartners()
    } catch (error) {
      logClientError('Admin partner activation update failed', error)
      setFeedback({ text: error instanceof Error ? error.message : 'La modification du partenaire a échoué.', error: true })
    }
  }

  if (checking) return <main className="admin-page"><div className="admin-state">Vérification de l’accès...</div></main>
  if (!authorized) return <main className="admin-page"><section className="admin-access-state"><h1>Accès réservé</h1><p>Connectez-vous avec un compte administrateur.</p><Link className="admin-primary-link" href="/login?next=%2Fadmin%2Fpartenaires">Se connecter</Link></section></main>

  return (
    <main className="admin-page">
      <div className="admin-shell">
        <header className="admin-header">
          <div><p className="eyebrow">JALIMS · ADMINISTRATION</p><h1>Partenaires</h1><p>Gérez les partenaires chargés des livraisons locales.</p></div>
          <Link className="admin-catalog-link" href="/admin">Gestion des produits →</Link>
        </header>
        <nav className="admin-shortcuts" aria-label="Outils d’administration">
          <Link className="admin-nav-item" href="/admin">Produits</Link>
          <Link className="admin-nav-item" href="/admin/commandes">Commandes</Link>
          <Link className="admin-nav-item current" href="/admin/partenaires">Partenaires</Link>
          <Link className="admin-nav-item" href="/admin/retraits">Points de retrait</Link>
        </nav>
        <div className="admin-layout pickup-admin-layout">
          <section className="admin-form-panel">
            <div className="admin-section-heading"><div><p className="eyebrow">LIVRAISON LOCALE</p><h2>{editingId ? 'Modifier le partenaire' : 'Ajouter un partenaire'}</h2></div></div>
            <form className="admin-product-form" onSubmit={savePartner}>
              <label><span>Nom du partenaire</span><input required maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
              <label><span>Numéro WhatsApp international</span><input required inputMode="numeric" maxLength={15} pattern="[1-9][0-9]{7,14}" placeholder="221771234567" value={form.whatsapp_phone} onChange={(event) => setForm({ ...form, whatsapp_phone: event.target.value })} /><small>Chiffres uniquement, avec l’indicatif pays. Ex. 221771234567.</small></label>
              <label><span>Ville</span><input required maxLength={100} value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} /></label>
              {feedback && <p className={`admin-feedback ${feedback.error ? 'error' : 'success'}`} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
              <button className="admin-submit" disabled={saving} type="submit">{saving ? 'Enregistrement...' : editingId ? 'Enregistrer' : 'Ajouter le partenaire'} <span aria-hidden="true">→</span></button>
              {editingId && <button className="admin-cancel-edit" type="button" onClick={() => { setEditingId(''); setEditingActive(true); setForm(emptyForm) }}>Annuler</button>}
            </form>
          </section>
          <section className="admin-products-panel">
            <div className="admin-section-heading"><div><p className="eyebrow">RÉSEAU LOCAL</p><h2>Partenaires configurés</h2></div><span className="admin-product-count">{partners.filter((partner) => partner.active).length}</span></div>
            {partners.length === 0 ? <p className="admin-empty-list">Aucun partenaire configuré.</p> : (
              <ul className="pickup-points-list">
                {partners.map((partner) => (
                  <li key={partner.id}>
                    <div>
                      <strong>{partner.name}</strong>
                      <span>{partner.whatsapp_phone}</span>
                      <small>{partner.city} · {partner.active ? 'Actif' : 'Désactivé'}</small>
                    </div>
                    <button type="button" onClick={() => { setEditingId(partner.id); setEditingActive(partner.active); setForm({ name: partner.name, whatsapp_phone: partner.whatsapp_phone, city: partner.city }); setFeedback(null) }} aria-label={`Modifier ${partner.name}`}>Modifier</button>
                    <button type="button" onClick={() => void togglePartner(partner)} aria-label={`${partner.active ? 'Désactiver' : 'Activer'} ${partner.name}`}>{partner.active ? 'Désactiver' : 'Activer'}</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}
