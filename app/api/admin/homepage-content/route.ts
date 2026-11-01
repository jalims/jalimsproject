import { NextResponse } from 'next/server'
import {
  defaultHomepageContent,
  getHomepageDesignContent,
  validateHomepageContent,
  validateHomepageDesignContent,
} from '../../../../lib/homepage-content'
import { authorizeJalimsAdminRequest } from '../../../../lib/admin-route-auth'
import { createSupabaseAdminClient } from '../../../../lib/paytech-admin'

export async function GET(request: Request) {
  const authorization = await authorizeJalimsAdminRequest(request, 'Homepage settings')
  if ('response' in authorization) return authorization.response

  try {
    const supabase = createSupabaseAdminClient()
    const { data, error } = await supabase
      .from('homepage_content')
      .select('*')
      .eq('id', 1)
      .maybeSingle()

    if (error) {
      console.error('[Homepage settings] Database read failed', error.message)
      return NextResponse.json({ error: 'Impossible de charger les réglages de l’accueil.' }, { status: 500 })
    }

    return NextResponse.json({
      content: { ...defaultHomepageContent, ...data },
      designContent: getHomepageDesignContent(data?.design_content),
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('[Homepage settings] Read failed', error instanceof Error ? error.message : 'Unknown error')
    return NextResponse.json({ error: 'Impossible de charger les réglages de l’accueil.' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  const authorization = await authorizeJalimsAdminRequest(request, 'Homepage settings')
  if ('response' in authorization) return authorization.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Le contenu reçu est invalide.' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: 'Le contenu reçu est invalide.' }, { status: 400 })
  }

  const content = validateHomepageContent((body as Record<string, unknown>).content)
  const designContent = validateHomepageDesignContent((body as Record<string, unknown>).designContent)
  if (!content || !designContent) {
    return NextResponse.json({
      error: 'Certains champs sont invalides : vérifiez les longueurs, les liens HTTPS ou internes, les icônes et l’absence de HTML.',
    }, { status: 400 })
  }

  try {
    const supabase = createSupabaseAdminClient()
    const { error } = await supabase
      .from('homepage_content')
      .upsert({ ...content, id: 1, design_content: designContent, updated_at: new Date().toISOString() }, { onConflict: 'id' })

    if (error) {
      console.error('[Homepage settings] Database write failed', error.message)
      return NextResponse.json({ error: 'Les réglages de l’accueil n’ont pas pu être enregistrés.' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Homepage settings] Write failed', error instanceof Error ? error.message : 'Unknown error')
    return NextResponse.json({ error: 'Les réglages de l’accueil n’ont pas pu être enregistrés.' }, { status: 500 })
  }
}
