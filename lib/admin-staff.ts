import { createClient, type User } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { hasJalimsAdminAccess } from './admin-access'
import { createSupabaseAdminClient } from './supabase-admin'

export type StaffRole = 'owner' | 'admin' | 'order_manager'

export const ALL_STAFF_ROLES: StaffRole[] = ['owner', 'admin', 'order_manager']

export const ADMIN_AND_OWNER_ROLES: StaffRole[] = ['owner', 'admin']

export const ORDER_TEAM_ROLES: StaffRole[] = ['owner', 'admin', 'order_manager']

export type AdminServiceClient = ReturnType<typeof createSupabaseAdminClient>

type StaffRoleRow = {
  role: StaffRole
}

export type RequireRoleFailure = {
  response: NextResponse
}

export type RequireRoleSuccess = {
  user: User
  role: StaffRole
  supabase: AdminServiceClient
}

export type RequireRoleResult = RequireRoleFailure | RequireRoleSuccess

export function hasRole(role: StaffRole | null | undefined, allowedRoles: readonly StaffRole[]) {
  return role != null && allowedRoles.includes(role)
}

export async function resolveStaffRole(
  userId: string,
  supabase: AdminServiceClient,
): Promise<StaffRole | null> {
  const { data, error } = await supabase
    .from('staff_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('active', true)
    .maybeSingle<StaffRoleRow>()

  if (error) {
    console.error('[Admin staff] Unable to resolve staff role', error.message)
    throw new Error('staff_role_lookup_failed')
  }

  if (!data) return null
  if (data.role === 'owner' || data.role === 'admin' || data.role === 'order_manager') {
    return data.role
  }
  return null
}

function getAccessToken(request: Request) {
  return request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null
}

function unauthorized(message: string) {
  return NextResponse.json({ error: message }, { status: 401 })
}

function forbidden(message: string) {
  return NextResponse.json({ error: message }, { status: 403 })
}

function misconfigured() {
  return NextResponse.json({ error: 'Le service demandé n’est pas configuré correctement.' }, { status: 500 })
}

export async function requireRole(
  request: Request,
  allowedRoles: readonly StaffRole[],
  serviceName: string,
): Promise<RequireRoleResult> {
  const accessToken = getAccessToken(request)
  if (!accessToken) {
    return { response: unauthorized('Connectez-vous avec un compte autorisé pour continuer.') }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) {
    console.error(`[${serviceName}] Supabase public environment is not configured`)
    return { response: misconfigured() }
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await authClient.auth.getUser(accessToken)
  if (error || !data.user) {
    console.error(`[${serviceName}] Authentication failed`, error?.message ?? 'missing user')
    return { response: unauthorized('Votre session n’a pas pu être vérifiée. Reconnectez-vous puis réessayez.') }
  }

  let supabase: AdminServiceClient
  try {
    supabase = createSupabaseAdminClient()
  } catch {
    console.error(`[${serviceName}] Supabase admin environment is not configured`)
    return { response: misconfigured() }
  }

  let role: StaffRole | null = null
  try {
    role = await resolveStaffRole(data.user.id, supabase)
  } catch {
    return { response: NextResponse.json({ error: 'Impossible de vérifier vos droits d’accès.' }, { status: 500 }) }
  }

  // TODO: Retirer ce secours temporaire après validation en production.
  // Compatibilité transitoire : ancien accès admin désigné (e-mail + app_metadata.role)
  // conservé tant que la bascule staff_roles n’est pas entièrement validée.
  if (!role && hasJalimsAdminAccess(data.user)) {
    role = 'owner'
  }

  if (!role) {
    return { response: forbidden('Ce compte ne dispose pas des droits nécessaires pour accéder à cette section.') }
  }

  if (!hasRole(role, allowedRoles)) {
    return { response: forbidden('Ce compte ne dispose pas des droits nécessaires pour cette action.') }
  }

  return { user: data.user, role, supabase }
}
