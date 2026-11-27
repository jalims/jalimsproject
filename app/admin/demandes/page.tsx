'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { canAccessAdminPath } from '../../../lib/admin-staff-client'
import { supabase } from '../../../lib/supabase'
import { useAdminSession } from '../admin-session-provider'
import { useAdminDashboard } from '../admin-dashboard-context'
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Tabs,
  Textarea,
  useToast,
  type DataTableColumn,
} from '../_components'

type SearchMetric = { term: string; searches: number; visitors: number }

type ProductRequest = {
  id: string
  created_at: string
  search_query: string
  whatsapp: string
  link: string | null
  description: string | null
  image_path: string | null
  image_url: string | null
  user_id: string | null
  status: string
  admin_notes: string
  quoted_price: string
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'Toutes' },
  { value: 'new', label: 'Nouvelles' },
  { value: 'en_cours', label: 'En cours' },
  { value: 'devis_envoye', label: 'Devis envoyé' },
  { value: 'converti', label: 'Converti' },
  { value: 'sans_suite', label: 'Sans suite' },
] as const

const STATUS_LABELS: Record<string, string> = {
  new: 'Nouvelle',
  en_cours: 'En cours',
  devis_envoye: 'Devis envoyé',
  converti: 'Converti',
  sans_suite: 'Sans suite',
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
}

function whatsappDigits(value: string) {
  return value.replace(/[^0-9]/g, '')
}

function buildWhatsAppUrl(request: ProductRequest) {
  const digits = whatsappDigits(request.whatsapp)
  const subject = request.search_query?.trim()
    ? `votre demande pour « ${request.search_query.trim()} »`
    : 'votre demande de produit'
  const text = `Bonjour, nous avons bien reçu ${subject} sur Jalims. Nous revenons vers vous avec un prix tout compris.`
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
}

async function readJson<T>(response: Response): Promise<T> {
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('Réponse du serveur invalide.')
  }
  return body as T
}

function isSearchMetricArray(value: unknown): value is SearchMetric[] {
  return Array.isArray(value) && value.every((row) => (
    typeof row === 'object' && row !== null
    && typeof (row as SearchMetric).term === 'string'
    && typeof (row as SearchMetric).searches === 'number'
    && typeof (row as SearchMetric).visitors === 'number'
  ))
}

