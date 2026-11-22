import { NextResponse } from 'next/server'
import { ADMIN_AND_OWNER_ROLES, requireRole } from '../../../../lib/admin-staff'

const periods = new Set(['7', '30', '90', 'all'])

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function GET(request: Request) {
  const authorization = await requireRole(request, ADMIN_AND_OWNER_ROLES, 'Admin stats')
  if ('response' in authorization) return authorization.response

  const period = new URL(request.url).searchParams.get('period') ?? '30'
  if (!periods.has(period)) {
    return jsonError('Choisissez une période valide : 7, 30, 90 jours ou tout.', 400)
  }

  try {
    const supabase = authorization.supabase
    const [
      { data: overview, error: overviewError },
      { data: salesByDay, error: salesError },
      { data: topProducts, error: productsError },
      { data: categories, error: categoriesError },
      { data: statuses, error: statusesError },
      { data: pickupDelay, error: pickupDelayError },
    ] = await Promise.all([
      supabase.rpc('admin_stats_overview', { p_period: period }),
      supabase.rpc('admin_stats_sales_by_day', { p_period: period }),
      supabase.rpc('admin_stats_top_products', { p_period: period }),
      supabase.rpc('admin_stats_categories', { p_period: period }),
      supabase.rpc('admin_stats_statuses', { p_period: period }),
      supabase.rpc('admin_stats_pickup_delay', { p_period: period }),
    ])

    if (overviewError || salesError || productsError || categoriesError || statusesError || pickupDelayError) {
      console.error('[Admin stats] One or more statistics queries failed')
      return jsonError('Impossible de charger les statistiques pour le moment.', 500)
    }

    return NextResponse.json({
      overview,
      salesByDay,
      topProducts,
      categories,
      statuses,
      pickupDelay,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    console.error('[Admin stats] Statistics load failed')
    return jsonError('Impossible de charger les statistiques pour le moment.', 500)
  }
}
