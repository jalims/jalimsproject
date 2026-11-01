import { createClient } from '@supabase/supabase-js'
import type { LegalPageVersion } from './legal-page-types'

export async function getLatestPublishedLegalPage(): Promise<LegalPageVersion | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) {
    throw new Error('La configuration publique de Supabase est manquante.')
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await supabase
    .from('legal_page_versions')
    .select('id, slug, version, title, body, status, published_at, created_at, created_by')
    .eq('slug', 'conditions')
    .eq('status', 'publie')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`Impossible de charger la dernière version des conditions : ${error.message}`)
  }

  return data
}
