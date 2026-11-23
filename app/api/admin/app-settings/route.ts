import { NextResponse } from 'next/server'
import { ADMIN_AND_OWNER_ROLES, requireRole } from '../../../../lib/admin-staff'

// PUT/GET utilisent authorization.supabase, fourni par requireRole comme client admin/service-role
// (createSupabaseAdminClient) après contrôle d’accès owner/admin, pour contourner l’absence d’écritures RLS client.

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function toNumber(value: unknown) {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '') return Number(value)
  return Number.NaN
}

function parseSettingsBody(body: unknown) {
  if (typeof body !== 'object' || body === null) return null
  const row = body as Record<string, unknown>
  const transport = toNumber(row.transport_price_per_kg_fcfa)
  const commission = toNumber(row.commission_percent)
  const customs = toNumber(row.customs_percent)
  const rawRate = row.cny_to_fcfa_rate
  const rate = rawRate === null || rawRate === undefined || (typeof rawRate === 'string' && rawRate.trim() === '')
    ? null
    : toNumber(rawRate)
  if (!Number.isFinite(transport) || transport < 0) return null
  if (!Number.isFinite(commission) || commission < 0) return null
  if (!Number.isFinite(customs) || customs < 0) return null
  if (rate !== null && (!Number.isFinite(rate) || rate <= 0)) return null
  return {
    transport_price_per_kg_fcfa: Math.round(transport * 100) / 100,
    commission_percent: Math.round(commission * 10000) / 10000,
    customs_percent: Math.round(customs * 10000) / 10000,
    cny_to_fcfa_rate: rate === null ? null : Math.round(rate * 1000000) / 1000000,
  }
}

export async function GET(request: Request) {
  const authorization = await requireRole(request, ADMIN_AND_OWNER_ROLES, 'App settings')
  if ('response' in authorization) return authorization.response

  const { data, error } = await authorization.supabase
    .from('app_settings')
    .select('transport_price_per_kg_fcfa, commission_percent, customs_percent, cny_to_fcfa_rate, updated_at')
    .eq('id', 1)
    .maybeSingle()

  if (error) return jsonError('Impossible de charger les paramètres.', 400)
  return NextResponse.json({
    settings: data ?? { transport_price_per_kg_fcfa: 0, commission_percent: 0, customs_percent: 0, cny_to_fcfa_rate: null, updated_at: null },
  })
}

export async function PUT(request: Request) {
  const authorization = await requireRole(request, ADMIN_AND_OWNER_ROLES, 'App settings')
  if ('response' in authorization) return authorization.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError('Requête invalide.', 400)
  }

  const settings = parseSettingsBody(body)
  if (!settings) {
    return jsonError('Paramètres invalides. Vérifiez le prix transport/kg, la commission (%), le dédouanement (%) et le taux de change.', 400)
  }

  const { data, error } = await authorization.supabase
    .from('app_settings')
    .upsert({
      id: 1,
      ...settings,
      updated_at: new Date().toISOString(),
      updated_by: authorization.user.id,
    }, { onConflict: 'id' })
    .select('transport_price_per_kg_fcfa, commission_percent, customs_percent, cny_to_fcfa_rate, updated_at')
    .single()

  if (error) return jsonError('Les paramètres n’ont pas pu être enregistrés.', 400)
  return NextResponse.json({ settings: data })
}
