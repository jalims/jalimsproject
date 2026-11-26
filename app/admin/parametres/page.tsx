'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'
import { canAccessAdminPath } from '../../../lib/admin-staff-client'
import { supabase } from '../../../lib/supabase'
import { useAdminSession } from '../admin-session-provider'
import {
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Skeleton,
  useToast,
} from '../_components'

type Settings = {
  transport_price_per_kg_fcfa: number
  commission_percent: number
  customs_percent: number
  cny_to_fcfa_rate: number | null
  updated_at?: string | null
}

async function readSettingsResponse(response: Response): Promise<Partial<Settings>> {
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('La réponse des paramètres est invalide.')
  }
  const result = body as Record<string, unknown>
  if (!response.ok) {
    throw new Error(typeof result.error === 'string' ? result.error : 'Impossible de charger les paramètres.')
  }
  if (typeof result.settings !== 'object' || result.settings === null || Array.isArray(result.settings)) {
    throw new Error('Les paramètres reçus sont incomplets.')
  }
  return result.settings as Partial<Settings>
}

export default function AdminSettingsPage() {
  const { userId, role, loading: sessionLoading } = useAdminSession()
  const { toast } = useToast()
  const [checking, setChecking] = useState(true)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [settingsLoadError, setSettingsLoadError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const hasSession = Boolean(userId)
  const [settings, setSettings] = useState<Settings>({
    transport_price_per_kg_fcfa: 0,
    commission_percent: 0,
    customs_percent: 0,
    cny_to_fcfa_rate: null,
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    if (sessionLoading) return
    let active = true
    async function init() {
      if (!userId || !canAccessAdminPath(role, '/admin/parametres')) {
        if (active) setChecking(false)
        return
      }
      try {
        const { data, error } = await supabase.auth.getSession()
        if (error) throw error
        const token = data.session?.access_token
        if (!token) throw new Error('Votre session a expiré. Reconnectez-vous.')
        const res = await fetch('/api/admin/app-settings', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const loadedSettings = await readSettingsResponse(res)
        if (!active) return
        setSettings({
          transport_price_per_kg_fcfa: Number(loadedSettings.transport_price_per_kg_fcfa ?? 0),
          commission_percent: Number(loadedSettings.commission_percent ?? 0),
          customs_percent: Number(loadedSettings.customs_percent ?? 0),
          cny_to_fcfa_rate: loadedSettings.cny_to_fcfa_rate == null ? null : Number(loadedSettings.cny_to_fcfa_rate),
          updated_at: loadedSettings.updated_at ?? null,
        })
        setSettingsLoaded(true)
        setSettingsLoadError('')
      } catch (error) {
        if (!active) return
        setSettingsLoaded(false)
        setSettingsLoadError(error instanceof Error ? error.message : 'Impossible de charger les paramètres.')
      } finally {
        if (active) setChecking(false)
      }
    }
    void init()
    return () => { active = false }
  }, [loadAttempt, role, sessionLoading, userId])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!settingsLoaded) return
    setSaving(true)
    setSaveError('')
    try {
      const { data, error } = await supabase.auth.getSession()
      if (error) throw error
      const token = data.session?.access_token
      if (!token) throw new Error('Votre session a expiré. Reconnectez-vous.')
      const res = await fetch('/api/admin/app-settings', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Les paramètres n’ont pas pu être enregistrés.')
      if (!body?.settings) throw new Error('La réponse d’enregistrement des paramètres est invalide.')
      setSettings({
        transport_price_per_kg_fcfa: Number(body.settings.transport_price_per_kg_fcfa),
        commission_percent: Number(body.settings.commission_percent),
        customs_percent: Number(body.settings.customs_percent ?? 0),
        cny_to_fcfa_rate: body.settings.cny_to_fcfa_rate == null || body.settings.cny_to_fcfa_rate === '' ? null : Number(body.settings.cny_to_fcfa_rate),
        updated_at: body.settings.updated_at ?? null,
      })
      toast({
        title: 'Paramètres enregistrés',
        description: 'Les prix des produits importés seront recalculés avec ces valeurs.',
        variant: 'success',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Les paramètres n’ont pas pu être enregistrés.'
      setSaveError(message)
      toast({ title: 'Enregistrement impossible', description: message, variant: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  function retrySettingsLoad() {
    setSettingsLoadError('')
    setChecking(true)
    setLoadAttempt((attempt) => attempt + 1)
  }

  if (sessionLoading) {
    return <main className="admin-page"><div className="admin-state">Vérification de l’accès…</div></main>
  }
  if (checking) {
    return (
      <main className="admin-page">
        <div className="admin-shell">
          <PageHeader title="Paramètres" description="Chargement des paramètres…" eyebrow="JALIMS · ADMINISTRATION" />
          <Card title="Chargement des paramètres"><Skeleton variant="rect" width="100%" height={280} /></Card>
        </div>
      </main>
    )
  }
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
        <PageHeader
          eyebrow="JALIMS · ADMINISTRATION"
          title="Paramètres"
          description="Paramètres de calcul du prix des produits importés (origine Chine). Les produits locaux ne sont pas impactés."
        />
        {settingsLoadError ? (
          <Card title="Impossible de charger les paramètres">
            <EmptyState
              title="Les valeurs enregistrées n’ont pas été chargées"
              description={settingsLoadError}
              action={<Button onClick={retrySettingsLoad}>Réessayer</Button>}
            />
          </Card>
        ) : (
          <Card title="Calcul du prix" description="Paramètres appliqués aux produits importés.">
            <form onSubmit={onSubmit}>
              <Input
                label="Prix du transport par kg (FCFA)"
                type="number"
                min="0"
                step="0.01"
                required
                value={settings.transport_price_per_kg_fcfa}
                onChange={(event) => setSettings((current) => ({ ...current, transport_price_per_kg_fcfa: Number(event.target.value) }))}
                hint="Utilisé pour les produits importés : transport = poids (kg) × prix par kg."
                disabled={!settingsLoaded || saving}
              />
              <Input
                label="Dédouanement (%)"
                type="number"
                min="0"
                step="0.01"
                required
                value={settings.customs_percent}
                onChange={(event) => setSettings((current) => ({ ...current, customs_percent: Number(event.target.value) }))}
                hint="Dédouanement appliqué sur (prix produit converti + transport + autres frais), inclus dans la base avant commission."
                disabled={!settingsLoaded || saving}
              />
              <Input
                label="Commission Jalims (%)"
                type="number"
                min="0"
                step="0.01"
                required
                value={settings.commission_percent}
                onChange={(event) => setSettings((current) => ({ ...current, commission_percent: Number(event.target.value) }))}
                hint="Commission appliquée sur la base (prix produit + transport + autres frais + dédouanement) des produits importés."
                disabled={!settingsLoaded || saving}
              />
              <Input
                label="Taux de change : 1 yuan (CNY) = X FCFA"
                type="number"
                min="0.000001"
                step="0.000001"
                value={settings.cny_to_fcfa_rate ?? ''}
                onChange={(event) => setSettings((current) => ({ ...current, cny_to_fcfa_rate: event.target.value === '' ? null : Number(event.target.value) }))}
                hint="Si le prix de base d’un produit importé est en yuan, il est converti en FCFA avec ce taux. Laissez vide si non renseigné."
                disabled={!settingsLoaded || saving}
              />
              {missingCnyRate && (
                <Card title="Taux CNY/FCFA manquant">
                  <p role="alert">
                    Le calcul dynamique n’est pas appliqué aux produits importés dont le prix de base est en yuan ; le prix enregistré du produit (<code>products.price</code>) sera utilisé.
                  </p>
                </Card>
              )}
              {saveError && (
                <Card title="Enregistrement impossible">
                  <p role="alert">{saveError}</p>
                </Card>
              )}
              <Button type="submit" loading={saving} disabled={!settingsLoaded || saving}>
                Enregistrer les paramètres
              </Button>
            </form>
          </Card>
        )}
      </div>
    </main>
  )
}
