import type { User } from '@supabase/supabase-js'
import type { AdminServiceClient } from './admin-staff'

type AuditDetails = Record<string, unknown>

export async function writeAdminAuditLog(
  supabase: AdminServiceClient,
  entry: {
    actorUserId: string
    actorEmail: string | null
    action: string
    targetType: string
    targetId: string | null
    details?: AuditDetails
  },
) {
  try {
    const { error } = await supabase.from('admin_audit_log').insert({
      actor_user_id: entry.actorUserId,
      actor_email: entry.actorEmail,
      action: entry.action,
      target_type: entry.targetType,
      target_id: entry.targetId,
      details: entry.details ?? {},
    })
    if (error) {
      console.error('[Admin audit] Log write failed', error.message)
    }
  } catch {
    console.error('[Admin audit] Log write failed')
  }
}

export function actorEmailFromUser(user: User) {
  return user.email ?? null
}
