import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { hasJalimsAdminAccess } from '../../../../lib/admin-access'
import { createSupabaseAdminClient } from '../../../../lib/paytech-admin'

const periods = new Set(['7', '30', '90', 'all'])

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

async function authorizeAdmin(request: Request) {
  const accessToken = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!accessToken) {
    return { response: jsonError('Connectez-vous avec le compte administrateur pour continuer.', 401) }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) {
    console.error('[Admin analytics] Supabase public environment is not configured')
    return { response: jsonError('Les statistiques de fréquentation ne sont pas configurées.', 500) }
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await authClient.auth.getUser(accessToken)
  if (error) {
    console.error('[Admin analytics] Admin authentication failed')
    return { response: jsonError('Votre session n’a pas pu être vérifiée. Reconnectez-vous puis réessayez.', 401) }
  }
  if (!hasJalimsAdminAccess(data.user)) {
    return { response: jsonError('Ce compte ne dispose pas des droits administrateur.', 403) }
  }

  return { authorized: true }
}

export async function GET(request: Request) {
  const authorization = await authorizeAdmin(request)
  if ('response' in authorization) return authorization.response

  const period = new URL(request.url).searchParams.get('period') ?? '30'
  if (!periods.has(period)) {
    return jsonError('Choisissez une période valide : 7, 30, 90 jours ou tout.', 400)
  }

  try {
    const supabase = createSupabaseAdminClient()
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
