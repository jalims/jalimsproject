import { NextResponse } from 'next/server'
import { ADMIN_AND_OWNER_ROLES, requireRole } from '../../../../lib/admin-staff'

const periods = new Set(['7', '30', '90', 'all'])

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function GET(request: Request) {
  const authorization = await requireRole(request, ADMIN_AND_OWNER_ROLES, 'Admin stats')
  if ('response' in authorization) return authorization.response

  const searchParams = new URL(request.url).searchParams
  const period = searchParams.get('period') ?? '30'
  const operationalPeriod = searchParams.get('operationalPeriod')
  if (!periods.has(period)) {
    return jsonError('Choisissez une période valide : 7, 30, 90 jours ou tout.', 400)
  }
  if (operationalPeriod !== null && operationalPeriod !== 'all') {
    return jsonError('La période des compteurs opérationnels doit être « all ».', 400)
  }

  try {
    const supabase = authorization.supabase
    const operationalCountsRequest = operationalPeriod === 'all'
      ? (() => {
        const unpaidCartCutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString()
        return Promise.all([
          supabase
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'payé'),
          supabase
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'pending_payment')
            .lt('created_at', unpaidCartCutoff),
        ])
      })()
      : Promise.resolve(null)
    const [
      { data: overview, error: overviewError },
      { data: salesByDay, error: salesError },
      { data: topProducts, error: productsError },
      { data: categories, error: categoriesError },
      { data: statuses, error: statusesError },
      { data: pickupDelay, error: pickupDelayError },
      operationalCounts,
    ] = await Promise.all([
      supabase.rpc('admin_stats_overview', { p_period: period }),
      supabase.rpc('admin_stats_sales_by_day', { p_period: period }),
      supabase.rpc('admin_stats_top_products', { p_period: period }),
      supabase.rpc('admin_stats_categories', { p_period: period }),
      supabase.rpc('admin_stats_statuses', { p_period: period }),
      supabase.rpc('admin_stats_pickup_delay', { p_period: period }),
      operationalCountsRequest,
    ])

    if (overviewError || salesError || productsError || categoriesError || statusesError || pickupDelayError) {
      console.error('[Admin stats] One or more statistics queries failed')
      return jsonError('Impossible de charger les statistiques pour le moment.', 500)
    }

    const responseBody = {
      overview,
      salesByDay,
      topProducts,
      categories,
      statuses,
      pickupDelay,
    }

    if (operationalCounts === null) {
      return NextResponse.json(responseBody, { headers: { 'Cache-Control': 'no-store' } })
    }

    const [ordersToProcessResult, unpaidCartsResult] = operationalCounts
    if (
      ordersToProcessResult.error
      || ordersToProcessResult.count === null
      || unpaidCartsResult.error
      || unpaidCartsResult.count === null
    ) {
      console.error('[Admin stats] Operational counts query failed')
      return jsonError('Impossible de charger les compteurs opérationnels pour le moment.', 500)
    }

    return NextResponse.json({
      ...responseBody,
      operationalCounts: {
        orders_to_process: ordersToProcessResult.count,
        unpaid_carts_over_one_hour: unpaidCartsResult.count,
      },
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    console.error('[Admin stats] Statistics load failed')
    return jsonError('Impossible de charger les statistiques pour le moment.', 500)
  }
}
