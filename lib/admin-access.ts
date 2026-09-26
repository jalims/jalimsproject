import type { User } from '@supabase/supabase-js'

export const JALIMS_ADMIN_EMAIL = 'jalimsofficiel@gmail.com'

export function hasJalimsAdminAccess(user: User | null | undefined) {
  return user?.app_metadata?.role === 'admin'
    && user.email?.trim().toLowerCase() === JALIMS_ADMIN_EMAIL
}
