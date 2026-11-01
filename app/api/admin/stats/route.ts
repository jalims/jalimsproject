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
    console.error('[Admin stats] Supabase public environment is not configured')
    return { response: jsonError('Le service de statistiques n’est pas configuré correctement.', 500) }
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await authClient.auth.getUser(accessToken)
  if (error) {
    console.error('[Admin stats] Admin authentication failed')
    return { response: jsonError('Votre session n’a pas pu être vérifiée. Reconnectez-vous puis réessayez.', 401) }
  }
  if (!hasJalimsAdminAccess(data.user)) {
    return { response: jsonError('Ce compte ne dispose pas des droits administrateur.', 403) }
  }

  return { user: data.user }
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
