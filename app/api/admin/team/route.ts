import { NextResponse } from 'next/server'
import { actorEmailFromUser, writeAdminAuditLog } from '../../../../lib/admin-audit'
import { ADMIN_AND_OWNER_ROLES, requireRole, type AdminServiceClient, type StaffRole } from '../../../../lib/admin-staff'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type TeamMember = {
  user_id: string
  email: string
  role: StaffRole
  active: boolean
  created_at: string
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

function forbidden(message: string) {
  return NextResponse.json({ error: message }, { status: 403 })
}

async function findUserByEmail(supabase: AdminServiceClient, email: string) {
  const normalizedEmail = email.trim().toLowerCase()
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error('user_lookup_failed')
    const found = data.users.find((user) => (user.email ?? '').toLowerCase() === normalizedEmail)
    if (found) return found
    if (data.users.length < 200) return null
  }
}

async function listMembers(supabase: AdminServiceClient): Promise<TeamMember[]> {
  const { data: rows, error } = await supabase
    .from('staff_roles')
    .select('user_id, role, active, created_at')
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[Admin team] Staff list load failed', error.message)
    throw new Error('staff_list_failed')
  }

  const members = await Promise.all((rows ?? []).map(async (row) => {
    const { data, error: userError } = await supabase.auth.admin.getUserById(row.user_id)
    if (userError) {
      console.error('[Admin team] Member user lookup failed', userError.message)
    }
    return {
      user_id: row.user_id as string,
      email: data.user?.email ?? '',
      role: row.role as StaffRole,
      active: Boolean(row.active),
      created_at: row.created_at as string,
    }
  }))

  return members
}

