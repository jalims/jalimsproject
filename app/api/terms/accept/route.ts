import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '../../../../lib/paytech-admin'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: Request) {
  const accessToken = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!accessToken) {
    return jsonError('Connectez-vous pour enregistrer votre acceptation des conditions.', 401)
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) {
    console.error('[Terms acceptance] La configuration publique de Supabase est manquante.')
    return jsonError('Le service des conditions n’est pas configuré correctement.', 500)
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: authData, error: authError } = await authClient.auth.getUser(accessToken)
  if (authError || !authData.user) {
    console.error('[Terms acceptance] Vérification de session impossible.', {
      errorName: authError instanceof Error ? authError.name : 'unknown',
    })
    return jsonError('Votre session n’a pas pu être vérifiée. Reconnectez-vous puis réessayez.', 401)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError('La demande d’acceptation est illisible.', 400)
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body) || !('accepted' in body) || body.accepted !== true) {
    return jsonError('Confirmez votre acceptation des conditions pour continuer.', 400)
  }

  try {
    const supabase = createSupabaseAdminClient()
    const { data: page, error: pageError } = await supabase
      .from('legal_page_versions')
      .select('version, body')
      .eq('slug', 'conditions')
      .eq('status', 'publie')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (pageError) {
      console.error('[Terms acceptance] Chargement de la version publiée impossible.', { errorCode: pageError.code })
      return jsonError('L’acceptation des conditions n’a pas pu être enregistrée.', 500)
    }
    if (!page) {
      return NextResponse.json({ accepted: false, message: 'Aucune version des conditions n’est publiée.' })
    }

    const bodySha256 = createHash('sha256').update(page.body, 'utf8').digest('hex')
    const { error: insertError } = await supabase
      .from('terms_acceptances')
      .insert({
        user_id: authData.user.id,
        slug: 'conditions',
        version: page.version,
        body_sha256: bodySha256,
      })

    if (insertError && insertError.code !== '23505') {
      console.error('[Terms acceptance] Enregistrement impossible.', { errorCode: insertError.code })
      return jsonError('L’acceptation des conditions n’a pas pu être enregistrée.', 500)
    }

    return NextResponse.json({ accepted: true, version: page.version })
  } catch (error) {
    console.error('[Terms acceptance] Enregistrement impossible.', {
      errorName: error instanceof Error ? error.name : 'unknown',
    })
    return jsonError('L’acceptation des conditions n’a pas pu être enregistrée.', 500)
  }
}
