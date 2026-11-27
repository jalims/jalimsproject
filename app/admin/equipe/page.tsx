'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { canAccessAdminPath, type StaffRole } from '../../../lib/admin-staff-client'
import { supabase } from '../../../lib/supabase'
import { useAdminSession } from '../admin-session-provider'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Skeleton,
  useToast,
} from '../_components'

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
  const { userId: actorUserId, role: pageRole, loading: checking } = useAdminSession()
  const { toast } = useToast()
  const hasSession = Boolean(actorUserId)
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [email, setEmail] = useState('')
  const [newRole, setNewRole] = useState<StaffRole>('order_manager')
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [formError, setFormError] = useState('')
  const [actionError, setActionError] = useState('')
  const [deactivationTarget, setDeactivationTarget] = useState<TeamMember | null>(null)

  const loadMembers = useCallback(async () => {
    setLoading(true)
    setListError('')
    try {
      const result = await requestTeam('GET')
      if (!Array.isArray(result.members)) throw new Error('La liste des membres reçue est invalide.')
      setMembers(result.members as TeamMember[])
    } catch (error) {
      setListError(error instanceof Error ? error.message : 'Impossible de charger l’équipe.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!checking && hasSession && canAccessAdminPath(pageRole, '/admin/equipe')) {
      void (async () => {
        await loadMembers()
      })()
    }
  }, [checking, hasSession, loadMembers, pageRole])

  const allowed = canAccessAdminPath(pageRole, '/admin/equipe')
  const canManageTeam = pageRole === 'owner' || pageRole === 'admin'

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canManageTeam) return
    setSaving(true)
    setFormError('')
    try {
      const result = await requestTeam('POST', { email: email.trim(), role: newRole })
      toast({
        title: 'Membre ajouté',
        description: typeof result.message === 'string' ? result.message : undefined,
        variant: 'success',
      })
      setEmail('')
      setNewRole('order_manager')
      await loadMembers()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Le membre n’a pas pu être ajouté.'
      setFormError(message)
      toast({ title: 'Ajout impossible', description: message, variant: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  async function changeRole(member: TeamMember, role: StaffRole) {
    if (pageRole !== 'owner' || member.user_id === actorUserId || role === member.role) return
    setBusyId(member.user_id)
    setActionError('')
    try {
      const result = await requestTeam('PATCH', { userId: member.user_id, role })
      toast({
        title: 'Rôle mis à jour',
        description: typeof result.message === 'string' ? result.message : undefined,
        variant: 'success',
      })
      await loadMembers()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'La modification a échoué.'
      setActionError(message)
      toast({ title: 'Modification impossible', description: message, variant: 'danger' })
    } finally {
      setBusyId('')
    }
  }

  async function deactivateMember(member: TeamMember) {
    if (!member.active) return
    const adminAllowed = pageRole === 'admin' && member.role === 'order_manager'
    if (pageRole !== 'owner' && !adminAllowed) return
    setBusyId(member.user_id)
    setActionError('')
    try {
      const result = await requestTeam('PATCH', { userId: member.user_id, active: false })
      toast({
        title: 'Membre désactivé',
        description: typeof result.message === 'string' ? result.message : undefined,
        variant: 'success',
      })
      await loadMembers()
      setDeactivationTarget(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'La désactivation a échoué.'
      setActionError(message)
      toast({ title: 'Désactivation impossible', description: message, variant: 'danger' })
    } finally {
      setBusyId('')
    }
  }

  async function activateMember(member: TeamMember) {
    if (member.active) return
    if (pageRole !== 'owner') return
    setBusyId(member.user_id)
    setActionError('')
    try {
      const result = await requestTeam('PATCH', { userId: member.user_id, active: true })
      toast({
        title: 'Membre réactivé',
        description: typeof result.message === 'string' ? result.message : undefined,
        variant: 'success',
      })
      await loadMembers()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'La réactivation a échoué.'
      setActionError(message)
      toast({ title: 'Réactivation impossible', description: message, variant: 'danger' })
    } finally {
      setBusyId('')
    }
  }

  if (checking) {
    return (
      <main className="admin-page">
        <div className="admin-shell">
          <PageHeader title="Équipe" description="Vérification de l’accès…" eyebrow="JALIMS · ADMINISTRATION" />
          <Card title="Chargement des membres"><Skeleton variant="rect" width="100%" height={96} /></Card>
        </div>
      </main>
    )
  }
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
        <PageHeader
          eyebrow="JALIMS · ADMINISTRATION"
          title="Équipe"
          description="Gérez les accès à l’espace d’administration."
          actions={<Link className="admin-catalog-link" href="/admin">Retour à l’administration →</Link>}
        />
        {actionError && (
          <Card title="Action impossible">
            <p role="alert">{actionError}</p>
          </Card>
        )}

        {canManageTeam && (
          <Card
            title="Ajouter un membre"
            description="Une invitation par e-mail sera envoyée si la personne n’a pas encore de compte."
          >
            <form onSubmit={addMember}>
              <Input
                label="Adresse e-mail"
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="personne@exemple.com"
                disabled={saving}
              />
              <Select
                label="Rôle"
                value={newRole}
                onChange={(event) => setNewRole(event.target.value as StaffRole)}
                disabled={saving}
              >
                  {roleOptionsFor(pageRole).map((roleOption) => (
                    <option key={roleOption} value={roleOption}>{roleLabels[roleOption]}</option>
                  ))}
              </Select>
              {formError && <p role="alert">{formError}</p>}
              <Button type="submit" loading={saving}>Ajouter / inviter</Button>
            </form>
          </Card>
        )}

        {listError ? (
          <Card title="Membres de l’équipe">
            <EmptyState
              title="Impossible de charger l’équipe"
              description={listError}
              action={<Button onClick={() => void loadMembers()}>Réessayer</Button>}
            />
          </Card>
        ) : loading ? (
          <Card title="Membres de l’équipe" description="Chargement des accès…">
            <Skeleton variant="rect" width="100%" height={112} />
            <Skeleton variant="rect" width="100%" height={112} />
            <Skeleton variant="rect" width="100%" height={112} />
          </Card>
        ) : members.length === 0 ? (
          <Card title="Membres de l’équipe">
            <EmptyState title="Aucun membre enregistré" description="Les comptes autorisés apparaîtront ici." />
          </Card>
          ) : (
          <Card title="Membres de l’équipe" description={`${members.filter((member) => member.active).length} comptes actifs`}>
              {members.map((member) => {
                const isSelf = member.user_id === actorUserId
                const canChangeRole = pageRole === 'owner' && !isSelf
                const canDeactivate = member.active && (pageRole === 'owner' || (pageRole === 'admin' && member.role === 'order_manager'))
                const canActivate = !member.active && pageRole === 'owner'
                return (
                  <Card
                    key={member.user_id}
                    title={member.email || 'Adresse e-mail indisponible'}
                    description={`${isSelf ? 'Votre compte · ' : ''}Ajouté le ${new Date(member.created_at).toLocaleDateString('fr-FR')}`}
                    actions={(
                      <>
                        <Badge variant={member.role === 'owner' ? 'brand' : member.role === 'admin' ? 'info' : 'neutral'}>
                          {roleLabels[member.role]}
                        </Badge>
                        <Badge variant={member.active ? 'success' : 'neutral'}>
                          {member.active ? 'Actif' : 'Désactivé'}
                        </Badge>
                      </>
                    )}
                  >
                    {canChangeRole && (
                      <Select
                        label={`Rôle de ${member.email || member.user_id}`}
                        value={member.role}
                        disabled={busyId === member.user_id}
                        onChange={(event) => void changeRole(member, event.target.value as StaffRole)}
                      >
                          <option value="owner">Propriétaire</option>
                          <option value="admin">Administrateur</option>
                          <option value="order_manager">Gestionnaire de commandes</option>
                      </Select>
                    )}
                    {canDeactivate && (
                      <Button
                        variant="danger"
                        disabled={busyId === member.user_id}
                        onClick={() => setDeactivationTarget(member)}
                      >
                        Désactiver
                      </Button>
                    )}
                    {canActivate && (
                      <Button
                        variant="outline"
                        loading={busyId === member.user_id}
                        onClick={() => void activateMember(member)}
                      >
                        Réactiver
                      </Button>
                    )}
                  </Card>
                )
              })}
          </Card>
        )}
        <ConfirmDialog
          open={Boolean(deactivationTarget)}
          onClose={() => {
            if (!deactivationTarget || busyId !== deactivationTarget.user_id) setDeactivationTarget(null)
          }}
          onConfirm={() => {
            if (deactivationTarget) void deactivateMember(deactivationTarget)
          }}
          title={`Désactiver l’accès de ${deactivationTarget?.email || 'ce membre'} ?`}
          description={deactivationTarget
            ? `Rôle : ${roleLabels[deactivationTarget.role]}. Cette personne ne pourra plus accéder à l’espace d’administration.`
            : 'Confirmez la désactivation du membre.'}
          confirmLabel="Désactiver"
          loading={Boolean(deactivationTarget && busyId === deactivationTarget.user_id)}
        />
      </div>
    </main>
  )
}
