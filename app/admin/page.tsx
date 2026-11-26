'use client'

import {
  ArrowUpRight,
  ClipboardList,
  MessageSquareText,
  PackagePlus,
  ShoppingBasket,
  TrendingUp,
  Upload,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { canAccessAdminPath } from '../../lib/admin-staff-client'
import { getOrderStatusLabel } from '../../lib/order-tracking'
import { logClientError } from '../../lib/user-facing-errors'
import { supabase } from '../../lib/supabase'
import { useAdminDashboard } from './admin-dashboard-context'
import { useAdminSession } from './admin-session-provider'
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  MiniSalesChart,
  PageHeader,
  Skeleton,
  StatCard,
  type BadgeVariant,
  type DataTableColumn,
} from './_components'

type DashboardStats = {
  overview: {
    revenue: number
    orders_to_process: number
    unpaid_carts_over_one_hour: number
  }
  salesByDay: { date: string; revenue: number; orders: number }[]
}

type DashboardOrder = {
  id: string
  jalims_code: string
  origin: 'local' | 'import'
  status: string
  created_at: string
  total_price: number
}

const latestOrderColumns: DataTableColumn<DashboardOrder>[] = [
  {
    key: 'jalims_code',
    label: 'Commande',
    render: (order) => (
      <Link className="admin-ui-dashboard-order-link" href="/admin/commandes">
        {order.jalims_code || order.id}
        <ArrowUpRight size={14} aria-hidden="true" />
      </Link>
    ),
  },
  {
    key: 'created_at',
    label: 'Date',
    render: (order) => new Date(order.created_at).toLocaleString('fr-FR', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }),
  },
  {
    key: 'status',
    label: 'Statut',
    render: (order) => (
      <Badge variant={getStatusVariant(order.status)}>
        {getOrderStatusLabel(order.status, order.origin)}
      </Badge>
    ),
  },
  {
    key: 'total_price',
    label: 'Montant',
    render: (order) => `${Number(order.total_price).toLocaleString('fr-FR')} FCFA`,
  },
]

function getStatusVariant(status: string): BadgeVariant {
  if (status === 'pending_payment') return 'warning'
  if (status === 'cancelled') return 'danger'
  if (status === 'récupéré') return 'success'
  if (status === 'payé') return 'info'
  return 'neutral'
}

function formatMoney(value: number) {
  return `${Number(value || 0).toLocaleString('fr-FR')} FCFA`
}

function isDashboardStats(value: unknown): value is DashboardStats {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const result = value as Record<string, unknown>
  if (typeof result.overview !== 'object' || result.overview === null || Array.isArray(result.overview)) return false
  const overview = result.overview as Record<string, unknown>
  const hasOverviewMetrics = ['revenue', 'orders_to_process', 'unpaid_carts_over_one_hour']
    .every((key) => typeof overview[key] === 'number' && Number.isFinite(overview[key]))
  if (!hasOverviewMetrics || !Array.isArray(result.salesByDay)) return false
  return result.salesByDay.every((day) => {
    if (typeof day !== 'object' || day === null || Array.isArray(day)) return false
    const point = day as Record<string, unknown>
    return typeof point.date === 'string'
      && typeof point.revenue === 'number'
      && Number.isFinite(point.revenue)
      && typeof point.orders === 'number'
      && Number.isFinite(point.orders)
  })
}

function DashboardLoading() {
  return (
    <main className="admin-page" aria-busy="true">
      <PageHeader level={2} eyebrow="Pilotage" title="Tableau de bord" />
      <section className="admin-ui-dashboard-stats" aria-label="Chargement des indicateurs" aria-busy="true">
        {Array.from({ length: 4 }, (_, index) => (
          <StatCard
            key={index}
            label="Chargement"
            value={<Skeleton width="112px" height={28} />}
          />
        ))}
      </section>
      <Skeleton variant="rect" height={220} />
    </main>
  )
}

