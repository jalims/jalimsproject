import { after } from 'next/server'
import { Resend } from 'resend'
import { createSupabaseAdminClient } from '../../../lib/supabase-admin'

const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
])
const HONEYPOT_FIELD = 'company_website'

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status })
}

function cleanText(value: FormDataEntryValue | null, maxLength: number) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

function isValidHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function normalizeWhatsApp(value: string) {
  let cleaned = value.trim().replace(/[\s.\-()]/g, '')
  if (cleaned.startsWith('00')) {
    cleaned = `+${cleaned.slice(2)}`
  }

  if (/^\d{9}$/.test(cleaned) && /^(70|75|76|77|78)/.test(cleaned)) {
    return `+221${cleaned}`
  }

  if (/^\d{12}$/.test(cleaned) && cleaned.startsWith('221')) {
    return `+${cleaned}`
  }

  if (cleaned.startsWith('+') && /^\+\d{8,15}$/.test(cleaned)) {
    return cleaned
  }

  return null
}

function getClientIp(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown'
  const realIp = request.headers.get('x-real-ip')?.trim()
  if (realIp) return realIp
  return 'unknown'
}

async function hashValue(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function sendAdminNotification(payload: {
  id: string
  searchQuery: string
  whatsapp: string
  link: string
  description: string
  imagePath: string | null
}) {
  const apiKey = process.env.RESEND_API_KEY
  const to = process.env.PRODUCT_REQUEST_NOTIFY_EMAIL
  const from = process.env.PRODUCT_REQUEST_FROM_EMAIL || 'Jalims <notifications@jalims.com>'
  if (!apiKey || !to) {
    console.warn('[Product requests] Admin notification skipped: RESEND_API_KEY or PRODUCT_REQUEST_NOTIFY_EMAIL missing')
    return
  }

  const supabase = createSupabaseAdminClient()
  let imageUrl: string | null = null
  if (payload.imagePath) {
    const { data, error } = await supabase.storage
      .from('product-requests')
      .createSignedUrl(payload.imagePath, 60 * 60 * 24 * 7)
    if (error) {
      console.error('[Product requests] Signed URL creation failed', error)
    } else {
      imageUrl = data?.signedUrl ?? null
    }
  }

  const resend = new Resend(apiKey)
  const subject = `Nouvelle demande produit${payload.searchQuery ? ` : ${payload.searchQuery}` : ''}`
  const lines = [
    `Recherche : ${payload.searchQuery || '—'}`,
    `WhatsApp : ${payload.whatsapp}`,
    `Lien : ${payload.link || '—'}`,
    `Description : ${payload.description || '—'}`,
    `Photo : ${imageUrl || '—'}`,
    `Demande : ${payload.id}`,
  ]

  const { error } = await resend.emails.send({
    from,
    to,
    subject,
    text: lines.join('\n'),
    html: `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
      <h2 style="margin:0 0 12px">Nouvelle demande produit</h2>
      <p><strong>Recherche :</strong> ${escapeHtml(payload.searchQuery || '—')}</p>
      <p><strong>WhatsApp :</strong> ${escapeHtml(payload.whatsapp)}</p>
      <p><strong>Lien :</strong> ${payload.link ? `<a href="${escapeHtml(payload.link)}">${escapeHtml(payload.link)}</a>` : '—'}</p>
      <p><strong>Description :</strong> ${escapeHtml(payload.description || '—')}</p>
      <p><strong>Photo :</strong> ${imageUrl ? `<a href="${escapeHtml(imageUrl)}">Voir la photo</a>` : '—'}</p>
      <p style="color:#666;font-size:12px">ID demande : ${escapeHtml(payload.id)}</p>
    </div>`,
  })

  if (error) {
    console.error('[Product requests] Admin notification send failed', error)
  }
}

export async function POST(request: Request) {
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return jsonError('Formulaire invalide.', 400)
  }

  const honeypot = cleanText(formData.get(HONEYPOT_FIELD), 200)
  if (honeypot) {
    return Response.json({ ok: true }, { status: 202 })
  }

  const searchQuery = cleanText(formData.get('search_query'), 200)
  const whatsappInput = cleanText(formData.get('whatsapp'), 40)
  const whatsapp = normalizeWhatsApp(whatsappInput)
  const link = cleanText(formData.get('link'), 2000)
  const description = cleanText(formData.get('description'), 2000)
  const imageValue = formData.get('image')

  if (!whatsapp) {
    return jsonError('Indique un numéro WhatsApp valide (ex. 771234567, +221771234567 ou format international).', 400)
  }
  if (link && !isValidHttpUrl(link)) {
    return jsonError('Le lien du produit doit commencer par http:// ou https://.', 400)
  }

  const hasImage = imageValue instanceof File && imageValue.size > 0
  if (!hasImage && !link) {
    return jsonError('Ajoute une photo du produit ou un lien.', 400)
  }

  let imageFile: File | null = null
  let imageExtension: string | null = null
  if (hasImage && imageValue instanceof File) {
    if (imageValue.size > MAX_IMAGE_BYTES) {
      return jsonError('La photo ne doit pas dépasser 4 Mo.', 400)
    }
    imageExtension = ALLOWED_IMAGE_TYPES.get(imageValue.type) ?? null
    if (!imageExtension) {
      return jsonError('La photo doit être au format JPG, PNG ou WEBP.', 400)
    }
    imageFile = imageValue
  }

  let supabase
  try {
    supabase = createSupabaseAdminClient()
  } catch (error) {
    console.error('[Product requests] Supabase admin client unavailable', error)
    return jsonError('Service indisponible.', 503)
  }

  try {
    const ip = getClientIp(request)
    const key = `product_request_ip:${await hashValue(ip)}`
    const { data: limited, error: rateError } = await supabase.rpc('consume_product_request_rate_limit', {
      p_key: key,
      p_limit: 5,
    })
    if (rateError) {
      console.error('[Product requests] Rate limit check failed', rateError)
    } else if (limited === true) {
      return jsonError('Trop de demandes envoyées. Réessaie dans quelques minutes.', 429)
    }
  } catch (error) {
    console.error('[Product requests] Rate limit check failed', error)
  }

  let userId: string | null = null
  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim()
    if (token) {
      const { data, error } = await supabase.auth.getUser(token)
      if (error) {
        console.error('[Product requests] Access token lookup failed', error)
      } else {
        userId = data.user?.id ?? null
      }
    }
  }

  const requestId = crypto.randomUUID()
  let imagePath: string | null = null

  if (imageFile && imageExtension) {
    imagePath = `${requestId}.${imageExtension}`
    const buffer = Buffer.from(await imageFile.arrayBuffer())
    const { error: uploadError } = await supabase.storage
      .from('product-requests')
      .upload(imagePath, buffer, {
        contentType: imageFile.type,
        cacheControl: '3600',
        upsert: false,
      })

    if (uploadError) {
      console.error('[Product requests] Image upload failed', uploadError)
      return jsonError('Impossible d’envoyer la photo. Réessaie.', 500)
    }
  }

  const { data: inserted, error: insertError } = await supabase
    .from('product_requests')
    .insert({
      id: requestId,
      search_query: searchQuery || null,
      whatsapp,
      link: link || null,
      description: description || null,
      image_path: imagePath,
      user_id: userId,
      status: 'new',
    })
    .select('id')
    .single()

  if (insertError || !inserted) {
    console.error('[Product requests] Insert failed', insertError)
    if (imagePath) {
      const { error: removeError } = await supabase.storage.from('product-requests').remove([imagePath])
      if (removeError) {
        console.error('[Product requests] Failed to remove uploaded image after insert error', removeError)
      }
    }
    return jsonError('Impossible d’enregistrer ta demande. Réessaie.', 500)
  }

  after(async () => {
    try {
      await sendAdminNotification({
        id: inserted.id,
        searchQuery,
        whatsapp,
        link,
        description,
        imagePath,
      })
    } catch (error) {
      console.error('[Product requests] Admin notification failed', error)
    }
  })

  return Response.json({ ok: true, id: inserted.id }, { status: 201 })
}
