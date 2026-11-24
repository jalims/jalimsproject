import type { SupabaseClient } from '@supabase/supabase-js'

export type AdminServiceClient = SupabaseClient

export type ProductImageRow = {
  id: string
  product_id: string
  image_url: string
  storage_path: string | null
  display_order: number
}

export async function countProductImages(supabase: AdminServiceClient, productId: string) {
  const { count, error } = await supabase
    .from('product_images')
    .select('id', { count: 'exact', head: true })
    .eq('product_id', productId)

  if (error) throw error
  return count ?? 0
}

export async function listProductImages(supabase: AdminServiceClient, productId: string) {
  const { data, error } = await supabase
    .from('product_images')
    .select('id, product_id, image_url, storage_path, display_order')
    .eq('product_id', productId)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as ProductImageRow[]
}

export async function syncPrimaryImage(supabase: AdminServiceClient, productId: string) {
  const images = await listProductImages(supabase, productId)
  const primaryUrl = images[0]?.image_url ?? null
  const { error } = await supabase
    .from('products')
    .update({ image_url: primaryUrl })
    .eq('id', productId)

  if (error) throw error
  return { primaryUrl, images }
}

export async function normalizeProductImageOrder(supabase: AdminServiceClient, productId: string) {
  const images = await listProductImages(supabase, productId)
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index]
    if (image.display_order === index) continue
    const { error } = await supabase
      .from('product_images')
      .update({ display_order: index })
      .eq('id', image.id)
      .eq('product_id', productId)
    if (error) throw error
  }
  return syncPrimaryImage(supabase, productId)
}

export function uniqueStoragePaths(paths: Array<string | null | undefined>) {
  return [...new Set(paths.map((path) => (typeof path === 'string' ? path.trim() : '')).filter(Boolean))]
}

export async function removeStorageFiles(supabase: AdminServiceClient, paths: Array<string | null | undefined>) {
  const uniquePaths = uniqueStoragePaths(paths)
  if (uniquePaths.length === 0) return

  const { error } = await supabase.storage.from('products').remove(uniquePaths)
  if (error) throw error
}
