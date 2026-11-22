'use client'

import Link from 'next/link'
import { FormEvent, useCallback, useEffect, useState } from 'react'
import { canAccessAdminPath, getStaffRoleForUser, type StaffRole } from '../../../lib/admin-staff-client'
import { supabase } from '../../../lib/supabase'

type TeamMember = {
  user_id: string
  email: string
  role: StaffRole
  active: boolean
  created_at: string
}

const roleLabels: Record<StaffRole, string> = {
  owner: 'Propriétaire',
  admin: 'Administrateur',
  order_manager: 'Gestionnaire de commandes',
}

function roleOptionsFor(actorRole: StaffRole | null): StaffRole[] {
  return actorRole === 'owner' ? ['owner', 'admin', 'order_manager'] : ['order_manager']
}

async function requestTeam(method: 'GET' | 'POST' | 'PATCH', payload?: Record<string, unknown>) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError || !sessionData.session?.access_token) {
    throw new Error('Votre session a expiré. Reconnectez-vous puis réessayez.')
  }

  const response = await fetch('/api/admin/team', {
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
  } catch {
    throw new Error('La réponse du serveur est invalide.')
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('La réponse du serveur est invalide.')
  }
  const result = body as Record<string, unknown>
  if (!response.ok) {
    throw new Error(typeof result.error === 'string' ? result.error : 'La demande a échoué.')
  }
  return result
}

