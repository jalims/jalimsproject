import { createClient, type User } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { hasJalimsAdminAccess } from '../../../../lib/admin-access'
import { normalizeSenegalPhone } from '../../../../lib/order-messages'
import { createSupabaseAdminClient } from '../../../../lib/paytech-admin'

const paidStatuses = new Set([
  'payé',
  'commandé_fournisseur',
  'chez_transitaire',
  'en_transit',
  'arrivé',
  'prête_a_retirer',
  'récupéré',
])
const pageSize = 20
const authPageSize = 500

type ClientRow = {
  id: string
  name: string
  phone: string
  email: string
  created_at: string
  email_confirmed: boolean
  order_count: number
  total_spent: number
}

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
    console.error('[Admin clients] Supabase public environment is not configured')
    return { response: jsonError('Le service clients n’est pas configuré correctement.', 500) }
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await authClient.auth.getUser(accessToken)
  if (error) {
    console.error('[Admin clients] Admin authentication failed')
    return { response: jsonError('Votre session n’a pas pu être vérifiée. Reconnectez-vous puis réessayez.', 401) }
  }
  if (!hasJalimsAdminAccess(data.user)) {
    return { response: jsonError('Ce compte ne dispose pas des droits administrateur.', 403) }
  }

  return { user: data.user }
}

function metadataText(user: User, key: string) {
  const value = user.user_metadata?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

function matchesSearch(client: ClientRow, query: string) {
  if (!query) return true
  return `${client.name} ${client.phone} ${normalizeSenegalPhone(client.phone) ?? ''} ${client.email}`
    .toLocaleLowerCase()
    .includes(query)
}

async function loadClients(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  search: string,
  withoutOrder: boolean,
  requestedPage: number,
  exportAll: boolean,
) {
  const matched: ClientRow[] = []
  const needed = requestedPage * pageSize + 1

  for (let authPage = 1; ; authPage += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page: authPage,
      perPage: authPageSize,
    })
    if (error) throw new Error('La liste des comptes est indisponible.')

    const users = data.users
    if (users.length === 0) break
    const userIds = users.map((user) => user.id)
    const [{ data: profiles, error: profilesError }, orders] = await Promise.all([
      supabase.from('profiles').select('id, full_name, phone').in('id', userIds),
      (async () => {
        const rows: { user_id: string; total_price: number; status: string }[] = []
        for (let offset = 0; ; offset += 1000) {
          const { data: batch, error: ordersError } = await supabase
            .from('orders')
            .select('user_id, total_price, status')
            .in('user_id', userIds)
            .order('id', { ascending: true })
            .range(offset, offset + 999)
          if (ordersError) throw new Error('Les commandes des comptes sont indisponibles.')
          rows.push(...(batch ?? []))
          if ((batch ?? []).length < 1000) break
        }
        return rows
      })(),
    ])
    if (profilesError) throw new Error('Les profils clients sont indisponibles.')

    const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]))
    const orderTotals = new Map<string, { count: number; spent: number }>()
    for (const order of orders) {
      const current = orderTotals.get(order.user_id) ?? { count: 0, spent: 0 }
      current.count += 1
      if (paidStatuses.has(order.status)) current.spent += Number(order.total_price) || 0
      orderTotals.set(order.user_id, current)
    }

    for (const user of users) {
      const profile = profileById.get(user.id)
      const phone = profile?.phone || metadataText(user, 'phone')
      const name = profile?.full_name?.trim() || metadataText(user, 'full_name') || 'Client sans nom'
      const totals = orderTotals.get(user.id) ?? { count: 0, spent: 0 }
      const client: ClientRow = {
        id: user.id,
        name,
        phone,
        email: user.email ?? '',
        created_at: user.created_at,
        email_confirmed: Boolean(user.email_confirmed_at),
        order_count: totals.count,
        total_spent: totals.spent,
      }

      if ((!withoutOrder || client.order_count === 0) && matchesSearch(client, search)) {
        matched.push(client)
      }
    }

    if (!exportAll && matched.length >= needed) break
    if (users.length < authPageSize) break
  }

  return matched
}

function csvCell(value: string | number) {
  const text = String(value).replace(/^[\t\r\n ]*(?=[=+\-@])/, "'")
  return `"${text.replaceAll('"', '""')}"`
}

function clientsCsv(clients: ClientRow[]) {
  const rows = [
    ['Nom', 'Téléphone', 'E-mail', 'Date d’inscription', 'E-mail confirmé', 'Nombre de commandes', 'Total dépensé (FCFA)'],
    ...clients.map((client) => [
      client.name,
      client.phone,
      client.email,
      client.created_at,
      client.email_confirmed ? 'Oui' : 'Non',
      client.order_count,
      client.total_spent,
    ]),
  ]
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}`
}

export async function GET(request: Request) {
  const authorization = await authorizeAdmin(request)
  if ('response' in authorization) return authorization.response

  const params = new URL(request.url).searchParams
  const pageValue = Number(params.get('page') ?? '1')
  if (!Number.isInteger(pageValue) || pageValue < 1 || pageValue > 10000) {
    return jsonError('Le numéro de page est invalide.', 400)
  }
  const search = (params.get('search') ?? '').trim().toLocaleLowerCase()
  const withoutOrder = params.get('withoutOrder') === 'true'
  const exportAll = params.get('export') === 'csv'

  try {
    const supabase = createSupabaseAdminClient()
    const clients = await loadClients(supabase, search, withoutOrder, pageValue, exportAll)
    if (exportAll) {
      const filename = `jalims-clients-${new Date().toISOString().slice(0, 10)}.csv`
      return new Response(clientsCsv(clients), {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Type': 'text/csv; charset=utf-8',
        },
      })
    }

    const start = (pageValue - 1) * pageSize
    const pageClients = clients.slice(start, start + pageSize)
    return NextResponse.json({
      clients: pageClients,
      page: pageValue,
      hasMore: clients.length > start + pageSize,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    console.error('[Admin clients] Client list load failed')
    return jsonError('Impossible de charger les comptes clients pour le moment.', 500)
  }
}