export default function AdminDashboardPage() {
  const router = useRouter()
  const { userId, role, loading: sessionLoading, error: sessionError } = useAdminSession()
  const { newRequestCount, newRequestError } = useAdminDashboard()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError] = useState('')
  const [orders, setOrders] = useState<DashboardOrder[]>([])
  const [ordersLoading, setOrdersLoading] = useState(true)
  const [ordersError, setOrdersError] = useState('')
  useEffect(() => {
    if (!sessionLoading && role === 'order_manager') router.replace('/admin/commandes')
  }, [role, router, sessionLoading])

  useEffect(() => {
    if (
      sessionLoading
      || sessionError
      || !userId
      || !canAccessAdminPath(role, '/admin')
    ) return

    let active = true

    async function loadStats() {
      const { data, error } = await supabase.auth.getSession()
      if (error || !data.session?.access_token) {
        if (error) logClientError('Admin dashboard session load failed', error)
        if (active) {
          setStatsError('La session administrateur n’a pas pu être vérifiée pour charger les statistiques.')
          setStatsLoading(false)
        }
        return
      }

      try {
        const response = await fetch('/api/admin/stats?period=7', {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
          cache: 'no-store',
        })
        const body: unknown = await response.json()
        if (!response.ok) {
          const message = typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
            ? body.error
            : 'Les statistiques du tableau de bord n’ont pas pu être chargées.'
          throw new Error(message)
        }
        if (!isDashboardStats(body)) throw new Error('La réponse des statistiques est invalide.')
        if (active) setStats(body)
      } catch (error) {
        logClientError('Admin dashboard statistics load failed', error)
        if (active) setStatsError(error instanceof Error ? error.message : 'Les statistiques du tableau de bord n’ont pas pu être chargées.')
      } finally {
        if (active) setStatsLoading(false)
      }
    }

    void loadStats()
    return () => {
      active = false
    }
  }, [role, sessionError, sessionLoading, userId])

  useEffect(() => {
    if (
      sessionLoading
      || sessionError
      || !userId
      || !canAccessAdminPath(role, '/admin')
    ) return

    let active = true

    async function loadLatestOrders() {
      try {
        const { data, error } = await supabase
          .from('orders')
          .select('id, jalims_code, origin, status, created_at, total_price')
          .order('created_at', { ascending: false })
          .limit(5)

        if (!active) return
        if (error) {
          logClientError('Admin dashboard latest orders load failed', error)
          const isRlsDenied = error.code === '42501' || /row-level security|permission denied/i.test(error.message)
          setOrdersError(isRlsDenied
            ? 'Les règles RLS n’autorisent pas la lecture des dernières commandes pour ce compte.'
            : 'Les dernières commandes n’ont pas pu être chargées.')
          return
        }
        setOrders((data ?? []) as DashboardOrder[])
      } catch (error) {
        logClientError('Admin dashboard latest orders request failed', error)
        if (active) setOrdersError('Les dernières commandes n’ont pas pu être chargées.')
      } finally {
        if (active) setOrdersLoading(false)
      }
    }

    void loadLatestOrders()
    return () => {
      active = false
    }
  }, [role, sessionError, sessionLoading, userId])

  if (sessionLoading) return <DashboardLoading />
  if (role === 'order_manager') {
    return <main className="admin-page"><div className="admin-state">Redirection vers les commandes…</div></main>
  }
  if (sessionError || !userId || !canAccessAdminPath(role, '/admin')) {
    return (
      <main className="admin-page">
        <EmptyState
          title={sessionError ? 'Accès indisponible' : 'Accès réservé'}
          description={sessionError ?? 'Connectez-vous avec un compte autorisé pour consulter le tableau de bord.'}
          action={!userId ? <Button onClick={() => router.push('/login?next=%2Fadmin')}>Se connecter</Button> : undefined}
        />
      </main>
    )
  }

  const revenue = stats?.overview.revenue
  const ordersToProcess = stats?.overview.orders_to_process
  const unpaidCarts = stats?.overview.unpaid_carts_over_one_hour

  return (
    <main className="admin-page">
      <PageHeader
        level={2}
        eyebrow="Pilotage"
        title="Vue d’ensemble"
        description="Votre activité récente et les actions à traiter."
        actions={(
          <div className="admin-ui-dashboard-actions">
            <Button variant="outline" leadingIcon={<Upload size={16} />} onClick={() => router.push('/admin/importer')}>
              Importer
            </Button>
            <Button leadingIcon={<PackagePlus size={16} />} onClick={() => router.push('/admin/produits')}>
              Ajouter un produit
            </Button>
          </div>
        )}
      />

      <section className="admin-ui-dashboard-stats" aria-label="Indicateurs clés">
        <StatCard
          label="Chiffre d’affaires"
          value={statsLoading ? <Skeleton width="112px" height={28} /> : statsError ? '—' : formatMoney(revenue ?? 0)}
          icon={<TrendingUp size={19} />}
          trend={{ label: 'Depuis le lancement', direction: 'neutral' }}
        />
        <StatCard
          label="Commandes à traiter"
          value={statsLoading ? <Skeleton width="64px" height={28} /> : statsError ? '—' : Number(ordersToProcess ?? 0).toLocaleString('fr-FR')}
          icon={<ClipboardList size={19} />}
          trend={{ label: 'Au statut « Payé »', direction: 'neutral' }}
        />
        <StatCard
          label="Paniers non payés"
          value={statsLoading ? <Skeleton width="64px" height={28} /> : statsError ? '—' : Number(unpaidCarts ?? 0).toLocaleString('fr-FR')}
          icon={<ShoppingBasket size={19} />}
          trend={{ label: 'En attente depuis plus d’une heure', direction: 'neutral' }}
        />
        <StatCard
          label="Nouvelles demandes"
          value={newRequestCount === null && !newRequestError
            ? <Skeleton width="64px" height={28} />
            : newRequestError
              ? '—'
              : Number(newRequestCount ?? 0).toLocaleString('fr-FR')}
          icon={<MessageSquareText size={19} />}
          trend={{ label: 'À examiner', direction: 'neutral' }}
        />
      </section>

      {(statsError || newRequestError) && (
        <Card title="Un indicateur est indisponible">
          <p className="admin-ui-dashboard-error" role="alert">
            {[statsError, newRequestError].filter(Boolean).join(' ')}
          </p>
        </Card>
      )}

      <div className="admin-ui-dashboard-grid">
        <Card title="Ventes des 7 derniers jours" description="Évolution quotidienne du chiffre d’affaires, en FCFA.">
          {statsLoading ? (
            <Skeleton variant="rect" width="100%" height={190} />
          ) : statsError ? (
            <p className="admin-ui-dashboard-error" role="alert">{statsError}</p>
          ) : stats && stats.salesByDay.length > 0 ? (
            <MiniSalesChart points={stats.salesByDay.slice(-7)} />
          ) : (
            <EmptyState title="Aucune vente sur cette période" description="Les ventes apparaîtront ici après les premiers paiements." />
          )}
        </Card>

        <Card
          title="Dernières commandes"
          description="Les cinq commandes les plus récentes."
          actions={(
            <Button size="sm" variant="ghost" trailingIcon={<ArrowUpRight size={15} />} onClick={() => router.push('/admin/commandes')}>
              Toutes les commandes
            </Button>
          )}
        >
          {ordersLoading ? (
            <DataTable
              columns={latestOrderColumns}
              rows={[]}
              rowKey={(order) => order.id}
              caption="Chargement des dernières commandes"
              loading
              loadingRows={5}
            />
          ) : ordersError ? (
            <p className="admin-ui-dashboard-error" role="alert">{ordersError}</p>
          ) : orders.length === 0 ? (
            <EmptyState title="Aucune commande récente" description="Les nouvelles commandes apparaîtront dans cette liste." />
          ) : (
            <DataTable
              columns={latestOrderColumns}
              rows={orders}
              rowKey={(order) => order.id}
              caption="Cinq dernières commandes"
            />
          )}
        </Card>
      </div>
    </main>
  )
}
