import { NextResponse } from 'next/server'
import { ADMIN_AND_OWNER_ROLES, requireRole } from '../../../../../lib/admin-staff'
import {
  listProductImages,
  normalizeProductImageOrder,
  removeStorageFiles,
  syncPrimaryImage,
} from '../../../../../lib/admin-product-images'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function readJson(request: Request) {
  try {
    return await request.json() as unknown
  } catch {
    return null
  }
}

function getUuid(value: unknown) {
  return typeof value === 'string' && uuidPattern.test(value) ? value : null
}

export async function DELETE(request: Request) {
  const authorization = await requireRole(request, ADMIN_AND_OWNER_ROLES, 'Admin product images')
  if ('response' in authorization) return authorization.response

  const body = await readJson(request)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'La demande reçue est invalide.' }, { status: 400 })
  }
  const payload = body as Record<string, unknown>
  const productId = getUuid(payload.id)
  const imageId = getUuid(payload.imageId)
  if (!productId || !imageId) {
    return NextResponse.json({ error: 'La demande reçue est invalide.' }, { status: 400 })
  }

  try {
    const supabase = authorization.supabase
    const { data: image, error: imageError } = await supabase
      .from('product_images')
      .select('id, storage_path')
      .eq('id', imageId)
      .eq('product_id', productId)
      .maybeSingle()

    if (imageError) {
      console.error('[Admin product images] Image lookup failed', imageError.message)
      return NextResponse.json({ error: 'Impossible de vérifier cette image.' }, { status: 500 })
    }
    if (!image) {
      return NextResponse.json({ error: 'Image introuvable.' }, { status: 404 })
    }

    const { error: deleteError } = await supabase
      .from('product_images')
      .delete()
      .eq('id', imageId)
      .eq('product_id', productId)
    if (deleteError) {
      console.error('[Admin product images] Delete failed', deleteError.message)
      return NextResponse.json({ error: 'L’image n’a pas pu être supprimée.' }, { status: 500 })
    }

    try {
      await removeStorageFiles(supabase, [image.storage_path])
    } catch (storageError) {
      console.error('[Admin product images] Storage delete failed', storageError instanceof Error ? storageError.message : storageError)
    }

    const { images } = await normalizeProductImageOrder(supabase, productId)
    return NextResponse.json({ success: true, images })
  } catch (error) {
    console.error('[Admin product images] Delete failed', error instanceof Error ? error.message : 'Unknown error')
    return NextResponse.json({ error: 'L’image n’a pas pu être supprimée.' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const authorization = await requireRole(request, ADMIN_AND_OWNER_ROLES, 'Admin product images')
  if ('response' in authorization) return authorization.response

  const body = await readJson(request)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'La demande reçue est invalide.' }, { status: 400 })
  }
  const payload = body as Record<string, unknown>
  const productId = getUuid(payload.id)
  const action = typeof payload.action === 'string' ? payload.action : null
  if (!productId || !action) {
    return NextResponse.json({ error: 'La demande reçue est invalide.' }, { status: 400 })
  }

  try {
    const supabase = authorization.supabase

    if (action === 'reorder') {
      const orderedImageIds = Array.isArray(payload.orderedImageIds)
        ? payload.orderedImageIds.filter((value): value is string => getUuid(value) !== null)
        : []
      if (orderedImageIds.length === 0 || orderedImageIds.length !== new Set(orderedImageIds).size) {
        return NextResponse.json({ error: 'L’ordre des images est invalide.' }, { status: 400 })
      }

      const currentImages = await listProductImages(supabase, productId)
      const currentIds = currentImages.map((image) => image.id)
      if (
        currentIds.length !== orderedImageIds.length ||
        !currentIds.every((id) => orderedImageIds.includes(id))
      ) {
        return NextResponse.json({ error: 'L’ordre des images est invalide.' }, { status: 400 })
      }

      for (let index = 0; index < orderedImageIds.length; index += 1) {
        const { error } = await supabase
          .from('product_images')
          .update({ display_order: 1000 + index })
          .eq('id', orderedImageIds[index])
          .eq('product_id', productId)
        if (error) throw error
      }
      for (let index = 0; index < orderedImageIds.length; index += 1) {
        const { error } = await supabase
          .from('product_images')
          .update({ display_order: index })
          .eq('id', orderedImageIds[index])
          .eq('product_id', productId)
        if (error) throw error
      }

      const { images } = await syncPrimaryImage(supabase, productId)
      return NextResponse.json({ success: true, images })
    }

    if (action === 'replace') {
      const imageId = getUuid(payload.imageId)
      const imageUrl = typeof payload.image_url === 'string' ? payload.image_url.trim() : ''
      const storagePath = typeof payload.storage_path === 'string' ? payload.storage_path.trim() : ''
      if (!imageId || !/^https?:\/\//i.test(imageUrl) || !storagePath) {
        return NextResponse.json({ error: 'Les informations de remplacement sont invalides.' }, { status: 400 })
      }
      if (!storagePath.startsWith(`${productId}/`)) {
        return NextResponse.json({ error: 'Le chemin de stockage de l’image est invalide.' }, { status: 400 })
      }

      const { data: image, error: imageError } = await supabase
        .from('product_images')
        .select('id, storage_path')
        .eq('id', imageId)
        .eq('product_id', productId)
        .maybeSingle()
      if (imageError) {
        console.error('[Admin product images] Image lookup failed', imageError.message)
        return NextResponse.json({ error: 'Impossible de vérifier cette image.' }, { status: 500 })
      }
      if (!image) {
        return NextResponse.json({ error: 'Image introuvable.' }, { status: 404 })
      }

      const { error: updateError } = await supabase
        .from('product_images')
        .update({ image_url: imageUrl, storage_path: storagePath })
        .eq('id', imageId)
        .eq('product_id', productId)
      if (updateError) {
        console.error('[Admin product images] Replace failed', updateError.message)
        return NextResponse.json({ error: 'L’image n’a pas pu être remplacée.' }, { status: 500 })
      }

      if (image.storage_path && image.storage_path !== storagePath) {
        try {
          await removeStorageFiles(supabase, [image.storage_path])
        } catch (storageError) {
          console.error('[Admin product images] Old storage delete failed', storageError instanceof Error ? storageError.message : storageError)
        }
      }

      const { images } = await syncPrimaryImage(supabase, productId)
      return NextResponse.json({ success: true, images })
    }

    return NextResponse.json({ error: 'La demande reçue est invalide.' }, { status: 400 })
  } catch (error) {
    console.error('[Admin product images] Update failed', error instanceof Error ? error.message : 'Unknown error')
    return NextResponse.json({ error: 'La modification de l’image n’a pas pu être enregistrée.' }, { status: 500 })
  }
}