export async function GET(request: Request) {
  const authorization = await requireRole(request, ADMIN_AND_OWNER_ROLES, 'Admin team')
  if ('response' in authorization) return authorization.response

  try {
    const members = await listMembers(authorization.supabase)
    return NextResponse.json({ members, actorRole: authorization.role, actorUserId: authorization.user.id }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch {
    return NextResponse.json({ error: 'Impossible de charger les membres de l’équipe.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const authorization = await requireRole(request, ADMIN_AND_OWNER_ROLES, 'Admin team')
  if ('response' in authorization) return authorization.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return badRequest('La demande reçue est invalide.')
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return badRequest('La demande reçue est invalide.')
  }

  const email = typeof (body as { email?: unknown }).email === 'string' ? (body as { email: string }).email.trim().toLowerCase() : ''
  const role = (body as { role?: unknown }).role
  if (!EMAIL_PATTERN.test(email)) {
    return badRequest('Saisissez une adresse e-mail valide.')
  }
  if (role !== 'owner' && role !== 'admin' && role !== 'order_manager') {
    return badRequest('Le rôle sélectionné est invalide.')
  }

  if (authorization.role === 'admin' && role !== 'order_manager') {
    return forbidden('Un administrateur peut uniquement ajouter des gestionnaires de commandes.')
  }

  const supabase = authorization.supabase

  try {
    let user = await findUserByEmail(supabase, email)
    let invited = false

    if (!user) {
      const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '')
      const redirectTo = siteUrl ? `${siteUrl}/reset-password` : undefined
      const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, redirectTo ? { redirectTo } : undefined)
      if (error) {
        console.error('[Admin team] Invitation failed', error.message)
        return NextResponse.json({ error: 'L’invitation n’a pas pu être envoyée. Vérifiez l’adresse e-mail puis réessayez.' }, { status: 500 })
      }
      user = data.user
      invited = true
    }

    if (!user) {
      return NextResponse.json({ error: 'Le compte n’a pas pu être créé ou retrouvé.' }, { status: 500 })
    }

    if (user.id === authorization.user.id) {
      return forbidden('Vous ne pouvez pas modifier votre propre rôle.')
    }

    const { data: existing, error: existingError } = await supabase
      .from('staff_roles')
      .select('user_id, role, active')
      .eq('user_id', user.id)
      .maybeSingle()

    if (existingError) {
      console.error('[Admin team] Existing staff role lookup failed', existingError.message)
      return NextResponse.json({ error: 'Impossible de vérifier le rôle existant de ce compte.' }, { status: 500 })
    }

    if (existing && authorization.role === 'admin' && existing.role !== 'order_manager') {
      return forbidden('Un administrateur ne peut gérer que les gestionnaires de commandes.')
    }

    if (existing) {
      const { error: updateError } = await supabase
        .from('staff_roles')
        .update({ role, active: true })
        .eq('user_id', user.id)
      if (updateError) {
        console.error('[Admin team] Staff role update failed', updateError.message)
        return NextResponse.json({ error: 'Le rôle n’a pas pu être attribué à ce compte.' }, { status: 500 })
      }
      await writeAdminAuditLog(supabase, {
        actorUserId: authorization.user.id,
        actorEmail: actorEmailFromUser(authorization.user),
        action: !existing.active || existing.role !== role ? 'team_member_added' : 'team_member_added',
        targetType: 'staff_role',
        targetId: user.id,
        details: {
          role,
          previousRole: existing.role,
          previouslyActive: Boolean(existing.active),
          invited,
        },
      })
    } else {
      const { error: insertError } = await supabase
        .from('staff_roles')
        .insert({ user_id: user.id, role, active: true, created_by: authorization.user.id })
      if (insertError) {
        console.error('[Admin team] Staff role insert failed', insertError.message)
        return NextResponse.json({ error: 'Le rôle n’a pas pu être attribué à ce compte.' }, { status: 500 })
      }
      await writeAdminAuditLog(supabase, {
        actorUserId: authorization.user.id,
        actorEmail: actorEmailFromUser(authorization.user),
        action: 'team_member_added',
        targetType: 'staff_role',
        targetId: user.id,
        details: { role, invited },
      })
    }

    return NextResponse.json({
      success: true,
      invited,
      message: invited
        ? 'Invitation envoyée. La personne pourra définir son mot de passe depuis le lien reçu par e-mail.'
        : 'Le rôle a été attribué à ce compte existant.',
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'user_lookup_failed') {
      console.error('[Admin team] User lookup failed')
      return NextResponse.json({ error: 'Impossible de vérifier si ce compte existe déjà.' }, { status: 500 })
    }
    console.error('[Admin team] Member add failed')
    return NextResponse.json({ error: 'Le membre n’a pas pu être ajouté.' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const authorization = await requireRole(request, ADMIN_AND_OWNER_ROLES, 'Admin team')
  if ('response' in authorization) return authorization.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return badRequest('La demande reçue est invalide.')
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return badRequest('La demande reçue est invalide.')
  }

  const userId = typeof (body as { userId?: unknown }).userId === 'string' ? (body as { userId: string }).userId : ''
  const nextRole = (body as { role?: unknown }).role
  const nextActive = (body as { active?: unknown }).active

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    return badRequest('Le membre demandé est invalide.')
  }
  if (nextRole !== undefined && nextRole !== 'owner' && nextRole !== 'admin' && nextRole !== 'order_manager') {
    return badRequest('Le rôle sélectionné est invalide.')
  }
  if (nextActive !== undefined && typeof nextActive !== 'boolean') {
    return badRequest('L’état demandé est invalide.')
  }
  if (nextRole === undefined && nextActive === undefined) {
    return badRequest('Aucune modification demandée.')
  }

  const supabase = authorization.supabase

  try {
    const { data: target, error: targetError } = await supabase
      .from('staff_roles')
      .select('user_id, role, active')
      .eq('user_id', userId)
      .maybeSingle()

    if (targetError) {
      console.error('[Admin team] Target staff role lookup failed', targetError.message)
      return NextResponse.json({ error: 'Impossible de charger le membre demandé.' }, { status: 500 })
    }
    if (!target) {
      return NextResponse.json({ error: 'Membre introuvable.' }, { status: 404 })
    }

    const targetRole = target.role as StaffRole
    const targetActive = Boolean(target.active)

    if (nextRole !== undefined && userId === authorization.user.id) {
      return forbidden('Vous ne pouvez pas modifier votre propre rôle.')
    }
    if (nextActive === false && userId === authorization.user.id) {
      return forbidden('Vous ne pouvez pas désactiver votre propre compte.')
    }

    if (authorization.role === 'admin') {
      if (nextRole !== undefined) {
        return forbidden('Un administrateur ne peut pas modifier les rôles.')
      }
      if (nextActive !== false || targetRole !== 'order_manager') {
        return forbidden('Un administrateur peut uniquement désactiver des gestionnaires de commandes.')
      }
    }

    if (nextRole === undefined && nextActive !== undefined && nextActive === targetActive) {
      return NextResponse.json({ success: true, message: 'Aucune modification nécessaire.' })
    }
    if (nextRole !== undefined && nextActive === undefined && nextRole === targetRole) {
      return NextResponse.json({ success: true, message: 'Aucune modification nécessaire.' })
    }

    const updates: { role?: StaffRole; active?: boolean } = {}
    if (nextRole !== undefined) updates.role = nextRole
    if (nextActive !== undefined) updates.active = nextActive

    const { error: updateError } = await supabase
      .from('staff_roles')
      .update(updates)
      .eq('user_id', userId)

    if (updateError) {
      console.error('[Admin team] Staff role update failed', updateError.message)
      const message = /dernier propriétaire actif|last active owner|at_least_one_active_owner_required/i.test(updateError.message)
        ? 'Impossible de retirer ou de rétrograder le dernier propriétaire actif.'
        : 'La modification du membre a échoué.'
      const status = /dernier propriétaire actif|last active owner|at_least_one_active_owner_required/i.test(updateError.message) ? 409 : 500
      return NextResponse.json({ error: message }, { status })
    }

    if (updates.active === false) {
      await writeAdminAuditLog(supabase, {
        actorUserId: authorization.user.id,
        actorEmail: actorEmailFromUser(authorization.user),
        action: 'team_member_deactivated',
        targetType: 'staff_role',
        targetId: userId,
        details: { role: targetRole },
      })
    } else if (updates.role && updates.role !== targetRole) {
      await writeAdminAuditLog(supabase, {
        actorUserId: authorization.user.id,
        actorEmail: actorEmailFromUser(authorization.user),
        action: 'team_member_role_changed',
        targetType: 'staff_role',
        targetId: userId,
        details: { previousRole: targetRole, newRole: updates.role },
      })
    } else if (updates.active === true && !targetActive) {
      await writeAdminAuditLog(supabase, {
        actorUserId: authorization.user.id,
        actorEmail: actorEmailFromUser(authorization.user),
        action: 'team_member_activated',
        targetType: 'staff_role',
        targetId: userId,
        details: { role: updates.role ?? targetRole },
      })
    }

    return NextResponse.json({ success: true, message: 'Membre mis à jour.' })
  } catch {
    console.error('[Admin team] Member update failed')
    return NextResponse.json({ error: 'La modification du membre a échoué.' }, { status: 500 })
  }
}
