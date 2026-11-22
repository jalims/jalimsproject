import { NextResponse } from 'next/server'
import { ADMIN_AND_OWNER_ROLES, requireRole } from '../../../../lib/admin-staff'

const periods = new Set(['7', '30', '90', 'all'])

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function GET(request: Request) {
  const authorization = await requireRole(request, ADMIN_AND_OWNER_ROLES, 'Admin analytics')
  if ('response' in authorization) return authorization.response

  const period = new URL(request.url).searchParams.get('period') ?? '30'
  if (!periods.has(period)) {
    return jsonError('Choisissez une période valide : 7, 30, 90 jours ou tout.', 400)
  }

  try {
    const supabase = authorization.supabase
    const [
      { data: topSearches, error: topSearchesError },
      { data: zeroResultSearches, error: zeroResultError },
      { data: topProducts, error: topProductsError },
      { data: productFunnel, error: funnelError },
      { data: underperformingProducts, error: underperformingError },
    ] = await Promise.all([
      supabase.rpc('admin_analytics_top_searches', { p_period: period }),
      supabase.rpc('admin_analytics_zero_result_searches', { p_period: period }),
      supabase.rpc('admin_analytics_top_products', { p_period: period }),
      supabase.rpc('admin_analytics_product_funnel', { p_period: period }),
      supabase.rpc('admin_analytics_underperforming_products', { p_period: period }),
    ])

    if (topSearchesError || zeroResultError || topProductsError || funnelError || underperformingError) {
      console.error('[Admin analytics] One or more analytics queries failed')
      return jsonError('Impossible de charger les statistiques de fréquentation.', 503)
    }

    return NextResponse.json({
      topSearches,
      zeroResultSearches,
      topProducts,
      productFunnel,
      underperformingProducts,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    console.error('[Admin analytics] Analytics load failed')
    return jsonError('Impossible de charger les statistiques de fréquentation.', 503)
  }
}
