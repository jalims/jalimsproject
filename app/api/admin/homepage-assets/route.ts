import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { authorizeJalimsAdminRequest } from '../../../../lib/admin-route-auth'
import { createSupabaseAdminClient } from '../../../../lib/paytech-admin'

const maximumImageSize = 2 * 1024 * 1024
const allowedSlots = ['hero-desktop', 'hero-mobile', 'process'] as const
type ImageSlot = (typeof allowedSlots)[number]

function isImageSlot(value: string): value is ImageSlot {
  return allowedSlots.includes(value as ImageSlot)
}

function getImageExtension(file: File, bytes: Uint8Array) {
  if (file.type === 'image/jpeg'
    && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (file.type === 'image/png'
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'png'
  if (file.type === 'image/webp'
    && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'webp'
  return null
}

function isHomepageAssetPath(path: unknown): path is string {
  return typeof path === 'string'
    && /^home\/(hero-desktop|hero-mobile|process)\/[A-Za-z0-9-]+\.(?:jpg|png|webp)$/.test(path)
}

export async function POST(request: Request) {
  const authorization = await authorizeJalimsAdminRequest(request, 'Homepage assets')
  if ('response' in authorization) return authorization.response

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Le fichier reçu est invalide.' }, { status: 400 })
  }
  const file = formData.get('file')
  const slot = formData.get('slot')
  if (!(file instanceof File) || typeof slot !== 'string' || !isImageSlot(slot)) {
    return NextResponse.json({ error: 'Choisissez une image JPG, PNG ou WebP valide.' }, { status: 400 })
  }
  if (file.size === 0 || file.size > maximumImageSize) {
    return NextResponse.json({ error: 'L’image doit peser au maximum 2 Mo.' }, { status: 400 })
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const extension = getImageExtension(file, bytes)
  if (!extension) {
    return NextResponse.json({ error: 'Le format ou le contenu de l’image est invalide. Les fichiers SVG ne sont pas acceptés.' }, { status: 400 })
  }

  const path = `home/${slot}/${randomUUID()}.${extension}`
  try {
    const supabase = createSupabaseAdminClient()
    const { error } = await supabase.storage
      .from('site-assets')
      .upload(path, Buffer.from(bytes), { contentType: file.type, upsert: false })

    if (error) {
      console.error('[Homepage assets] Upload failed', error.message)
      return NextResponse.json({ error: 'L’image n’a pas pu être téléversée.' }, { status: 500 })
    }

    return NextResponse.json({ path })
  } catch (error) {
    console.error('[Homepage assets] Upload failed', error instanceof Error ? error.message : 'Unknown error')
    return NextResponse.json({ error: 'L’image n’a pas pu être téléversée.' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const authorization = await authorizeJalimsAdminRequest(request, 'Homepage assets')
  if ('response' in authorization) return authorization.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'La demande de suppression est invalide.' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: 'La demande de suppression est invalide.' }, { status: 400 })
  }
  const paths = (body as Record<string, unknown>).paths
  if (!Array.isArray(paths) || paths.length > 10 || !paths.every(isHomepageAssetPath)) {
    return NextResponse.json({ error: 'La liste des images à supprimer est invalide.' }, { status: 400 })
  }
  if (paths.length === 0) return NextResponse.json({ success: true })

  try {
    const supabase = createSupabaseAdminClient()
    const { error } = await supabase.storage.from('site-assets').remove(paths)
    if (error) {
      console.error('[Homepage assets] Delete failed', error.message)
      return NextResponse.json({ error: 'Une ancienne image n’a pas pu être supprimée.' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Homepage assets] Delete failed', error instanceof Error ? error.message : 'Unknown error')
    return NextResponse.json({ error: 'Une ancienne image n’a pas pu être supprimée.' }, { status: 500 })
  }
}
