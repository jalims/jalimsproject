'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { canAccessAdminPath } from '../../../lib/admin-staff-client'
import { supabase } from '../../../lib/supabase'
import { useAdminSession } from '../admin-session-provider'
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  Skeleton,
  StatCard,
  Tabs,
  useToast,
  type DataTableColumn,
} from '../_components'

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
type PickupDelay = { available: boolean; average_hours: number | null; orders: number }
type StatsPayload = {
  overview: Overview
  salesByDay: SalesDay[]
  topProducts: TopProduct[]
  categories: CategoryRow[]
  statuses: StatusRow[]
  pickupDelay: PickupDelay
  operationalCounts?: Pick<Overview, 'orders_to_process' | 'unpaid_carts_over_one_hour'>
}
type SearchMetric = { term: string; searches: number; visitors: number }
type ProductMetric = { product_id: string; name: string; views: number; visitors: number }
type UnderperformingProduct = ProductMetric & { orders: number }
type ProductFunnel = {
  product_id: string
  name: string
  views: number
  view_visitors: number
  add_to_cart: number
  cart_visitors: number
  orders: number
}
type AnalyticsPayload = {
  topSearches: SearchMetric[]
  zeroResultSearches: SearchMetric[]
  topProducts: ProductMetric[]
  productFunnel: ProductFunnel[]
  underperformingProducts: UnderperformingProduct[]
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

async function readResponse<T>(response: Response): Promise<T> {
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('La réponse du serveur est invalide.')
  }
  const result = body as Record<string, unknown>
  if (!response.ok) {
    throw new Error(typeof result.error === 'string' ? result.error : 'Les statistiques n’ont pas pu être chargées.')
  }
  return result as T
}

