import { createSupabaseAdminClient } from './paytech-admin'

type AdminSupabaseClient = ReturnType<typeof createSupabaseAdminClient>

export type AdminOrderDeliveryDetail = {
  order_id: string
  delivery_region: string | null
  delivery_neighborhood: string | null
  customer_name: string
  customer_phone: string
}

export async function loadAdminOrderDeliveryDetails(supabase: AdminSupabaseClient, orderIds: string[]) {
  if (orderIds.length === 0) {
    return { details: [] as AdminOrderDeliveryDetail[], error: null }
  }

  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('id, user_id, delivery_region, delivery_neighborhood')
    .in('id', orderIds)
    .eq('origin', 'local')

  if (ordersError) {
    return { details: [] as AdminOrderDeliveryDetail[], error: ordersError }
  }

  const userIds = [...new Set((orders ?? []).map((order) => order.user_id))]
  const { data: profiles, error: profilesError } = userIds.length
    ? await supabase.from('profiles').select('id, full_name, phone').in('id', userIds)
    : { data: [], error: null }

  if (profilesError) {
    return { details: [] as AdminOrderDeliveryDetail[], error: profilesError }
  }

  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]))
  const details = (orders ?? []).map((order) => {
    const profile = profileById.get(order.user_id)
    return {
      order_id: order.id,
      delivery_region: order.delivery_region,
      delivery_neighborhood: order.delivery_neighborhood,
      customer_name: profile?.full_name?.trim() || '',
      customer_phone: profile?.phone?.trim() || '',
    }
  })

  return { details, error: null }
}
