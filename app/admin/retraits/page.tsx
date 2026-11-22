'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { canAccessAdminPath, getStaffRoleForUser, type StaffRole } from '../../../lib/admin-staff-client'
import { logClientError } from '../../../lib/user-facing-errors'

type PickupPoint = {
  id: string
  name: string
  address: string
  city: string
  active: boolean
}

const emptyForm = { name: '', address: '', city: 'Dakar', active: true }

export default function AdminPickupPointsPage() {
  const [checking, setChecking] = useState(true)
  const [hasSession, setHasSession] = useState(false)
  const [role, setRole] = useState<StaffRole | null>(null)
  const [points, setPoints] = useState<PickupPoint[]>([])
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState('')
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')

  async function loadPoints() {
    const { data, error } = await supabase.from('pickup_points').select('id, name, address, city, active').order('city')
    if (error) {
      logClientError('Pickup point list load failed', error)
      setFeedback('Impossible de charger les points de retrait.')
    } else setPoints((data ?? []) as PickupPoint[])
  }

  useEffect(() => {
    let active = true
    void supabase.auth.getUser().then(async ({ data, error }) => {
      if (!active) return
      if (error || !data.user) {
        setHasSession(false)
        setRole(null)
        setChecking(false)
        return
      }
      setHasSession(true)
      const staffRole = await getStaffRoleForUser(data.user)
      if (!active) return
      setRole(staffRole)
      setChecking(false)
      if (canAccessAdminPath(staffRole, '/admin/retraits')) await loadPoints()
    })
    return () => {
      active = false
    }
  }, [])

  async function savePoint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setFeedback('')
    const values = { name: form.name.trim(), address: form.address.trim(), city: form.city.trim(), active: form.active }
    const result = editingId
      ? await supabase.from('pickup_points').update(values).eq('id', editingId)
      : await supabase.from('pickup_points').insert(values)
    setSaving(false)
    if (result.error) {
      logClientError('Pickup point save failed', result.error)
      setFeedback('Le point de retrait n’a pas pu être enregistré.')
      return
    }
    setForm(emptyForm)
    setEditingId('')
    setFeedback(editingId ? 'Point de retrait modifié.' : 'Point de retrait ajouté.')
    await loadPoints()
  }

  async function togglePoint(point: PickupPoint) {
    const { error } = await supabase.from('pickup_points').update({ active: !point.active }).eq('id', point.id)
    if (error) {
      logClientError('Pickup point update failed', error)
      setFeedback('La modification du point de retrait a échoué.')
    } else await loadPoints()
  }

  if (checking) return <main className="admin-page"><div className="admin-state">Vérification de l’accès...</div></main>
  if (!hasSession) return <main className="admin-page"><section className="admin-access-state"><h1>Accès réservé</h1><p>Connectez-vous avec un compte autorisé.</p><Link className="admin-primary-link" href="/login?next=%2Fadmin%2Fretraits">Se connecter</Link></section></main>
  if (!canAccessAdminPath(role, '/admin/retraits')) {
    return (
      <main className="admin-page">
        <section className="admin-access-state">
          <h1>Accès refusé</h1>
          <p>Votre rôle ne permet pas d’accéder à cette page.</p>
          {role === 'order_manager' && <Link className="admin-primary-link" href="/admin/commandes">Aller aux commandes</Link>}
        </section>
      </main>
    )
  }

  return (
    <main className="admin-page">
      <div className="admin-shell">
        <header className="admin-header"><div><p className="eyebrow">JALIMS · ADMINISTRATION</p><h1>Points de retrait</h1><p>Les points actifs sont proposés au moment de la commande.</p></div><Link className="admin-catalog-link" href="/admin">Retour aux produits →</Link></header>
        <div className="admin-layout pickup-admin-layout">
          <section className="admin-form-panel">
            <div className="admin-section-heading"><div><p className="eyebrow">NOUVEAU POINT RELAIS</p><h2>{editingId ? 'Modifier le point' : 'Informations du point'}</h2></div></div>
            <form className="admin-product-form" onSubmit={savePoint}>
              <label><span>Nom</span><input required maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ex. Boutique Plateau" /></label>
              <label><span>Adresse</span><input required maxLength={240} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} placeholder="Rue, quartier, repère" /></label>
              <label><span>Ville</span><input required maxLength={100} value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} /></label>
              {feedback && <p className={`admin-feedback ${feedback.includes('refusé') || feedback.includes('Erreur') ? 'error' : 'success'}`} role="status">{feedback}</p>}
              <button className="admin-submit" disabled={saving} type="submit">{saving ? 'Enregistrement...' : editingId ? 'Enregistrer' : 'Ajouter le point'} <span aria-hidden="true">→</span></button>
              {editingId && <button className="admin-cancel-edit" type="button" onClick={() => { setEditingId(''); setForm(emptyForm) }}>Annuler</button>}
            </form>
          </section>
          <section className="admin-products-panel">
            <div className="admin-section-heading"><div><p className="eyebrow">RETRAIT CLIENT</p><h2>Points configurés</h2></div><span className="admin-product-count">{points.filter((point) => point.active).length}</span></div>
            {points.length === 0 ? (
              <p className="admin-empty-list">Aucun point de retrait configuré.</p>
            ) : (
              <ul className="pickup-points-list">
                {points.map((point) => (
                  <li key={point.id}>
                    <div>
                      <strong>{point.name}</strong>
                      <span>{point.address}</span>
                      <small>{point.city} · {point.active ? 'Actif' : 'Masqué'}</small>
                    </div>
                    <button type="button" onClick={() => { setEditingId(point.id); setForm({ name: point.name, address: point.address, city: point.city, active: point.active }) }} aria-label={`Modifier ${point.name}`}>Modifier</button>
                    <button type="button" onClick={() => void togglePoint(point)} aria-label={`${point.active ? 'Désactiver' : 'Activer'} ${point.name}`}>{point.active ? 'Masquer' : 'Activer'}</button>
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
