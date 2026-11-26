'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { canAccessAdminPath } from '../../../lib/admin-staff-client'
import { logClientError } from '../../../lib/user-facing-errors'
import { supabase } from '../../../lib/supabase'
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

type Partner = {
  id: string
  name: string
  whatsapp_phone: string
  city: string
  active: boolean
  created_at: string
}

const emptyForm = { name: '', whatsapp_phone: '', city: '' }
const internationalPhonePattern = /^[1-9][0-9]{7,14}$/

function isPartner(value: unknown): value is Partner {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const partner = value as Record<string, unknown>
  return typeof partner.id === 'string'
    && typeof partner.name === 'string'
    && typeof partner.whatsapp_phone === 'string'
    && typeof partner.city === 'string'
    && typeof partner.active === 'boolean'
    && typeof partner.created_at === 'string'
}

export default function AdminPartnersPage() {
  const { userId, role, loading: checking } = useAdminSession()
  const { toast } = useToast()
  const hasSession = Boolean(userId)
  const [partners, setPartners] = useState<Partner[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState('')
  const [editingActive, setEditingActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [toggleError, setToggleError] = useState('')
  const [updatingPartnerId, setUpdatingPartnerId] = useState('')

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
    setListLoading(true)
    setListError('')
    try {
      const body = await requestPartners('GET')
      if (!Array.isArray(body.partners)) throw new Error('La liste des partenaires reçue est invalide.')
      setPartners(body.partners as Partner[])
    } catch (error) {
      logClientError('Admin partner list load failed', error)
      setListError(error instanceof Error ? error.message : 'Impossible de charger les partenaires.')
    } finally {
      setListLoading(false)
    }
  }, [requestPartners])

  useEffect(() => {
    if (!checking && hasSession && canAccessAdminPath(role, '/admin/partenaires')) {
      void (async () => {
        await loadPartners()
      })()
    }
  }, [checking, hasSession, loadPartners, role])

  function updatePartnerList(partner: Partner) {
    setPartners((current) => [...current.filter((item) => item.id !== partner.id), partner]
      .sort((left, right) => left.name.localeCompare(right.name)))
  }

  async function savePartner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setFormError('')
    try {
      const body = await requestPartners(editingId ? 'PATCH' : 'POST', {
        ...(editingId ? { id: editingId, active: editingActive } : {}),
        name: form.name.trim(),
        whatsapp_phone: form.whatsapp_phone.trim(),
        city: form.city.trim(),
      })
      if (!isPartner(body.partner)) throw new Error('La réponse du serveur ne contient pas le partenaire enregistré.')
      updatePartnerList(body.partner)
      toast({
        title: editingId ? 'Partenaire modifié' : 'Partenaire ajouté',
        variant: 'success',
      })
      setEditingId('')
      setEditingActive(true)
      setForm(emptyForm)
    } catch (error) {
      logClientError('Admin partner save failed', error)
      const message = error instanceof Error ? error.message : 'Le partenaire n’a pas pu être enregistré.'
      setFormError(message)
      toast({ title: 'Enregistrement impossible', description: message, variant: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  async function togglePartner(partner: Partner) {
    setToggleError('')
    setUpdatingPartnerId(partner.id)
    try {
      const body = await requestPartners('PATCH', {
        id: partner.id,
        name: partner.name,
        whatsapp_phone: partner.whatsapp_phone,
        city: partner.city,
        active: !partner.active,
      })
      if (!isPartner(body.partner)) throw new Error('La réponse du serveur ne contient pas le partenaire modifié.')
      updatePartnerList(body.partner)
      toast({
        title: body.partner.active ? 'Partenaire activé' : 'Partenaire désactivé',
        variant: 'success',
      })
    } catch (error) {
      logClientError('Admin partner activation update failed', error)
      const message = error instanceof Error ? error.message : 'La modification du partenaire a échoué.'
      setToggleError(message)
      toast({ title: 'Modification impossible', description: message, variant: 'danger' })
    } finally {
      setUpdatingPartnerId('')
    }
  }

  if (checking) return <main className="admin-page"><div className="admin-state">Vérification de l’accès...</div></main>
  if (!hasSession) return <main className="admin-page"><section className="admin-access-state"><h1>Accès réservé</h1><p>Connectez-vous avec un compte autorisé.</p><Link className="admin-primary-link" href="/login?next=%2Fadmin%2Fpartenaires">Se connecter</Link></section></main>
  if (!canAccessAdminPath(role, '/admin/partenaires')) {
    return (
      <main className="admin-page"><section className="admin-access-state">
        <h1>Accès refusé</h1>
        <p>Votre rôle ne permet pas d’accéder à cette page.</p>
        {role === 'order_manager' && <Link className="admin-primary-link" href="/admin/commandes">Aller aux commandes</Link>}
      </section></main>
    )
  }

  return (
    <main className="admin-page">
      <div className="admin-shell">
        <PageHeader
          eyebrow="JALIMS · ADMINISTRATION"
          title="Partenaires"
          description="Gérez les partenaires chargés des livraisons locales."
          actions={!listLoading && !listError
            ? <Badge variant="info">{partners.filter((partner) => partner.active).length} actifs</Badge>
            : undefined}
        />
        <Card
          title={editingId ? 'Modifier le partenaire' : 'Ajouter un partenaire'}
          description="Coordonnées utilisées pour les livraisons locales."
        >
          <form onSubmit={savePartner}>
            <Input
              label="Nom du partenaire"
              required
              maxLength={120}
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              disabled={saving}
            />
            <Input
              label="Numéro WhatsApp international"
              required
              inputMode="numeric"
              maxLength={15}
              pattern={internationalPhonePattern.source}
              placeholder="221771234567"
              value={form.whatsapp_phone}
              onChange={(event) => setForm((current) => ({ ...current, whatsapp_phone: event.target.value }))}
              hint="Chiffres uniquement, avec l’indicatif pays. Ex. 221771234567."
              error={form.whatsapp_phone && !internationalPhonePattern.test(form.whatsapp_phone)
                ? 'Saisissez 8 à 15 chiffres, sans signe ni espace, en commençant par un chiffre de 1 à 9.'
                : undefined}
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
            {editingId && (
              <Switch
                label="Partenaire actif"
                checked={editingActive}
                onCheckedChange={setEditingActive}
                disabled={saving}
              />
            )}
            {formError && (
              <Card title="Enregistrement impossible">
                <p role="alert">{formError}</p>
              </Card>
            )}
            <Button type="submit" loading={saving}>
              {editingId ? 'Enregistrer' : 'Ajouter le partenaire'}
            </Button>
            {editingId && (
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => {
                  setEditingId('')
                  setEditingActive(true)
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
          <Card title="Impossible de charger les partenaires">
            <EmptyState
              title="La liste des partenaires est indisponible"
              description={listError}
              action={<Button onClick={() => void loadPartners()}>Réessayer</Button>}
            />
          </Card>
        ) : listLoading ? (
          <Card title="Partenaires configurés" description="Chargement des partenaires…">
            <Skeleton variant="rect" width="100%" height={88} />
            <Skeleton variant="rect" width="100%" height={88} />
            <Skeleton variant="rect" width="100%" height={88} />
          </Card>
        ) : partners.length === 0 ? (
          <Card title="Partenaires configurés">
            <EmptyState
              title="Aucun partenaire configuré"
              description="Les partenaires ajoutés apparaîtront ici."
            />
          </Card>
        ) : (
          <Card title="Partenaires configurés" description="Liste des partenaires de livraison locale.">
            {partners.map((partner) => (
              <Card
                key={partner.id}
                title={partner.name}
                description={`${partner.city} · ${partner.whatsapp_phone}`}
                actions={<Badge variant={partner.active ? 'success' : 'neutral'}>{partner.active ? 'Actif' : 'Désactivé'}</Badge>}
              >
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Modifier ${partner.name}`}
                  onClick={() => {
                    setEditingId(partner.id)
                    setEditingActive(partner.active)
                    setForm({ name: partner.name, whatsapp_phone: partner.whatsapp_phone, city: partner.city })
                    setFormError('')
                  }}
                >
                  Modifier
                </Button>
                <Switch
                  label={`Partenaire actif — ${partner.name}`}
                  checked={partner.active}
                  onCheckedChange={() => void togglePartner(partner)}
                  disabled={Boolean(updatingPartnerId)}
                />
              </Card>
            ))}
          </Card>
        )}
      </div>
    </main>
  )
}