export default function AdminTeamPage() {
  const [checking, setChecking] = useState(true)
  const [hasSession, setHasSession] = useState(false)
  const [pageRole, setPageRole] = useState<StaffRole | null>(null)
  const [actorUserId, setActorUserId] = useState('')
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [newRole, setNewRole] = useState<StaffRole>('order_manager')
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null)

  const loadMembers = useCallback(async () => {
    setLoading(true)
    try {
      const result = await requestTeam('GET')
      const list = Array.isArray(result.members) ? (result.members as TeamMember[]) : []
      setMembers(list)
      if (typeof result.actorUserId === 'string') setActorUserId(result.actorUserId)
      if (result.actorRole === 'owner' || result.actorRole === 'admin' || result.actorRole === 'order_manager') {
        setPageRole(result.actorRole)
      }
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : 'Impossible de charger l’équipe.', error: true })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    void supabase.auth.getUser().then(async ({ data, error }) => {
      if (!active) return
      if (error || !data.user) {
        setHasSession(false)
        setPageRole(null)
        setChecking(false)
        return
      }
      setHasSession(true)
      setActorUserId(data.user.id)
      const role = await getStaffRoleForUser(data.user)
      if (!active) return
      setPageRole(role)
      setChecking(false)
      if (canAccessAdminPath(role, '/admin/equipe')) {
        await loadMembers()
      }
    })
    return () => { active = false }
  }, [loadMembers])

  const allowed = canAccessAdminPath(pageRole, '/admin/equipe')
  const canManageTeam = pageRole === 'owner' || pageRole === 'admin'

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canManageTeam) return
    setSaving(true)
    setFeedback(null)
    try {
      const result = await requestTeam('POST', { email: email.trim(), role: newRole })
      setFeedback({ text: typeof result.message === 'string' ? result.message : 'Membre ajouté.', error: false })
      setEmail('')
      setNewRole('order_manager')
      await loadMembers()
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : 'Le membre n’a pas pu être ajouté.', error: true })
    } finally {
      setSaving(false)
    }
  }

  async function changeRole(member: TeamMember, role: StaffRole) {
    if (pageRole !== 'owner' || member.user_id === actorUserId || role === member.role) return
    setBusyId(member.user_id)
    setFeedback(null)
    try {
      const result = await requestTeam('PATCH', { userId: member.user_id, role })
      setFeedback({ text: typeof result.message === 'string' ? result.message : 'Rôle mis à jour.', error: false })
      await loadMembers()
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : 'La modification a échoué.', error: true })
    } finally {
      setBusyId('')
    }
  }

  async function deactivateMember(member: TeamMember) {
    if (!member.active) return
    const adminAllowed = pageRole === 'admin' && member.role === 'order_manager'
    if (pageRole !== 'owner' && !adminAllowed) return
    if (!window.confirm(`Désactiver l’accès de ${member.email || 'ce membre'} ?`)) return
    setBusyId(member.user_id)
    setFeedback(null)
    try {
      const result = await requestTeam('PATCH', { userId: member.user_id, active: false })
      setFeedback({ text: typeof result.message === 'string' ? result.message : 'Membre désactivé.', error: false })
      await loadMembers()
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : 'La désactivation a échoué.', error: true })
    } finally {
      setBusyId('')
    }
  }

  async function activateMember(member: TeamMember) {
    if (member.active) return
    if (pageRole !== 'owner') return
    setBusyId(member.user_id)
    setFeedback(null)
    try {
      const result = await requestTeam('PATCH', { userId: member.user_id, active: true })
      setFeedback({ text: typeof result.message === 'string' ? result.message : 'Membre réactivé.', error: false })
      await loadMembers()
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : 'La réactivation a échoué.', error: true })
    } finally {
      setBusyId('')
    }
  }

  if (checking) return <main className="admin-page"><div className="admin-state">Vérification de l’accès...</div></main>
  if (!hasSession) {
    return (
      <main className="admin-page"><section className="admin-access-state">
        <p className="eyebrow">JALIMS · ADMINISTRATION</p>
        <h1>Accès réservé</h1>
        <p>Connectez-vous avec un compte autorisé.</p>
        <Link className="admin-primary-link" href="/login?next=%2Fadmin%2Fequipe">Se connecter</Link>
      </section></main>
    )
  }
  if (!allowed) {
    return (
      <main className="admin-page"><section className="admin-access-state">
        <p className="eyebrow">JALIMS · ADMINISTRATION</p>
        <h1>Accès refusé</h1>
        <p>Votre rôle ne permet pas d’accéder à cette page.</p>
        {pageRole === 'order_manager' && <Link className="admin-primary-link" href="/admin/commandes">Aller aux commandes</Link>}
      </section></main>
    )
  }

  return (
    <main className="admin-page">
      <div className="admin-shell">
        <header className="admin-header">
          <div><p className="eyebrow">JALIMS · ADMINISTRATION</p><h1>Équipe</h1><p>Gérez les accès à l’espace d’administration.</p></div>
          <Link className="admin-catalog-link" href="/admin">Retour à l’administration →</Link>
        </header>
        <nav className="admin-shortcuts" aria-label="Outils d’administration">
          <Link className="admin-nav-item" href="/admin">Produits</Link>
          <Link className="admin-nav-item" href="/admin/commandes">Commandes</Link>
          <Link className="admin-nav-item current" href="/admin/equipe">Équipe</Link>
        </nav>

        {feedback && <p className={`admin-feedback ${feedback.error ? 'error' : 'success'}`} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}

        {canManageTeam && (
          <section className="admin-form-panel">
            <div className="admin-section-heading"><div><p className="eyebrow">MEMBRE</p><h2>Ajouter un membre</h2></div></div>
            <form className="admin-product-form" onSubmit={addMember}>
              <label>
                <span>Adresse e-mail</span>
                <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="personne@exemple.com" />
              </label>
              <label>
                <span>Rôle</span>
                <select value={newRole} onChange={(event) => setNewRole(event.target.value as StaffRole)}>
                  {roleOptionsFor(pageRole).map((roleOption) => (
                    <option key={roleOption} value={roleOption}>{roleLabels[roleOption]}</option>
                  ))}
                </select>
              </label>
              <button className="admin-submit" disabled={saving} type="submit">{saving ? 'Envoi...' : 'Ajouter / inviter'} <span aria-hidden="true">→</span></button>
            </form>
            <p className="admin-form-note">Si la personne n’a pas encore de compte, une invitation lui sera envoyée pour créer son mot de passe.</p>
          </section>
        )}

        <section className="admin-products-panel">
          <div className="admin-section-heading"><div><p className="eyebrow">ACCÈS</p><h2>Membres de l’équipe</h2></div><span className="admin-product-count">{members.filter((member) => member.active).length}</span></div>
          {loading ? (
            <p className="admin-empty-list">Chargement des membres...</p>
          ) : members.length === 0 ? (
            <p className="admin-empty-list">Aucun membre enregistré.</p>
          ) : (
            <ul className="pickup-points-list">
              {members.map((member) => {
                const isSelf = member.user_id === actorUserId
                const canChangeRole = pageRole === 'owner' && !isSelf
                const canDeactivate = member.active && (pageRole === 'owner' || (pageRole === 'admin' && member.role === 'order_manager'))
                const canActivate = !member.active && pageRole === 'owner'
                return (
                  <li key={member.user_id}>
                    <div>
                      <strong>{member.email || 'Adresse e-mail indisponible'}</strong>
                      <span>{roleLabels[member.role]}{isSelf ? ' · Votre compte' : ''}</span>
                      <small>{member.active ? 'Actif' : 'Désactivé'} · Ajouté le {new Date(member.created_at).toLocaleDateString('fr-FR')}</small>
                    </div>
                    {canChangeRole && (
                      <label>
                        <span className="sr-only">Rôle de {member.email || member.user_id}</span>
                        <select value={member.role} disabled={busyId === member.user_id} onChange={(event) => void changeRole(member, event.target.value as StaffRole)}>
                          <option value="owner">Propriétaire</option>
                          <option value="admin">Administrateur</option>
                          <option value="order_manager">Gestionnaire de commandes</option>
                        </select>
                      </label>
                    )}
                    {canDeactivate && (
                      <button type="button" disabled={busyId === member.user_id} onClick={() => void deactivateMember(member)}>Désactiver</button>
                    )}
                    {canActivate && (
                      <button type="button" disabled={busyId === member.user_id} onClick={() => void activateMember(member)}>Réactiver</button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}
