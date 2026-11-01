import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { hasJalimsAdminAccess } from './admin-access'

export async function authorizeJalimsAdminRequest(request: Request, serviceName: string) {
  const accessToken = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!accessToken) {
    return { response: NextResponse.json({ error: 'Connectez-vous avec le compte administrateur pour continuer.' }, { status: 401 }) }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) {
    console.error(`[${serviceName}] Supabase public environment is not configured`)
    return { response: NextResponse.json({ error: 'Le service demandé n’est pas configuré correctement.' }, { status: 500 }) }
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await authClient.auth.getUser(accessToken)
  if (error) {
    console.error(`[${serviceName}] Admin authentication failed`, error.message)
    return { response: NextResponse.json({ error: 'Votre session n’a pas pu être vérifiée. Reconnectez-vous puis réessayez.' }, { status: 401 }) }
  }
  if (!hasJalimsAdminAccess(data.user)) {
    return { response: NextResponse.json({ error: 'Ce compte ne dispose pas des droits administrateur.' }, { status: 403 }) }
  }

  return { user: data.user }
}