function SalesChart({ sales }: { sales: SalesDay[] }) {
  if (sales.length === 0) {
    return <EmptyState title="Aucune vente sur cette période" description="Les ventes payées apparaîtront ici." />
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

function StatisticsSkeletons() {
  return (
    <>
      <section className="admin-stats-cards" aria-label="Chargement des indicateurs" aria-busy="true">
        {Array.from({ length: 7 }, (_, index) => (
          <StatCard key={index} label="Chargement" value={<Skeleton />} />
        ))}
      </section>
      <Card title="Ventes par jour">
        <Skeleton variant="rect" className="admin-stats-chart-skeleton" />
      </Card>
      <div className="admin-stats-grid">
        <Card title="Chargement des tableaux"><Skeleton variant="rect" className="admin-stats-skeleton-table" /></Card>
        <Card title="Chargement des tableaux"><Skeleton variant="rect" className="admin-stats-skeleton-table" /></Card>
      </div>
    </>
  )
}

function RequestErrorCard({
  title,
  message,
  retrying,
  onRetry,
}: {
  title: string
  message: string
  retrying: boolean
  onRetry: () => void
}) {
  return (
    <Card title={title}>
      <p role="alert">{message}</p>
      <Button variant="outline" loading={retrying} onClick={onRetry}>Réessayer</Button>
    </Card>
  )
}

function AnalyticsSearchTable({ title, rows, empty, period }: {
  title: string
  rows: SearchMetric[]
  empty: string
  period: string
}) {
  const columns: DataTableColumn<SearchMetric>[] = [
    { key: 'term', label: 'Terme', render: (row) => row.term },
    { key: 'searches', label: 'Recherches', render: (row) => row.searches.toLocaleString('fr-FR') },
    { key: 'visitors', label: 'Visiteurs', render: (row) => row.visitors.toLocaleString('fr-FR') },
  ]

  return (
    <Card title={title} description={period}>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.term}
        caption={title}
        emptyState={<EmptyState title={empty} />}
      />
    </Card>
  )
}
export default function AdminStatisticsPage() {
  const { userId, role, loading: checking } = useAdminSession()
  const { toast } = useToast()
  const hasSession = Boolean(userId)
  const [period, setPeriod] = useState('30')
  const [stats, setStats] = useState<StatsPayload | null>(null)
  const [analytics, setAnalytics] = useState<AnalyticsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [analyticsLoading, setAnalyticsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [analyticsError, setAnalyticsError] = useState('')
  const [statsRetry, setStatsRetry] = useState(0)
  const [analyticsRetry, setAnalyticsRetry] = useState(0)

  const allowed = canAccessAdminPath(role, '/admin/statistiques')

  useEffect(() => {
    if (checking || !allowed) return
    const controller = new AbortController()
    async function loadStats() {
      setLoading(true)
      setErrorMessage('')
      try {
        const { data, error } = await supabase.auth.getSession()
        if (error || !data.session?.access_token) {
          throw new Error('Connectez-vous avec le compte administrateur pour consulter les statistiques.')
        }

        const params = new URLSearchParams({ period })
        if (period === 'all') params.set('operationalPeriod', 'all')
        const response = await fetch(`/api/admin/stats?${params}`, {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
          signal: controller.signal,
        })
        const result = await readResponse<StatsPayload>(response)
        if (
          period === 'all'
          && (
            !result.operationalCounts
            || !Number.isFinite(result.operationalCounts.orders_to_process)
            || !Number.isFinite(result.operationalCounts.unpaid_carts_over_one_hour)
          )
        ) {
          throw new Error('Les compteurs opérationnels ne sont pas disponibles.')
        }
        setStats(result)
      } catch (error) {
        if (controller.signal.aborted) return
        setStats(null)
        const message = error instanceof Error ? error.message : 'Les statistiques n’ont pas pu être chargées.'
        setErrorMessage(message)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void loadStats()
    return () => controller.abort()
  }, [allowed, checking, period, statsRetry, toast])

  useEffect(() => {
    if (checking || !allowed) return
    const controller = new AbortController()
    async function loadAnalytics() {
      setAnalyticsLoading(true)
      setAnalyticsError('')
      try {
        const { data, error } = await supabase.auth.getSession()
        if (error || !data.session?.access_token) {
          throw new Error('Connectez-vous avec le compte administrateur pour consulter les statistiques.')
        }

        const response = await fetch(`/api/admin/analytics?period=${period}`, {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
          signal: controller.signal,
          cache: 'no-store',
        })
        setAnalytics(await readResponse<AnalyticsPayload>(response))
      } catch (error) {
        if (controller.signal.aborted) return
        setAnalytics(null)
        const message = error instanceof Error ? error.message : 'Les statistiques de fréquentation n’ont pas pu être chargées.'
        setAnalyticsError(message)
      } finally {
        if (!controller.signal.aborted) setAnalyticsLoading(false)
      }
    }

    void loadAnalytics()
    return () => controller.abort()
  }, [allowed, analyticsRetry, checking, period, toast])

  function retryStats() {
    toast({ title: 'Nouvelle tentative', description: 'Rechargement des statistiques principales.', variant: 'info' })
    setStatsRetry((current) => current + 1)
  }

  function retryAnalytics() {
    toast({ title: 'Nouvelle tentative', description: 'Rechargement des analytics.', variant: 'info' })
    setAnalyticsRetry((current) => current + 1)
  }

  const overview = stats?.overview
  const ordersToProcess = period === 'all'
    ? stats?.operationalCounts?.orders_to_process
    : overview?.orders_to_process
  const unpaidCarts = period === 'all'
    ? stats?.operationalCounts?.unpaid_carts_over_one_hour
    : overview?.unpaid_carts_over_one_hour
  const periodDescription = periodLabels[period].toLocaleLowerCase()
  const cards = overview ? [
    { label: 'Chiffre d’affaires', value: formatMoney(overview.revenue), note: `Commandes payées · ${periodDescription}` },
    { label: 'Commandes payées', value: overview.paid_orders.toLocaleString('fr-FR'), note: `Hors paiements en attente et annulations · ${periodDescription}` },
    { label: 'Panier moyen', value: formatMoney(overview.average_basket), note: `Moyenne des commandes payées · ${periodDescription}` },
    { label: 'Nouveaux comptes', value: overview.new_accounts.toLocaleString('fr-FR'), note: `Créés sur ${periodDescription}` },
    { label: 'Sans commande', value: overview.accounts_without_order.toLocaleString('fr-FR'), note: 'Tous les comptes, indépendamment de la période sélectionnée' },
    { label: 'Commandes à traiter', value: Number(ordersToProcess ?? 0).toLocaleString('fr-FR'), note: `Statut « Payé » · ${periodDescription}` },
    { label: 'Paniers non payés', value: Number(unpaidCarts ?? 0).toLocaleString('fr-FR'), note: `En attente depuis plus d’une heure · ${periodDescription}` },
  ] : []
  const topProductColumns: DataTableColumn<TopProduct>[] = [
    { key: 'name', label: 'Produit', render: (row) => row.name },
    { key: 'units', label: 'Unités', render: (row) => row.units.toLocaleString('fr-FR') },
    { key: 'revenue', label: 'Ventes', render: (row) => formatMoney(row.revenue) },
    { key: 'margin', label: 'Marge estimée', render: (row) => row.estimated_margin === null ? '—' : formatMoney(row.estimated_margin) },
  ]
  const categoryColumns: DataTableColumn<CategoryRow>[] = [
    { key: 'category', label: 'Catégorie', render: (row) => row.category },
    { key: 'units', label: 'Unités', render: (row) => row.units.toLocaleString('fr-FR') },
    { key: 'orders', label: 'Commandes', render: (row) => row.orders.toLocaleString('fr-FR') },
    { key: 'revenue', label: 'Ventes', render: (row) => formatMoney(row.revenue) },
  ]
  const statusColumns: DataTableColumn<StatusRow>[] = [
    {
      key: 'status',
      label: 'Statut',
      render: (row) => <Badge variant="neutral">{statusLabels[row.status] ?? row.status}</Badge>,
    },
    { key: 'orders', label: 'Commandes', render: (row) => row.orders.toLocaleString('fr-FR') },
  ]
  const productMetricColumns: DataTableColumn<ProductMetric>[] = [
    { key: 'name', label: 'Produit', render: (row) => row.name },
    { key: 'views', label: 'Visites', render: (row) => row.views.toLocaleString('fr-FR') },
    { key: 'visitors', label: 'Visiteurs', render: (row) => row.visitors.toLocaleString('fr-FR') },
  ]
  const funnelColumns: DataTableColumn<ProductFunnel>[] = [
    { key: 'name', label: 'Produit', render: (row) => row.name },
    { key: 'views', label: 'Consultations', render: (row) => row.views.toLocaleString('fr-FR') },
    { key: 'view-visitors', label: 'Visiteurs', render: (row) => row.view_visitors.toLocaleString('fr-FR') },
    {
      key: 'cart',
      label: 'Ajouts panier',
      render: (row) => `${row.add_to_cart.toLocaleString('fr-FR')} · ${row.cart_visitors.toLocaleString('fr-FR')} visiteurs`,
    },
    { key: 'orders', label: 'Commandes payées', render: (row) => row.orders.toLocaleString('fr-FR') },
  ]
  const underperformingColumns: DataTableColumn<UnderperformingProduct>[] = [
    ...productMetricColumns,
    { key: 'orders', label: 'Commandes payées', render: (row) => row.orders.toLocaleString('fr-FR') },
  ]

  if (checking) return <main className="admin-page"><div className="admin-state">Vérification de l’accès...</div></main>
  if (!hasSession) {
    return (
      <main className="admin-page"><section className="admin-access-state">
        <p className="eyebrow">JALIMS · ADMINISTRATION</p>
        <h1>Accès réservé</h1>
        <p>Connectez-vous avec un compte autorisé pour consulter les statistiques.</p>
        <Link className="admin-primary-link" href="/login?next=%2Fadmin%2Fstatistiques">Se connecter</Link>
      </section></main>
    )
  }
  if (!allowed) {
    return (
      <main className="admin-page"><section className="admin-access-state">
        <p className="eyebrow">JALIMS · ADMINISTRATION</p>
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
          title="Statistiques"
          description="Suivez les ventes, les commandes et les comptes clients."
          eyebrow="JALIMS · ESPACE ADMIN"
          actions={(
            <Tabs
              id="statistics-period-tabs"
              panelId="statistics-period-panel"
              label="Période des statistiques"
              value={period}
              onChange={setPeriod}
              items={Object.entries(periodLabels).map(([id, label]) => ({ id, label }))}
            />
          )}
        />
        <div
          id="statistics-period-panel"
          role="tabpanel"
          aria-labelledby={`statistics-period-tabs-tab-${Object.keys(periodLabels).indexOf(period)}`}
          tabIndex={0}
        >
        {loading ? <StatisticsSkeletons /> : errorMessage ? (
          <RequestErrorCard
            title="Les statistiques sont indisponibles"
            message={errorMessage}
            retrying={loading}
            onRetry={retryStats}
          />
        ) : stats ? (
          <>
            <p className="admin-stats-period-note">Données : {periodDescription}.</p>
            <section className="admin-stats-cards" aria-label="Indicateurs clés">
              {cards.map((card) => (
                <StatCard
                  key={card.label}
                  label={card.label}
                  value={card.value}
                  trend={{ label: card.note }}
                />
              ))}
            </section>

            <Card title="Ventes par jour" description={`Chiffre d’affaires · FCFA · ${periodDescription}`}>
              <SalesChart sales={stats.salesByDay} />
            </Card>

            <div className="admin-stats-grid">
              <Card title="Meilleures ventes" description={`Top 10 · ${periodDescription}`}>
                <DataTable
                  columns={topProductColumns}
                  rows={stats.topProducts}
                  rowKey={(row) => row.product_id}
                  caption="Meilleures ventes par produit"
                  emptyState={<EmptyState title="Aucune vente enregistrée" description={periodLabels[period]} />}
                />
              </Card>
              <Card title="Ventes par catégorie" description={periodLabels[period]}>
                <DataTable
                  columns={categoryColumns}
                  rows={stats.categories}
                  rowKey={(row) => row.category}
                  caption="Ventes par catégorie"
                  emptyState={<EmptyState title="Aucune vente par catégorie" description={periodLabels[period]} />}
                />
              </Card>
            </div>

            <div className="admin-stats-grid">
              <Card title="Répartition des commandes par statut" description={periodLabels[period]}>
                <DataTable
                  columns={statusColumns}
                  rows={stats.statuses}
                  rowKey={(row) => row.status}
                  caption="Commandes par statut"
                  emptyState={<EmptyState title="Aucune commande" description={periodLabels[period]} />}
                />
              </Card>
              <Card title="Délai paiement → retrait" description={`Commandes récupérées · ${periodDescription}`}>
                {!stats.pickupDelay.available ? (
                  <EmptyState title="Indicateur non disponible" description="Les dates historiques de paiement et de retrait ne sont pas enregistrées." />
                ) : (
                  <StatCard
                    label="Délai moyen"
                    value={stats.pickupDelay.average_hours === null
                      ? '—'
                      : `${stats.pickupDelay.average_hours.toLocaleString('fr-FR')} h`}
                    trend={{ label: `${stats.pickupDelay.orders.toLocaleString('fr-FR')} commandes mesurées · ${periodDescription}` }}
                  />
                )}
              </Card>
            </div>
          </>
        ) : null}

        <Card
          title="Recherches des visiteurs"
          description={`Fréquentation pseudonyme · ${periodDescription}`}
        >
          <p>
            Événements envoyés par le navigateur : ces indicateurs de tendance peuvent être incomplets,
            approximatifs ou manipulés. Aucune adresse IP n’est enregistrée ; les recherches sont filtrées
            mais peuvent encore contenir des informations personnelles.
          </p>
          {analyticsError ? (
            <RequestErrorCard
              title="Les statistiques de fréquentation sont indisponibles"
              message={analyticsError}
              retrying={analyticsLoading}
              onRetry={retryAnalytics}
            />
          ) : analyticsLoading ? (
            <div className="admin-analytics-grid" aria-label="Chargement des statistiques de fréquentation">
              <Card title="Recherches fréquentes"><Skeleton variant="rect" className="admin-analytics-skeleton" /></Card>
              <Card title="Sans résultat"><Skeleton variant="rect" className="admin-analytics-skeleton" /></Card>
            </div>
          ) : analytics ? (
            <div className="admin-analytics-grid">
              <AnalyticsSearchTable
                title="Recherches fréquentes"
                rows={analytics.topSearches}
                empty="Aucune recherche enregistrée sur cette période."
                period={periodLabels[period]}
              />
              <AnalyticsSearchTable
                title="Sans résultat"
                rows={analytics.zeroResultSearches}
                empty="Aucune recherche sans résultat sur cette période."
                period={periodLabels[period]}
              />
            </div>
          ) : null}
        </Card>

        {analyticsError ? null : analyticsLoading ? (
          <div className="admin-analytics-grid">
            <Card title="Consultations"><Skeleton variant="rect" className="admin-analytics-skeleton" /></Card>
            <Card title="Consultations → panier → commandes payées"><Skeleton variant="rect" className="admin-analytics-skeleton" /></Card>
          </div>
        ) : analytics ? (
          <div className="admin-analytics-grid">
            <Card title="Consultations" description={periodLabels[period]}>
              <DataTable
                columns={productMetricColumns}
                rows={analytics.topProducts}
                rowKey={(row) => row.product_id}
                caption="Produits les plus consultés"
                emptyState={<EmptyState title="Aucune consultation enregistrée" description={periodLabels[period]} />}
              />
            </Card>
            <Card
              title="Consultations → panier → commandes payées"
              description={`Parcours agrégé · ${periodDescription}`}
            >
              <p>
                Volumes regroupés par produit : ils ne permettent pas une attribution individuelle fiable.
                Les ajouts au panier sont des événements déclarés par le navigateur, indicatifs et
                potentiellement manipulables ; ils ne correspondent pas à des commandes confirmées.
                Seules les commandes payées sont comptées comme telles.
              </p>
              <DataTable
                columns={funnelColumns}
                rows={analytics.productFunnel}
                rowKey={(row) => row.product_id}
                caption="Parcours agrégé des produits"
                emptyState={<EmptyState title="Aucun parcours disponible" description={periodLabels[period]} />}
              />
            </Card>
          </div>
        ) : null}

        {!analyticsError && !analyticsLoading && analytics && (
          <Card title="Produits très consultés et peu vendus" description={`À examiner · ${periodDescription}`}>
            <DataTable
              columns={underperformingColumns}
              rows={analytics.underperformingProducts}
              rowKey={(row) => row.product_id}
              caption="Produits très consultés et peu vendus"
              emptyState={<EmptyState title="Aucun produit ne correspond à ces critères" description={periodLabels[period]} />}
            />
          </Card>
        )}
        </div>
      </div>
    </main>
  )
}
