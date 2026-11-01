'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'

type Overview = {
  revenue: number
  paid_orders: number
  average_basket: number
  new_accounts: number
  accounts_without_order: number
  orders_to_process: number
  unpaid_carts_over_one_hour: number
}

type SalesDay = { date: string; revenue: number; orders: number }
type TopProduct = { product_id: string; name: string; units: number; revenue: number; estimated_margin: number | null }
type CategoryRow = { category: string; units: number; revenue: number; orders: number }
type StatusRow = { status: string; orders: number }
type PickupDelay = { average_hours: number | null; orders: number }
type StatsPayload = {
  overview: Overview
  salesByDay: SalesDay[]
  topProducts: TopProduct[]
  categories: CategoryRow[]
  statuses: StatusRow[]
  pickupDelay: PickupDelay
}

const periodLabels: Record<string, string> = {
  '7': '7 derniers jours',
  '30': '30 derniers jours',
  '90': '90 derniers jours',
  all: 'Depuis le début',
}

const statusLabels: Record<string, string> = {
  pending_payment: 'En attente de paiement',
  payé: 'Payé',
  commandé_fournisseur: 'Commandé au fournisseur',
  chez_transitaire: 'Chez le transitaire',
  en_transit: 'En transit',
  arrivé: 'Arrivé au Sénégal',
  prête_a_retirer: 'Prête à retirer',
  récupéré: 'Récupéré',
  cancelled: 'Annulé',
}

function formatMoney(value: number) {
  return `${Number(value || 0).toLocaleString('fr-FR')} FCFA`
}

function formatDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

async function readResponse(response: Response) {
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('La réponse du serveur est invalide.')
  }
  const result = body as Record<string, unknown>
  if (!response.ok) {
    throw new Error(typeof result.error === 'string' ? result.error : 'Les statistiques n’ont pas pu être chargées.')
  }
  return result as unknown as StatsPayload
}