export default function AdminDemandesPage() {
  const { userId, role, loading: checking } = useAdminSession()
  const { updateNewRequestCount } = useAdminDashboard()
  const { toast } = useToast()
  const hasSession = Boolean(userId)
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_OPTIONS)[number]['value']>('all')
  const [requests, setRequests] = useState<ProductRequest[]>([])
  const [newCount, setNewCount] = useState(0)
  const [zeroResultSearches, setZeroResultSearches] = useState<SearchMetric[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<Record<string, string>>({})

  const loadRequests = useCallback(async (filter: string) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) {
      setError('Votre session a expiré. Reconnectez-vous.')
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/admin/product-requests?status=${encodeURIComponent(filter)}&period=30`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const body = await readJson<{ error?: string; requests?: unknown; newCount?: number; zeroResultSearches?: unknown }>(response)
      if (!response.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : 'Impossible de charger les demandes.')
      }
      const list = Array.isArray(body.requests) ? body.requests as ProductRequest[] : []
      setRequests(list.map((item) => ({
        ...item,
        admin_notes: item.admin_notes ?? '',
        quoted_price: item.quoted_price ?? '',
      })))
      const count = typeof body.newCount === 'number' ? body.newCount : 0
      setNewCount(count)
      updateNewRequestCount(count)
      setZeroResultSearches(isSearchMetricArray(body.zeroResultSearches) ? body.zeroResultSearches : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger les demandes.')
    } finally {
      setLoading(false)
    }
  }, [updateNewRequestCount])

  useEffect(() => {
    if (checking) return
    if (!hasSession || !canAccessAdminPath(role, '/admin/demandes')) {
      setLoading(false)
      return
    }
    void loadRequests(statusFilter)
  }, [checking, hasSession, role, statusFilter, loadRequests])

  const zeroResultColumns: DataTableColumn<SearchMetric>[] = [
    { key: 'term', label: 'Terme recherché', render: (row) => row.term },
    { key: 'searches', label: 'Recherches', render: (row) => row.searches.toLocaleString('fr-FR') },
    { key: 'visitors', label: 'Visiteurs', render: (row) => row.visitors.toLocaleString('fr-FR') },
  ]

  function updateRequest(id: string, patch: Partial<Pick<ProductRequest, 'status' | 'admin_notes' | 'quoted_price'>>) {
    setRequests((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  async function saveRequest(item: ProductRequest) {
    setSavingId(item.id)
    setSaveError((current) => ({ ...current, [item.id]: '' }))
    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (sessionError || !token) {
        throw new Error('Votre session a expiré. Reconnectez-vous.')
      }

      const response = await fetch('/api/admin/product-requests', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: item.id,
          status: item.status,
          admin_notes: item.admin_notes,
          quoted_price: item.quoted_price,
        }),
      })
      const body = await readJson<{ error?: string; newCount?: number; request?: { id: string; status: string; admin_notes: string; quoted_price: string } }>(response)
      if (!response.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : 'La demande n’a pas pu être enregistrée.')
      }
      if (typeof body.newCount === 'number') {
        setNewCount(body.newCount)
        updateNewRequestCount(body.newCount)
      }
      if (body.request) {
        setRequests((current) => current.map((row) => (row.id === item.id ? { ...row, ...body.request } : row)))
      }
      toast({ title: 'Demande enregistrée', description: 'Les modifications ont été sauvegardées.', variant: 'success' })
    } catch (err) {
      setSaveError((current) => ({ ...current, [item.id]: err instanceof Error ? err.message : 'Enregistrement impossible.' }))
    } finally {
      setSavingId(null)
    }
  }

  if (checking) {
    return <main className="admin-page"><div className="admin-state">Vérification de l’accès…</div></main>
  }

  if (!hasSession) {
    return (
      <main className="admin-page">
        <section className="admin-access-state">
          <p className="eyebrow">ESPACE D’ADMINISTRATION</p>
          <h1>Connexion requise</h1>
          <p>Connectez-vous avec un compte autorisé pour gérer les demandes.</p>
          <Link className="admin-primary-link" href="/login?next=%2Fadmin%2Fdemandes">Se connecter</Link>
        </section>
      </main>
    )
  }

  if (!canAccessAdminPath(role, '/admin/demandes')) {
    return (
      <main className="admin-page">
        <section className="admin-access-state">
          <p className="eyebrow">ESPACE D’ADMINISTRATION</p>
          <h1>Accès refusé</h1>
          <p>Votre rôle ne permet pas d’accéder aux demandes produit.</p>
          <Link className="admin-primary-link" href="/admin">Retour au tableau de bord</Link>
        </section>
      </main>
    )
  }

  return (
    <main className="admin-page">
      <div className="admin-shell">
        <PageHeader
          title="Demandes produit"
          description="Produits recherchés ou demandés par les clients. Répondez sur WhatsApp sous 24h."
          eyebrow="JALIMS · DEMANDES"
          actions={<Link className="admin-secondary-link" href="/admin">← Tableau de bord</Link>}
        />

        <Card
          title="Recherches sans résultat"
          description="Analytics des 30 derniers jours · priorités potentielles pour le catalogue."
        >
          {error ? (
            <p role="alert">{error}</p>
          ) : (
            <DataTable
              columns={zeroResultColumns}
              rows={zeroResultSearches}
              rowKey={(row) => row.term}
              caption="Recherches les plus fréquentes sans résultat sur les 30 derniers jours"
              loading={loading}
              loadingRows={4}
              emptyState={<EmptyState title="Aucune recherche sans résultat" description="Aucune donnée enregistrée sur les 30 derniers jours." />}
            />
          )}
        </Card>

        <Card
          title="Demandes clients"
          description="Consultez et mettez à jour les demandes produit."
          actions={(
            <Badge variant={newCount > 0 ? 'brand' : 'neutral'}>
              {newCount} nouvelle{newCount === 1 ? '' : 's'}
            </Badge>
          )}
        >
          <Tabs
            label="Filtrer les demandes par statut"
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as (typeof STATUS_OPTIONS)[number]['value'])}
            items={STATUS_OPTIONS.map((option) => ({ id: option.value, label: option.label }))}
          />
        </Card>

        {error && (
          <Card title="Impossible de charger les demandes">
            <p role="alert">{error}</p>
            <Button variant="outline" onClick={() => void loadRequests(statusFilter)}>Réessayer</Button>
          </Card>
        )}

        {loading ? (
          <div className="admin-stats-grid" aria-label="Chargement des demandes" aria-busy="true">
            {Array.from({ length: 2 }, (_, index) => (
              <Card key={index} title="Chargement de la demande">
                <Skeleton variant="rect" className="admin-stats-skeleton-table" />
              </Card>
            ))}
          </div>
        ) : error ? null : requests.length === 0 ? (
          <EmptyState title="Aucune demande pour ce filtre" description="Les nouvelles demandes apparaîtront ici." />
        ) : (
          <div className="admin-stats-grid">
            {requests.map((item) => (
              <Card
                key={item.id}
                title={item.search_query?.trim()
                  ? `Recherche : « ${item.search_query.trim()} »`
                  : 'Demande sans terme recherché'}
                description={formatDate(item.created_at)}
                actions={<Badge variant={item.status === 'new' ? 'brand' : 'neutral'}>{STATUS_LABELS[item.status] ?? item.status}</Badge>}
              >
                <div className="admin-stats-grid">
                  <div>
                    {item.image_url ? (
                      <a href={item.image_url} target="_blank" rel="noreferrer">
                        <Image
                          src={item.image_url}
                          alt="Photo du produit demandé"
                          width={320}
                          height={220}
                          sizes="(max-width: 700px) 100vw, 320px"
                        />
                      </a>
                    ) : (
                      <EmptyState title="Aucune photo" />
                    )}
                    {item.description?.trim() && (
                      <div>
                        <h3>Description / quantité</h3>
                        <p>{item.description}</p>
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="admin-ui-page-actions">
                      <a className="admin-primary-link" href={buildWhatsAppUrl(item)} target="_blank" rel="noreferrer">
                        WhatsApp ({item.whatsapp})
                      </a>
                      {item.link && (
                        <a className="admin-secondary-link" href={item.link} target="_blank" rel="noreferrer">
                          Ouvrir le lien source
                        </a>
                      )}
                    </div>

                    <Select
                      label="Statut"
                      value={item.status}
                      onChange={(event) => updateRequest(item.id, { status: event.target.value })}
                    >
                      {STATUS_OPTIONS.filter((option) => option.value !== 'all').map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </Select>

                    <Input
                      label="Prix proposé (FCFA)"
                      type="text"
                      inputMode="decimal"
                      value={item.quoted_price}
                      onChange={(event) => updateRequest(item.id, { quoted_price: event.target.value })}
                      placeholder="Ex : 25000"
                    />

                    <Textarea
                      label="Notes internes"
                      value={item.admin_notes}
                      onChange={(event) => updateRequest(item.id, { admin_notes: event.target.value })}
                      rows={4}
                      placeholder="Notes pour l’équipe, devis, suivi…"
                    />

                    {saveError[item.id] && <p className="admin-analytics-error" role="alert">{saveError[item.id]}</p>}
                    <Button
                      onClick={() => void saveRequest(item)}
                      loading={savingId === item.id}
                    >
                      Enregistrer
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
