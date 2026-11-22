import type { User } from '@supabase/supabase-js'
import { hasJalimsAdminAccess } from './admin-access'
import { supabase } from './supabase'

export type StaffRole = 'owner' | 'admin' | 'order_manager'

export const ORDER_TEAM_ROLES: StaffRole[] = ['owner', 'admin', 'order_manager']
export const ADMIN_AND_OWNER_ROLES: StaffRole[] = ['owner', 'admin']

export async function getStaffRoleForUser(user: User): Promise<StaffRole | null> {
  const { data, error } = await supabase
    .from('staff_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('active', true)
    .maybeSingle<{ role: StaffRole }>()

  if (!error && data && (data.role === 'owner' || data.role === 'admin' || data.role === 'order_manager')) {
    return data.role
  }

  // TODO: Retirer ce secours temporaire après validation en production (aligné avec le helper serveur).
  if (hasJalimsAdminAccess(user)) return 'owner'

  return null
}

export function canAccessAdminPath(role: StaffRole | null, pathname: string) {
  if (!role) return false
  if (role === 'order_manager') {
    return pathname === '/admin/commandes'
  }
  return true
}
