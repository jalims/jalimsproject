'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../../lib/supabase'
import { canAccessAdminPath } from '../../../lib/admin-staff-client'
import { logClientError } from '../../../lib/user-facing-errors'
import { useAdminSession } from '../admin-session-provider'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Skeleton,
  Switch,
  useToast,
} from '../_components'

type PickupPoint = {
  id: string
  name: string
  address: string
  city: string
  active: boolean
}

const emptyForm = { name: '', address: '', city: 'Dakar', active: true }

export default function AdminPickupPointsPage() {
  const { userId, role, loading: checking } = useAdminSession()
  const { toast } = useToast()
  const hasSession = Boolean(userId)
  const [points, setPoints] = useState<PickupPoint[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [toggleError, setToggleError] = useState('')
  const [updatingPointId, setUpdatingPointId] = useState('')

  const loadPoints = useCallback(async () => {
    setListLoading(true)
    setListError('')
    try {
      const { data, error } = await supabase.from('pickup_points').select('id, name, address, city, active').order('city')
      if (error) throw error
      setPoints((data ?? []) as PickupPoint[])
    } catch (error) {
      logClientError('Pickup point list load failed', error)
      setListError('Impossible de charger les points de retrait.')
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!checking && userId && canAccessAdminPath(role, '/admin/retraits')) {
      void (async () => {
        await loadPoints()
      })()
    }
  }, [checking, loadPoints, role, userId])

  async function savePoint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setFormError('')
    const values = { name: form.name.trim(), address: form.address.trim(), city: form.city.trim(), active: form.active }
    try {
      const result = editingId
        ? await supabase.from('pickup_points').update(values).eq('id', editingId)
        : await supabase.from('pickup_points').insert(values)
      if (result.error) throw result.error
      const wasEditing = Boolean(editingId)
      setForm(emptyForm)
      setEditingId('')
      toast({ title: wasEditing ? 'Point de retrait modifié' : 'Point de retrait ajouté', variant: 'success' })
      await loadPoints()
    } catch (error) {
      logClientError('Pickup point save failed', error)
      const message = 'Le point de retrait n’a pas pu être enregistré.'
      setFormError(message)
    } finally {
      setSaving(false)
    }
  }

  async function togglePoint(point: PickupPoint, active: boolean) {
    setToggleError('')
    setUpdatingPointId(point.id)
    try {
      const { error } = await supabase.from('pickup_points').update({ active }).eq('id', point.id)
      if (error) throw error
      toast({ title: active ? 'Point de retrait activé' : 'Point de retrait masqué', variant: 'success' })
      await loadPoints()
    } catch (error) {
      logClientError('Pickup point update failed', error)
      const message = 'La modification du point de retrait a échoué.'
      setToggleError(message)
    } finally {
      setUpdatingPointId('')
    }
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
        <PageHeader
          eyebrow="JALIMS · ADMINISTRATION"
          title="Points de retrait"
          description="Les points actifs sont proposés au moment de la commande."
          actions={!listLoading && !listError
            ? <Badge variant="info">{points.filter((point) => point.active).length} actifs</Badge>
            : undefined}
        />
        <Card
          title={editingId ? 'Modifier le point' : 'Ajouter un point de retrait'}
          description="Les champs nom, adresse et ville sont obligatoires."
        >
          <form onSubmit={savePoint}>
            <Input
              label="Nom"
              required
              maxLength={120}
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Ex. Boutique Plateau"
              disabled={saving}
            />
            <Input
              label="Adresse"
              required
              maxLength={240}
              value={form.address}
              onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
              placeholder="Rue, quartier, repère"
              disabled={saving}
            />
            <Input
              label="Ville"
              required
              maxLength={100}
              value={form.city}
              onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))}
              disabled={saving}
            />
            <Switch
              label="Proposé au moment de la commande"
              checked={form.active}
              onCheckedChange={(active) => setForm((current) => ({ ...current, active }))}
              disabled={saving}
            />
            {formError && (
              <Card title="Enregistrement impossible">
                <p role="alert">{formError}</p>
              </Card>
            )}
            <Button type="submit" loading={saving}>
              {editingId ? 'Enregistrer' : 'Ajouter le point'}
            </Button>
            {editingId && (
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => {
                  setEditingId('')
                  setForm(emptyForm)
                  setFormError('')
                }}
              >
                Annuler
              </Button>
            )}
          </form>
        </Card>
        {toggleError && (
          <Card title="Modification impossible">
            <p role="alert">{toggleError}</p>
          </Card>
        )}
        {listError ? (
          <Card title="Points configurés">
            <EmptyState
              title="La liste des points de retrait est indisponible"
              description={listError}
              action={<Button onClick={() => void loadPoints()}>Réessayer</Button>}
            />
          </Card>
        ) : listLoading ? (
          <Card title="Points configurés" description="Chargement des points de retrait…">
            <Skeleton variant="rect" width="100%" height={96} />
            <Skeleton variant="rect" width="100%" height={96} />
            <Skeleton variant="rect" width="100%" height={96} />
          </Card>
        ) : points.length === 0 ? (
          <Card title="Points configurés">
            <EmptyState
              title="Aucun point de retrait configuré"
              description="Les points de retrait ajoutés apparaîtront ici."
            />
          </Card>
        ) : (
          <Card title="Points configurés" description="Liste des points de retrait disponibles.">
            {points.map((point) => (
              <Card
                key={point.id}
                title={point.name}
                description={`${point.address} · ${point.city}`}
                actions={<Badge variant={point.active ? 'success' : 'neutral'}>{point.active ? 'Actif' : 'Masqué'}</Badge>}
              >
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Modifier ${point.name}`}
                  onClick={() => {
                    setEditingId(point.id)
                    setForm({ name: point.name, address: point.address, city: point.city, active: point.active })
                    setFormError('')
                  }}
                >
                  Modifier
                </Button>
                <Switch
                  label={`Proposé au retrait — ${point.name}`}
                  checked={point.active}
                  onCheckedChange={(active) => void togglePoint(point, active)}
                  disabled={Boolean(updatingPointId)}
                />
              </Card>
            ))}
          </Card>
        )}
      </div>
    </main>
  )
}
