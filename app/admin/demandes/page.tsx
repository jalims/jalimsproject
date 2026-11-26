'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { canAccessAdminPath } from '../../../lib/admin-staff-client'
import { supabase } from '../../../lib/supabase'
import { useAdminSession } from '../admin-session-provider'

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
  const hasSession = Boolean(userId)
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_OPTIONS)[number]['value']>('all')
  const [requests, setRequests] = useState<ProductRequest[]>([])
  const [newCount, setNewCount] = useState(0)
  const [zeroResultSearches, setZeroResultSearches] = useState<SearchMetric[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<Record<string, string>>({})
  const [savedId, setSavedId] = useState<string | null>(null)

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
      setNewCount(typeof body.newCount === 'number' ? body.newCount : 0)
      setZeroResultSearches(isSearchMetricArray(body.zeroResultSearches) ? body.zeroResultSearches : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger les demandes.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (checking) return
    if (!hasSession || !canAccessAdminPath(role, '/admin/demandes')) {
      setLoading(false)
      return
    }
    void loadRequests(statusFilter)
  }, [checking, hasSession, role, statusFilter, loadRequests])

  function updateRequest(id: string, patch: Partial<Pick<ProductRequest, 'status' | 'admin_notes' | 'quoted_price'>>) {
    setRequests((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
    setSavedId(null)
  }

  async function saveRequest(item: ProductRequest) {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) {
      setSaveError((current) => ({ ...current, [item.id]: 'Votre session a expiré. Reconnectez-vous.' }))
      return
    }

    setSavingId(item.id)
    setSaveError((current) => ({ ...current, [item.id]: '' }))
    try {
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
      if (typeof body.newCount === 'number') setNewCount(body.newCount)
      if (body.request) {
        setRequests((current) => current.map((row) => (row.id === item.id ? { ...row, ...body.request } : row)))
      }
      setSavedId(item.id)
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
        <header className="admin-header">
          <div>
            <p className="eyebrow">JALIMS <span className="admin-header-divider">/</span> DEMANDES</p>
            <h1>Demandes produit</h1>
            <p>Produits recherchés ou demandés par les clients. Répondez sur WhatsApp sous 24h.</p>
          </div>
          <div className="admin-session">
            <Link href="/admin">← Tableau de bord</Link>
          </div>
        </header>

        <section className="admin-stats-panel" style={{ marginBottom: 20 }}>
          <div className="admin-stats-heading">
            <div>
              <p className="eyebrow">SANS RÉSULTAT</p>
              <h2>Recherches les plus demandées sans résultat</h2>
            </div>
            <span>Basé sur les recherches analytics (30 derniers jours). Priorité pour ajouter des produits.</span>
          </div>
          {loading ? (
            <p className="admin-stats-empty">Chargement…</p>
          ) : zeroResultSearches.length === 0 ? (
            <p className="admin-stats-empty">Aucune recherche sans résultat enregistrée sur cette période.</p>
          ) : (
            <div className="admin-stats-table-wrap">
              <table className="admin-stats-table">
                <thead><tr><th>Terme</th><th>Recherches</th><th>Visiteurs</th></tr></thead>
                <tbody>
                  {zeroResultSearches.map((row) => (
                    <tr key={row.term}>
                      <th scope="row">{row.term}</th>
                      <td>{row.searches.toLocaleString('fr-FR')}</td>
                      <td>{row.visitors.toLocaleString('fr-FR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="admin-stats-panel">
          <div className="admin-stats-heading" style={{ alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <p className="eyebrow">DEMANDES CLIENTS</p>
              <h2>Liste des demandes {newCount > 0 ? <span style={{ color: '#FE6E00', fontSize: 16, fontWeight: 700 }}>({newCount} nouvelle{newCount > 1 ? 's' : ''})</span> : null}</h2>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {STATUS_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setStatusFilter(option.value)}
                  style={{
                    minHeight: 40,
                    padding: '0 14px',
                    borderRadius: 999,
                    border: statusFilter === option.value ? '1px solid #FE6E00' : '1px solid #d1d5db',
                    background: statusFilter === option.value ? '#fff3e8' : '#fff',
                    color: statusFilter === option.value ? '#FE6E00' : '#373430',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="admin-analytics-error" role="alert">{error}</p>}

          {loading ? (
            <p className="admin-stats-empty">Chargement des demandes…</p>
          ) : requests.length === 0 ? (
            <p className="admin-stats-empty">Aucune demande pour ce filtre.</p>
          ) : (
            <div style={{ display: 'grid', gap: 16 }}>
              {requests.map((item) => (
                <article key={item.id} style={{ border: '1px solid #e5e7eb', borderRadius: 18, padding: 16, display: 'grid', gap: 14, background: '#fff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    <div>
                      <p style={{ margin: 0, color: '#6b7280', fontSize: 13 }}>{formatDate(item.created_at)}</p>
                      <p style={{ margin: '4px 0 0', color: '#373430', fontSize: 18, fontWeight: 700 }}>
                        {item.search_query?.trim() ? `Recherche : « ${item.search_query.trim()} »` : 'Demande sans terme recherché'}
                      </p>
                    </div>
                    <span style={{
                      padding: '6px 12px',
                      borderRadius: 999,
                      fontSize: 13,
                      fontWeight: 700,
                      background: item.status === 'new' ? '#fff3e8' : '#f3f4f6',
                      color: item.status === 'new' ? '#FE6E00' : '#374151',
                      border: item.status === 'new' ? '1px solid #ffd8b5' : '1px solid #e5e7eb',
                    }}>
                      {STATUS_LABELS[item.status] ?? item.status}
                    </span>
                  </div>

                  <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                    <div style={{ display: 'grid', gap: 10 }}>
                      {item.image_url ? (
                        <a href={item.image_url} target="_blank" rel="noreferrer">
                          <img src={item.image_url} alt="Photo du produit demandé" style={{ width: '100%', maxWidth: 320, height: 220, objectFit: 'cover', borderRadius: 14, border: '1px solid #e5e7eb', background: '#f9fafb' }} />
                        </a>
                      ) : (
                        <div style={{ width: '100%', maxWidth: 320, height: 220, borderRadius: 14, border: '1px dashed #d1d5db', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', background: '#f9fafb' }}>
                          Aucune photo
                        </div>
                      )}

                      {item.description?.trim() && (
                        <div>
                          <p style={{ margin: '0 0 4px', color: '#6b7280', fontSize: 13, fontWeight: 600 }}>Description / quantité</p>
                          <p style={{ margin: 0, color: '#373430', whiteSpace: 'pre-wrap' }}>{item.description}</p>
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <a
                          href={buildWhatsAppUrl(item)}
                          target="_blank"
                          rel="noreferrer"
                          style={{ minHeight: 44, padding: '0 14px', borderRadius: 12, background: '#16a34a', color: '#fff', fontWeight: 700, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
                        >
                          WhatsApp ({item.whatsapp})
                        </a>
                        {item.link && (
                          <a
                            href={item.link}
                            target="_blank"
                            rel="noreferrer"
                            style={{ minHeight: 44, padding: '0 14px', borderRadius: 12, border: '1px solid #d1d5db', color: '#373430', fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', background: '#fff' }}
                          >
                            Ouvrir le lien
                          </a>
                        )}
                      </div>

                      <div style={{ display: 'grid', gap: 6 }}>
                        <label htmlFor={`status-${item.id}`} style={{ fontWeight: 600, color: '#373430' }}>Statut</label>
                        <select
                          id={`status-${item.id}`}
                          value={item.status}
                          onChange={(event) => updateRequest(item.id, { status: event.target.value })}
                          style={{ minHeight: 48, borderRadius: 12, border: '1px solid #95938E', padding: '0 12px', fontSize: 16, color: '#373430', background: '#fff' }}
                        >
                          {STATUS_OPTIONS.filter((option) => option.value !== 'all').map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>

                      <div style={{ display: 'grid', gap: 6 }}>
                        <label htmlFor={`price-${item.id}`} style={{ fontWeight: 600, color: '#373430' }}>Prix proposé (FCFA)</label>
                        <input
                          id={`price-${item.id}`}
                          type="text"
                          inputMode="decimal"
                          value={item.quoted_price}
                          onChange={(event) => updateRequest(item.id, { quoted_price: event.target.value })}
                          placeholder="Ex : 25000"
                          style={{ minHeight: 48, borderRadius: 12, border: '1px solid #95938E', padding: '0 12px', fontSize: 16, color: '#373430' }}
                        />
                      </div>

                      <div style={{ display: 'grid', gap: 6 }}>
                        <label htmlFor={`notes-${item.id}`} style={{ fontWeight: 600, color: '#373430' }}>Notes internes</label>
                        <textarea
                          id={`notes-${item.id}`}
                          value={item.admin_notes}
                          onChange={(event) => updateRequest(item.id, { admin_notes: event.target.value })}
                          rows={4}
                          placeholder="Notes pour l’équipe, devis, suivi…"
                          style={{ borderRadius: 12, border: '1px solid #95938E', padding: '10px 12px', fontSize: 16, color: '#373430', fontFamily: 'inherit', resize: 'vertical' }}
                        />
                      </div>

                      {saveError[item.id] && <p className="admin-analytics-error" role="alert" style={{ margin: 0 }}>{saveError[item.id]}</p>}
                      {savedId === item.id && !saveError[item.id] && <p style={{ margin: 0, color: '#15803d', fontWeight: 600 }}>Modifications enregistrées.</p>}

                      <div>
                        <button
                          type="button"
                          onClick={() => void saveRequest(item)}
                          disabled={savingId === item.id}
                          className="product-request-submit"
                          style={{ width: 'auto', minWidth: 220 }}
                        >
                          {savingId === item.id ? 'Enregistrement…' : 'Enregistrer'}
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