function SalesChart({ sales }: { sales: SalesDay[] }) {
  if (sales.length === 0) {
    return <p className="admin-stats-empty">Aucune vente sur cette période. Les ventes payées apparaîtront ici.</p>
  }

  const width = 800
  const height = 250
  const graphTop = 18
  const graphHeight = 178
  const graphWidth = 760
  const maxRevenue = Math.max(...sales.map((sale) => Number(sale.revenue) || 0), 1)
  const slotWidth = graphWidth / sales.length
  const barWidth = Math.max(2, Math.min(24, slotWidth * 0.62))
  const labelStep = Math.max(1, Math.ceil(sales.length / 7))

  return (
    <div className="admin-stats-chart-scroll">
      <svg className="admin-stats-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Chiffre d’affaires journalier">
        <line x1="20" y1={graphTop + graphHeight} x2="780" y2={graphTop + graphHeight} />
        {sales.map((sale, index) => {
          const value = Number(sale.revenue) || 0
          const barHeight = (value / maxRevenue) * graphHeight
          const x = 20 + index * slotWidth + (slotWidth - barWidth) / 2
          const y = graphTop + graphHeight - barHeight
          return (
            <g key={sale.date}>
              <title>{`${formatDate(sale.date)} : ${formatMoney(value)} · ${sale.orders} commande${sale.orders === 1 ? '' : 's'}`}</title>
              <rect x={x} y={y} width={barWidth} height={Math.max(barHeight, 1)} rx="3" />
              {(index % labelStep === 0 || index === sales.length - 1) && (
                <text x={x + barWidth / 2} y={graphTop + graphHeight + 23} textAnchor="middle">{formatDate(sale.date)}</text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function Skeletons() {
  return (
    <>
      <div className="admin-stats-cards" aria-label="Chargement des indicateurs">
        {Array.from({ length: 7 }, (_, index) => <div className="admin-stats-skeleton" key={index} />)}
      </div>
      <div className="admin-stats-panel admin-stats-chart-skeleton" aria-hidden="true">
        <div className="admin-stats-skeleton" />
      </div>
      <div className="admin-stats-grid">
        <div className="admin-stats-panel admin-stats-skeleton-table" />
        <div className="admin-stats-panel admin-stats-skeleton-table" />
      </div>
    </>
  )
}

export default function AdminStatisticsPage() {
  const [period, setPeriod] = useState('30')
  const [stats, setStats] = useState<StatsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    async function loadStats() {
      setLoading(true)
      setErrorMessage('')
      const { data, error } = await supabase.auth.getSession()
      if (error || !data.session?.access_token) {
        setStats(null)
        setErrorMessage('Connectez-vous avec le compte administrateur pour consulter les statistiques.')
        setLoading(false)
        return
      }

      try {
        const response = await fetch(`/api/admin/stats?period=${period}`, {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
          signal: controller.signal,
        })
        const result = await readResponse(response)
        setStats(result)
      } catch (error) {
        if (controller.signal.aborted) return
        setStats(null)
        setErrorMessage(error instanceof Error ? error.message : 'Les statistiques n’ont pas pu être chargées.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void loadStats()
    return () => controller.abort()
  }, [period])

  const overview = stats?.overview
  const cards = overview ? [
    { label: 'Chiffre d’affaires', value: formatMoney(overview.revenue), note: 'Commandes payées sur la période' },
    { label: 'Commandes payées', value: overview.paid_orders.toLocaleString('fr-FR'), note: 'Hors paiements en attente et annulations' },
    { label: 'Panier moyen', value: formatMoney(overview.average_basket), note: 'Moyenne des commandes payées' },
    { label: 'Nouveaux comptes', value: overview.new_accounts.toLocaleString('fr-FR'), note: 'Créés sur la période' },
    { label: 'Sans commande', value: overview.accounts_without_order.toLocaleString('fr-FR'), note: 'Comptes sans commande enregistrée' },
    { label: 'À traiter', value: overview.orders_to_process.toLocaleString('fr-FR'), note: 'Commandes au statut « Payé »' },
    { label: 'Paniers non payés', value: overview.unpaid_carts_over_one_hour.toLocaleString('fr-FR'), note: 'En attente depuis plus d’une heure' },
  ] : []

  return (
    <main className="admin-page">
      <div className="admin-shell">
        <header className="admin-header">
          <div>
            <p className="eyebrow">JALIMS <span className="admin-header-divider">/</span> ESPACE ADMIN</p>
            <h1>Statistiques</h1>
            <p>Suivez les ventes, les commandes et les comptes clients.</p>
          </div>
          <label className="admin-stats-period">
            <span>Période</span>
            <select value={period} onChange={(event) => setPeriod(event.target.value)}>
              {Object.entries(periodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </header>
        <nav className="admin-shortcuts" aria-label="Outils d’administration">
          <Link className="admin-nav-item" href="/admin"><span className="admin-nav-icon" aria-hidden="true">▦</span> Produits</Link>
          <Link className="admin-nav-item" href="/admin/commandes"><span className="admin-nav-icon" aria-hidden="true">↗</span> Commandes</Link>
          <Link className="admin-nav-item" href="/admin/clients"><span className="admin-nav-icon" aria-hidden="true">♙</span> Clients</Link>
          <Link className="admin-nav-item current" href="/admin/statistiques"><span className="admin-nav-icon" aria-hidden="true">▤</span> Statistiques</Link>
          <Link className="admin-nav-item" href="/admin/accueil"><span className="admin-nav-icon" aria-hidden="true">T</span> Textes accueil</Link>
        </nav>

        {loading ? <Skeletons /> : errorMessage ? (
          <section className="admin-stats-error" role="alert">
            <h2>Les statistiques sont indisponibles</h2>
            <p>{errorMessage}</p>
            <Link href="/login?next=%2Fadmin%2Fstatistiques">Se connecter</Link>
          </section>
        ) : stats ? (
          <>
            <p className="admin-stats-period-note">Données : {periodLabels[period].toLocaleLowerCase()}.</p>
            <section className="admin-stats-cards" aria-label="Indicateurs clés">
              {cards.map((card) => (
                <article className="admin-stats-card" key={card.label}>
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                  <small>{card.note}</small>
                </article>
              ))}
            </section>

            <section className="admin-stats-panel">
              <div className="admin-stats-heading">
                <div><p className="eyebrow">ÉVOLUTION</p><h2>Ventes par jour</h2></div>
                <span>Chiffre d’affaires · FCFA</span>
              </div>
              <SalesChart sales={stats.salesByDay} />
            </section>

            <div className="admin-stats-grid">
              <section className="admin-stats-panel">
                <div className="admin-stats-heading"><div><p className="eyebrow">TOP 10</p><h2>Meilleures ventes</h2></div></div>
                {stats.topProducts.length === 0 ? <p className="admin-stats-empty">Aucune vente enregistrée sur cette période.</p> : (
                  <div className="admin-stats-table-wrap">
                    <table className="admin-stats-table">
                      <thead><tr><th>Produit</th><th>Unités</th><th>Ventes</th><th>Marge estimée</th></tr></thead>
                      <tbody>{stats.topProducts.map((product) => (
                        <tr key={product.product_id}>
                          <th scope="row">{product.name}</th>
                          <td>{product.units.toLocaleString('fr-FR')}</td>
                          <td>{formatMoney(product.revenue)}</td>
                          <td>{product.estimated_margin === null ? '—' : formatMoney(product.estimated_margin)}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </section>
              <section className="admin-stats-panel">
                <div className="admin-stats-heading"><div><p className="eyebrow">VENTES</p><h2>Par catégorie</h2></div></div>
                {stats.categories.length === 0 ? <p className="admin-stats-empty">Aucune vente par catégorie sur cette période.</p> : (
                  <div className="admin-stats-table-wrap">
                    <table className="admin-stats-table">
                      <thead><tr><th>Catégorie</th><th>Unités</th><th>Commandes</th><th>Ventes</th></tr></thead>
                      <tbody>{stats.categories.map((row) => (
                        <tr key={row.category}><th scope="row">{row.category}</th><td>{row.units.toLocaleString('fr-FR')}</td><td>{row.orders.toLocaleString('fr-FR')}</td><td>{formatMoney(row.revenue)}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>

            <div className="admin-stats-grid">
              <section className="admin-stats-panel">
                <div className="admin-stats-heading"><div><p className="eyebrow">COMMANDES</p><h2>Répartition par statut</h2></div></div>
                {stats.statuses.length === 0 ? <p className="admin-stats-empty">Aucune commande sur cette période.</p> : (
                  <ul className="admin-stats-status-list">
                    {stats.statuses.map((row) => <li key={row.status}><span>{statusLabels[row.status] ?? row.status}</span><strong>{row.orders.toLocaleString('fr-FR')}</strong></li>)}
                  </ul>
                )}
              </section>
              <section className="admin-stats-panel admin-stats-delay">
                <p className="eyebrow">RETRAIT</p>
                <h2>Délai paiement → retrait</h2>
                {stats.pickupDelay.average_hours === null
                  ? <strong>—</strong>
                  : <strong>{stats.pickupDelay.average_hours.toLocaleString('fr-FR')} h</strong>}
                <p>{stats.pickupDelay.orders.toLocaleString('fr-FR')} commande{stats.pickupDelay.orders === 1 ? '' : 's'} récupérée{stats.pickupDelay.orders === 1 ? '' : 's'} mesurée{stats.pickupDelay.orders === 1 ? '' : 's'}.</p>
              </section>
            </div>
          </>
        ) : null}
      </div>
    </main>
  )
}
