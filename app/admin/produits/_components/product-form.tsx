'use client'

import Image from 'next/image'
import Link from 'next/link'
import { FormEvent, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { canAccessAdminPath, getStaffRoleForUser } from '../../../../lib/admin-staff-client'
import { logClientError } from '../../../../lib/user-facing-errors'
import { useAdminSession } from '../../admin-session-provider'
import { DEFAULT_APP_PRICING_SETTINGS, getDisplayedUnitPrice, normalizeAppPricingSettings, type AppPricingSettings } from '../../../../lib/imported-product-pricing'
import QuantityInput from '../../../ui/quantity-input'
import { Badge, Button, Card, ConfirmDialog, Input, PageHeader, Select, Skeleton, Textarea, useToast } from '../../_components'
import { PRODUCT_SELECT_COLUMNS, requestAdminProductImages, requestAdminProducts, type Product, type SupplierCost } from './product-data'

type PartnerOption = { id: string; name: string; city: string; active: boolean }
type ExistingProductImage = {
  id: string
  image_url: string
  storage_path: string | null
  display_order: number
}
type AttributeDefinition = {
  attribute_key: string
  label: string
  sort_order: number
}

type VariantDraft = {
  stock: string
  priceAdjustment: string
}


const emptyForm = {
  name: '',
  description: '',
  price: '',
  deliveryEstimate: '',
  imageUrl: '',
  category: '',
  moq: '1',
  stockStatus: 'available',
  featured: false,
  origin: 'import' as 'local' | 'import',
  localStock: '',
  city: '',
  deliveryDelay: '',
  partnerId: '',
  importBasePrice: '',
  importBaseCurrency: 'FCFA' as 'FCFA' | 'CNY',
  importWeightKg: '',
  importOtherFeesFcfa: '0',
  supplierPurchasePrice: '',
  supplierCurrency: 'FCFA' as 'FCFA' | 'CNY',
}

function getPreviewUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ?url.toString() : null
  } catch {
    return null
  }
}

function parseAttributeValues(value: string) {
  return [...new Set(value.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean))]
}

function getVariantKey(attributeValues: Record<string, string>) {
  return JSON.stringify(Object.fromEntries(Object.entries(attributeValues).sort(([left], [right]) => left.localeCompare(right))))
}

function buildVariantCombinations(attributes: { key: string; values: string[] }[]) {
  if (attributes.length === 0 || attributes.some((attribute) => attribute.values.length === 0)) return []

  return attributes.reduce<Record<string, string>[]>(
    (combinations, attribute) => combinations.flatMap((combination) => attribute.values.map((value) => ({ ...combination, [attribute.key]: value }))),
    [{}],
  )
}

export default function ProductForm({ productId }: { productId?: string }) {
  const router = useRouter()
  const { toast } = useToast()
  const { userId, role: staffRole, loading: sessionLoading, error: sessionError } = useAdminSession()
  const [partnerOptions, setPartnerOptions] = useState<PartnerOption[]>([])
  const [appSettings, setAppSettings] = useState<AppPricingSettings>(DEFAULT_APP_PRICING_SETTINGS)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(productId ?? null)
  const [editingActive, setEditingActive] = useState(true)
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [imagePreviews, setImagePreviews] = useState<{ file: File; url: string }[]>([])
  const [uploadRetryAvailable, setUploadRetryAvailable] = useState(false)
  const [existingImages, setExistingImages] = useState<ExistingProductImage[]>([])
  const [existingImagesLoading, setExistingImagesLoading] = useState(false)
  const [imageActionBusy, setImageActionBusy] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [unpublishing, setUnpublishing] = useState(false)
  const [confirmUnpublish, setConfirmUnpublish] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [productLoadError, setProductLoadError] = useState('')
  const [categoryOptions, setCategoryOptions] = useState<string[]>([])
  const [attributeDefinitions, setAttributeDefinitions] = useState<AttributeDefinition[]>([])
  const [selectedAttributeKeys, setSelectedAttributeKeys] = useState<string[]>([])
  const [attributeValueInputs, setAttributeValueInputs] = useState<Record<string, string>>({})
  const [attributeColorInputs, setAttributeColorInputs] = useState<Record<string, Record<string, string>>>({})
  const [variantDrafts, setVariantDrafts] = useState<Record<string, VariantDraft>>({})
  const [variantConfigLoading, setVariantConfigLoading] = useState(false)

  async function loadAppSettings() {
    const { data, error } = await supabase
      .from('app_settings')
      .select('transport_price_per_kg_fcfa, commission_percent, customs_percent, cny_to_fcfa_rate')
      .eq('id', 1)
      .maybeSingle()
    if (!error) setAppSettings(normalizeAppPricingSettings(data as Partial<AppPricingSettings> | null))
  }

  async function loadPartnerOptions() {
    const { data, error } = await supabase
      .from('partners')
      .select('id, name, city, active')
      .eq('active', true)
      .order('name')
    if (error) {
      logClientError('Admin product partner list load failed', error)
      setFeedback({ kind: 'error', text: 'Impossible de charger la liste des partenaires actifs.' })
      return
    }
    setPartnerOptions((data ?? []) as PartnerOption[])
  }

  async function loadAttributeDefinitions() {
    const { data, error } = await supabase
      .from('product_attribute_definitions')
      .select('attribute_key, label, sort_order')
      .eq('enabled', true)
      .order('sort_order')

    if (error) {
      logClientError('Admin product attributes load failed', error)
      setFeedback({ kind: 'error', text: 'Impossible de charger les options produit pour le moment.' })
      return
    }

    setAttributeDefinitions((data ?? []) as AttributeDefinition[])
  }

  function updateVariantDraft(attributeValues: Record<string, string>, field: keyof VariantDraft, value: string) {
    const key = getVariantKey(attributeValues)
    setVariantDrafts((current) => ({
      ...current,
      [key]: { ...(current[key] ?? { stock: '', priceAdjustment: '0' }), [field]: value },
    }))
  }
  useEffect(() => {
  async function loadCategories() {
    const { data } = await supabase.from('categories').select('name').order('name')
    setCategoryOptions((data ?? []).map((c) => c.name))
  }
  void loadCategories()
}, [])
  useEffect(() => {
    if (imageFiles.length === 0) return

    let cancelled = false
    Promise.all(imageFiles.map((file) => new Promise<{ file: File; url: string }>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => typeof reader.result === 'string' ?resolve({ file, url: reader.result }) : reject(new Error('Aperçu image indisponible'))
      reader.onerror = () => reject(new Error('Lecture de la photo impossible'))
      reader.readAsDataURL(file)
    }))).then((previews) => {
      if (!cancelled) setImagePreviews(previews)
    }).catch(() => {
      if (!cancelled) setImagePreviews([])
    })

    return () => {
      cancelled = true
    }
  }, [imageFiles])

  async function uploadProductImages(productId: string, files: File[]) {
    const { data: existingRows, error: existingRowsError } = await supabase
      .from('product_images')
      .select('display_order')
      .eq('product_id', productId)
      .order('display_order', { ascending: false })
      .limit(1)
    if (existingRowsError) {
      logClientError('Admin product image order lookup failed', existingRowsError)
      return { galleryRows: [], failedFiles: files, primaryImageUrl: null, error: 'Impossible de préparer l’ajout des photos. Réessayez.' }
    }

    const firstOrder = (existingRows?.[0]?.display_order ?? -1) + 1
    const galleryRows: { product_id: string; image_url: string; storage_path: string; display_order: number }[] = []
    const uploadedPaths: string[] = []
    const failedFiles: File[] = []
    let primaryImageUrl: string | null = null

    for (const file of files) {
      const objectPath = `${productId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`
      const { error: uploadError } = await supabase.storage.from('products').upload(objectPath, file, {
        cacheControl: '3600',
        contentType: file.type,
        upsert: false,
      })

      if (uploadError) {
        logClientError('Admin product image upload failed', uploadError)
        failedFiles.push(file)
        continue
      }

      uploadedPaths.push(objectPath)
      const publicUrl = supabase.storage.from('products').getPublicUrl(objectPath).data.publicUrl
      if (galleryRows.length === 0) primaryImageUrl = publicUrl
      galleryRows.push({
        product_id: productId,
        image_url: publicUrl,
        storage_path: objectPath,
        display_order: firstOrder + galleryRows.length,
      })
    }

    if (galleryRows.length > 0) {
      const { error: galleryError } = await supabase.from('product_images').insert(galleryRows)
      if (galleryError) {
        logClientError('Admin product gallery save failed', galleryError)
        const { error: cleanupError } = await supabase.storage.from('products').remove(uploadedPaths)
        if (cleanupError) logClientError('Admin product orphan image cleanup failed', cleanupError)
        return { galleryRows: [], failedFiles: files, primaryImageUrl: null, error: 'Les photos envoyées n’ont pas pu être ajoutées à la galerie. Elles restent sélectionnées pour réessayer.' }
      }
    }

    return { galleryRows, failedFiles, primaryImageUrl, error: null }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFeedback(null)
    if (uploadRetryAvailable) {
      setFeedback({ kind: 'error', text: 'Réessayez d’abord l’envoi des photos restantes avec le bouton prévu à cet effet.' })
      return
    }
    const submitter = (event.nativeEvent as SubmitEvent).submitter
    const submitAction = submitter instanceof HTMLButtonElement ? submitter.value : 'draft'

    const name = form.name.trim()
    const price = Number(form.price)
    const moq = Number(form.moq)
    const localStock = form.origin === 'local' ? Number(form.localStock) : 0
    const fallbackImageUrl = getPreviewUrl(form.imageUrl.trim())
    const configuredAttributes = selectedAttributeKeys.map((attributeKey) => ({
      attribute_key: attributeKey,
      attribute_values: parseAttributeValues(attributeValueInputs[attributeKey] ?? ''),
      attribute_colors: attributeKey === 'color' ? (attributeColorInputs[attributeKey] ?? {}) : {},
    }))
    const variantCombinations = buildVariantCombinations(configuredAttributes.map((attribute) => ({
      key: attribute.attribute_key,
      values: attribute.attribute_values,
    })))

    if (!name || !Number.isFinite(price) || price <= 0 || !Number.isInteger(moq) || moq < 1) {
      setFeedback({ kind: 'error', text: 'Vérifiez le nom, le prix et la quantité minimale.' })
      return
    }

    if (form.origin === 'local' && (
      !Number.isInteger(localStock) || localStock <= 0 || !form.city.trim() || !form.deliveryDelay.trim() || !form.partnerId
    )) {
      setFeedback({ kind: 'error', text: 'Pour un produit disponible au Sénégal, indiquez un stock, une ville, un délai et un partenaire actif.' })
      return
    }

    if (variantConfigLoading) {
      setFeedback({ kind: 'error', text: 'Patientez pendant le chargement des options du produit.' })
      return
    }

    if (configuredAttributes.some((attribute) => attribute.attribute_values.length === 0)) {
      setFeedback({ kind: 'error', text: 'Ajoutez au moins une valeur pour chaque attribut activ?.' })
      return
    }

    const configuredVariants = variantCombinations.map((attributeValues) => {
      const draft = variantDrafts[getVariantKey(attributeValues)] ?? { stock: '', priceAdjustment: '0' }
      return {
        attribute_values: attributeValues,
        stock: draft.stock.trim() === '' ? null : Number(draft.stock),
        price_adjustment: Number(draft.priceAdjustment),
      }
    })

    if (configuredVariants.some((variant) => (
      (variant.stock !== null && (!Number.isInteger(variant.stock) || variant.stock < 0))
      || !Number.isFinite(variant.price_adjustment)
      || price + variant.price_adjustment <= 0
    ))) {
      setFeedback({ kind: 'error', text: 'Vérifiez le stock et les ajustements de prix de chaque combinaison.' })
      return
    }

    if (imageFiles.some((file) => file.size > 6 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) {
      setFeedback({ kind: 'error', text: 'Chaque photo doit être au format JPG, PNG ou WebP et faire 6 Mo maximum.' })
      return
    }

    const totalImages = existingImages.length + imageFiles.length
    let publishable = totalImages >= 3

    if (!editingId && imageFiles.length === 0) {
      setFeedback({ kind: 'error', text: 'Ajoutez au moins une photo pour créer ce produit (1 ou 2 photos : brouillon, 3 ou plus : publication possible).' })
      return
    }

    if (editingId && totalImages === 0 && !fallbackImageUrl) {
      setFeedback({ kind: 'error', text: 'Ajoutez au moins une photo ou conservez une image existante.' })
      return
    }

    setSaving(true)
    try {
      const { data: refreshedAuth, error: refreshError } = await supabase.auth.refreshSession()
      const refreshedUser = refreshedAuth.session?.user
      const refreshedRole = refreshedUser ? await getStaffRoleForUser(refreshedUser) : null
      if (refreshError || !canAccessAdminPath(refreshedRole, '/admin/produits')) {
        if (refreshError) logClientError('Admin access refresh failed', refreshError)
        setFeedback({
          kind: 'error',
          text: 'Impossible de vérifier votre accès administrateur. Reconnectez-vous puis réessayez.',
        })
        setSaving(false)
        return
      }
    } catch (error) {
      logClientError('Admin access refresh failed', error)
      setSaving(false)
      setFeedback({
        kind: 'error',
        text: 'Impossible de vérifier votre accès administrateur. Reconnectez-vous puis réessayez.',
      })
      return
    }

    let productId = editingId

    const baseImageUrl = editingId
      ? (existingImages[0]?.image_url ?? fallbackImageUrl ?? null)
      : (fallbackImageUrl ?? null)
    let desiredActive = editingId
      ? (editingActive || (submitAction === 'publish' && publishable))
      : submitAction === 'publish' && publishable
    const importBasePrice = form.origin === 'import' && form.importBasePrice.trim() !== '' ? Number(form.importBasePrice) : null
    const importBaseCurrency = form.origin === 'import' ? (form.importBaseCurrency === 'CNY' ? 'CNY' : 'FCFA') : null
    const importWeightKg = form.origin === 'import' && form.importWeightKg.trim() !== '' ? Number(form.importWeightKg) : null
    const importOtherFeesFcfa = form.origin === 'import' && form.importOtherFeesFcfa.trim() !== '' ? Number(form.importOtherFeesFcfa) : 0
    const productValues = {
      name,
      description: form.description.trim(),
      price,
      delivery_estimate: form.deliveryEstimate.trim() || null,
      image_url: baseImageUrl,
      category: form.category.trim() || null,
      moq,
      stock_status: form.stockStatus,
      featured: form.featured,
      active: desiredActive,
      origin: form.origin,
      local_stock: localStock,
      city: form.origin === 'local' ? form.city.trim() : null,
      delivery_delay: form.origin === 'local' ? form.deliveryDelay.trim() : null,
      partner_id: form.origin === 'local' ? form.partnerId : null,
      import_base_price: form.origin === 'import' ? importBasePrice : null,
      import_base_currency: form.origin === 'import' ? (importBasePrice === null ? null : importBaseCurrency) : null,
      import_weight_kg: form.origin === 'import' ? importWeightKg : null,
      import_other_fees_fcfa: form.origin === 'import' ? importOtherFeesFcfa : 0,
    }

    if (!productId) {
      productId = crypto.randomUUID()
      const { error } = await requestAdminProducts('POST', {
        id: productId,
        product: { ...productValues, active: false },
      })

      if (error) {
        setSaving(false)
        setFeedback({ kind: 'error', text: error })
        return
      }
      setEditingId(productId)
      setEditingActive(false)
    }

    let primaryImageUrl = baseImageUrl
    let hasImageUploadFailures = false
    let failedImageFiles: File[] = []
    if (imageFiles.length > 0) {
      const uploadResult = await uploadProductImages(productId, imageFiles)
      if (uploadResult.error) {
        setUploadRetryAvailable(true)
        setSaving(false)
        setFeedback({ kind: 'error', text: uploadResult.error })
        return
      }
      if (existingImages.length === 0 && uploadResult.galleryRows.length > 0) {
        primaryImageUrl = uploadResult.primaryImageUrl
      }
      failedImageFiles = uploadResult.failedFiles
      hasImageUploadFailures = failedImageFiles.length > 0
      if (hasImageUploadFailures) {
        setImageFiles(failedImageFiles)
        setImagePreviews([])
        setUploadRetryAvailable(true)
        publishable = existingImages.length + uploadResult.galleryRows.length >= 3
        desiredActive = editingId ? editingActive : false
        await loadProductImages(productId)
      } else {
        setImageFiles([])
        setUploadRetryAvailable(false)
      }
    }

    const finalPrimaryImageUrl = existingImages[0]?.image_url ?? primaryImageUrl ?? null
    const { error } = await requestAdminProducts('PUT', {
      id: productId,
      product: { ...productValues, image_url: finalPrimaryImageUrl, active: desiredActive },
    })

    if (error) {
      setSaving(false)
      setFeedback({ kind: 'error', text: error })
      return
    }

    const { error: variantError } = await supabase.rpc('save_product_variant_configuration', {
      p_product_id: productId,
      p_attributes: configuredAttributes,
      p_variants: configuredVariants,
    })

    if (variantError) {
      logClientError('Admin product variant save failed', variantError)
      setSaving(false)
      setFeedback({ kind: 'error', text: 'Les options du produit n’ont pas pu être enregistrées.' })
      return
    }

    const colorAttribute = configuredAttributes.find((attribute) => attribute.attribute_key === 'color')
    if (colorAttribute) {
      const { data: savedColorAttribute, error: colorError } = await supabase
        .from('product_attributes')
        .update({ attribute_colors: colorAttribute.attribute_colors })
        .eq('product_id', productId)
        .eq('attribute_key', 'color')
        .select('product_id')
        .maybeSingle()

      if (colorError || !savedColorAttribute) {
        if (colorError) logClientError('Admin product color save failed', colorError)
        setSaving(false)
        setFeedback({
          kind: 'error',
          text: 'Les options sont enregistrées, mais les couleurs n’ont pas pu être enregistrées.',
        })
        return
      }
    }

    let activationMessage = ''
    if (desiredActive && !hasImageUploadFailures) {
      const { error: activateError } = await requestAdminProducts('PATCH', {
        id: productId,
        action: 'set-active',
        active: true,
      })
      if (activateError) {
        setSaving(false)
        setFeedback({ kind: 'error', text: `Les modifications sont enregistrées, mais le produit n’a pas pu être publié : ${activateError}` })
        return
      }
    } else if (!publishable) {
      activationMessage = ' Ajoutez au moins 3 photos au total pour pouvoir publier ce produit. Il reste en brouillon.'
    }

    if (productId && form.origin === 'import') {
      const rawSupplier = form.supplierPurchasePrice.trim()
      const supplierPrice = rawSupplier === '' ? null : Number(rawSupplier)
      if (supplierPrice !== null && (!Number.isFinite(supplierPrice) || supplierPrice < 0)) {
        setSaving(false)
        setFeedback({ kind: 'error', text: 'Le prix d’achat fournisseur doit être un nombre positif ou vide.' })
        return
      }
      const supplierMutation = supplierPrice === null
        ? await supabase.from('product_costs').delete().eq('product_id', productId)
        : await supabase.from('product_costs').upsert({
            product_id: productId,
            purchase_price: supplierPrice,
            currency: form.supplierCurrency,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'product_id' })
      if (supplierMutation.error) {
        logClientError('Admin supplier cost save failed from product form', supplierMutation.error)
        setSaving(false)
        setFeedback({ kind: 'error', text: 'Le produit a été enregistré, mais le prix d’achat fournisseur n’a pas pu être enregistré.' })
        return
      }
    } else if (productId && form.origin === 'local') {
      await supabase.from('product_costs').delete().eq('product_id', productId)
    }

    if (hasImageUploadFailures) {
      setSaving(false)
      const failedNames = failedImageFiles.map((file) => `« ${file.name} »`).join(', ')
      const uploadMessage = `Le produit reste en brouillon. Échec de l’envoi pour ${failedNames}. Les autres photos et les informations du produit sont enregistrées; réessayez l’envoi des photos restantes.`
      setFeedback({ kind: 'error', text: uploadMessage })
      toast({ title: 'Certaines photos n’ont pas été envoyées', description: failedImageFiles.map((file) => file.name).join(', '), variant: 'danger' })
      return
    }

    toast({ title: editingId ? 'Produit modifié' : 'Produit enregistré', description: activationMessage.trim() || undefined, variant: 'success' })
    router.push('/admin/produits')
  }

  async function retryFailedImageUploads() {
    if (!editingId || imageFiles.length === 0 || saving) return
    setSaving(true)
    setFeedback(null)
    const result = await uploadProductImages(editingId, imageFiles)
    if (result.error) {
      setSaving(false)
      setUploadRetryAvailable(true)
      setFeedback({ kind: 'error', text: result.error })
      toast({ title: 'Nouvel envoi impossible', description: result.error, variant: 'danger' })
      return
    }

    await loadProductImages(editingId)
    setImageFiles(result.failedFiles)
    setImagePreviews([])
    setUploadRetryAvailable(result.failedFiles.length > 0)
    setSaving(false)
    if (result.failedFiles.length > 0) {
      const failedNames = result.failedFiles.map((file) => `« ${file.name} »`).join(', ')
      const uploadMessage = `Le produit reste en brouillon. Échec de l’envoi pour ${failedNames}. Réessayez l’envoi des photos restantes.`
      setFeedback({ kind: 'error', text: uploadMessage })
      toast({ title: 'Certaines photos n’ont pas été envoyées', description: result.failedFiles.map((file) => file.name).join(', '), variant: 'danger' })
      return
    }

    setFeedback({ kind: 'success', text: 'Toutes les photos restantes ont été ajoutées. Enregistrez le produit ou publiez-le lorsque les 3 photos minimum sont atteintes.' })
    toast({ title: 'Photos envoyées', description: 'Les photos enregistrées sont maintenant dans la galerie.', variant: 'success' })
  }

  async function unpublishProduct() {
    if (!editingId) return
    setUnpublishing(true)
    const { error } = await requestAdminProducts('PATCH', {
      id: editingId,
      action: 'set-active',
      active: false,
    })
    setUnpublishing(false)
    if (error) {
      logClientError('Admin product unpublish failed', error)
      setFeedback({ kind: 'error', text: error })
      toast({ title: 'Dépublication impossible', description: error, variant: 'danger' })
      return
    }

    setEditingActive(false)
    setConfirmUnpublish(false)
    toast({ title: 'Produit dépublié', variant: 'success' })
  }

  const loadProductImages = useCallback(async (productId: string) => {
    setExistingImagesLoading(true)
    const { data, error } = await supabase
      .from('product_images')
      .select('id, image_url, storage_path, display_order')
      .eq('product_id', productId)
      .order('display_order', { ascending: true })

    setExistingImagesLoading(false)
    if (error) {
      logClientError('Admin product images load failed', error)
      setFeedback({ kind: 'error', text: 'Impossible de charger les photos existantes de ce produit.' })
      return
    }

    const images = (data ?? []) as ExistingProductImage[]
    setExistingImages(images)
    setForm((current) => ({ ...current, imageUrl: images[0]?.image_url ?? current.imageUrl }))
  }, [])

  async function deleteExistingImage(image: ExistingProductImage) {
    if (!editingId) return
    if (!window.confirm('Supprimer cette photo ? Le fichier sera retir? du stockage.')) return

    setImageActionBusy(`delete-${image.id}`)
    const { error, data } = await requestAdminProductImages('DELETE', { id: editingId, imageId: image.id })
    setImageActionBusy(null)
    if (error) {
      setFeedback({ kind: 'error', text: error })
      return
    }

    const images = Array.isArray(data?.images) ? (data.images as ExistingProductImage[]) : []
    setExistingImages(images)
    setForm((current) => ({ ...current, imageUrl: images[0]?.image_url ?? '' }))
    setFeedback({ kind: 'success', text: 'Photo supprimée.' })
  }

  async function replaceExistingImage(image: ExistingProductImage, file: File) {
    if (!editingId) return
    if (file.size > 6 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setFeedback({ kind: 'error', text: 'Chaque photo doit ?tre au format JPG, PNG ou WebP et faire 6 Mo maximum.' })
      return
    }

    const { data: refreshedAuth, error: refreshError } = await supabase.auth.refreshSession()
    const refreshedUser = refreshedAuth.session?.user
    const refreshedRole = refreshedUser ? await getStaffRoleForUser(refreshedUser) : null
    if (refreshError || !canAccessAdminPath(refreshedRole, '/admin/produits')) {
      if (refreshError) logClientError('Admin access refresh failed', refreshError)
      setFeedback({ kind: 'error', text: 'Impossible de vérifier votre accès administrateur. Reconnectez-vous puis réessayez.' })
      return
    }

    setImageActionBusy(`replace-${image.id}`)
    const objectPath = `${editingId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`
    const { error: uploadError } = await supabase.storage.from('products').upload(objectPath, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: false,
    })
    if (uploadError) {
      logClientError('Admin product image replace upload failed', uploadError)
      setImageActionBusy(null)
      setFeedback({ kind: 'error', text: 'La nouvelle photo n’a pas pu être envoyée.' })
      return
    }

    const publicUrl = supabase.storage.from('products').getPublicUrl(objectPath).data.publicUrl
    const { error, data } = await requestAdminProductImages('PATCH', {
      id: editingId,
      action: 'replace',
      imageId: image.id,
      image_url: publicUrl,
      storage_path: objectPath,
    })
    setImageActionBusy(null)
    if (error) {
      await supabase.storage.from('products').remove([objectPath])
      setFeedback({ kind: 'error', text: error })
      return
    }

    const images = Array.isArray(data?.images) ? (data.images as ExistingProductImage[]) : []
    setExistingImages(images)
    setForm((current) => ({ ...current, imageUrl: images[0]?.image_url ?? '' }))
    setFeedback({ kind: 'success', text: 'Photo remplacée.' })
  }

  async function moveExistingImage(index: number, direction: -1 | 1) {
    if (!editingId) return
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= existingImages.length) return
    const ordered = [...existingImages]
    const [moved] = ordered.splice(index, 1)
    ordered.splice(targetIndex, 0, moved)

    setImageActionBusy(`move-${moved.id}`)
    const { error, data } = await requestAdminProductImages('PATCH', {
      id: editingId,
      action: 'reorder',
      orderedImageIds: ordered.map((img) => img.id),
    })
    setImageActionBusy(null)
    if (error) {
      setFeedback({ kind: 'error', text: error })
      return
    }

    const images = Array.isArray(data?.images) ? (data.images as ExistingProductImage[]) : ordered
    setExistingImages(images)
    setForm((current) => ({ ...current, imageUrl: images[0]?.image_url ?? '' }))
  }

  const loadProductVariantConfiguration = useCallback(async (productId: string) => {
    setVariantConfigLoading(true)
    const [{ data: attributes, error: attributesError }, { data: variants, error: variantsError }] = await Promise.all([
      supabase.from('product_attributes').select('attribute_key, attribute_values, attribute_colors').eq('product_id', productId),
      supabase.from('product_variants').select('attribute_values, stock, price_adjustment').eq('product_id', productId).eq('active', true),
    ])

    setVariantConfigLoading(false)
    if (attributesError || variantsError) {
      logClientError('Admin product variant load failed', attributesError ?? variantsError)
      setFeedback({ kind: 'error', text: 'Impossible de charger les options de ce produit.' })
      return
    }

    const configuredAttributes = attributes ?? []
    setSelectedAttributeKeys(configuredAttributes.map((attribute) => attribute.attribute_key))
    setAttributeValueInputs(Object.fromEntries(configuredAttributes.map((attribute) => [
      attribute.attribute_key,
      (attribute.attribute_values as string[]).join('\n'),
    ])))
    setAttributeColorInputs(Object.fromEntries(configuredAttributes.map((attribute) => [
      attribute.attribute_key,
      (attribute.attribute_colors ?? {}) as Record<string, string>,
    ])))
    setVariantDrafts(Object.fromEntries((variants ?? []).map((variant) => {
      const attributeValues = variant.attribute_values as Record<string, string>
      return [getVariantKey(attributeValues), {
        stock: variant.stock === null ? '' : String(variant.stock),
        priceAdjustment: String(variant.price_adjustment ?? 0),
      }]
    })))
  }, [])

  const populateProductForm = useCallback((product: Product, productId: string) => {
    setEditingActive(product.active)
    setImageFiles([])
    setImagePreviews([])
    setUploadRetryAvailable(false)
    setExistingImages([])
    setSelectedAttributeKeys([])
    setAttributeValueInputs({})
    setAttributeColorInputs({})
    setVariantDrafts({})
    setForm({
      name: product.name,
      description: product.description ?? '',
      price: String(product.price),
      deliveryEstimate: product.delivery_estimate ?? '',
      imageUrl: product.image_url ?? '',
      category: product.category ?? '',
      moq: String(product.moq ?? 1),
      stockStatus: product.stock_status ?? 'available',
      featured: product.featured ?? false,
      origin: product.origin ?? 'import',
      localStock: product.local_stock ? String(product.local_stock) : '',
      city: product.city ?? '',
      deliveryDelay: product.delivery_delay ?? '',
      partnerId: product.partner_id ?? '',
      importBasePrice: product.import_base_price != null ? String(product.import_base_price) : '',
      importBaseCurrency: product.import_base_currency === 'CNY' ? 'CNY' : 'FCFA',
      importWeightKg: product.import_weight_kg != null ? String(product.import_weight_kg) : '',
      importOtherFeesFcfa: product.import_other_fees_fcfa != null ? String(product.import_other_fees_fcfa) : '0',
      supplierPurchasePrice: product.supplier_cost?.purchase_price != null ? String(product.supplier_cost.purchase_price) : '',
      supplierCurrency: product.supplier_cost?.currency === 'CNY' ? 'CNY' : 'FCFA',
    })
    setFeedback(null)
    void loadProductVariantConfiguration(productId)
    void loadProductImages(productId)
  }, [loadProductImages, loadProductVariantConfiguration])

  useEffect(() => {
    if (sessionLoading) return
    let active = true
    void Promise.resolve().then(async () => {
      if (!active) return
      if (sessionError || !userId || !canAccessAdminPath(staffRole, '/admin/produits')) {
        setInitialLoading(false)
        return
      }

      setInitialLoading(true)
      setEditingId(productId ?? null)
      setProductLoadError('')
      setForm(emptyForm)
      setEditingActive(true)
      setImageFiles([])
      setImagePreviews([])
      setUploadRetryAvailable(false)
      setExistingImages([])
      setSelectedAttributeKeys([])
      setAttributeValueInputs({})
      setAttributeColorInputs({})
      setVariantDrafts({})

      async function loadProductById(id: string) {
        setProductLoadError('')
        const { data: product, error } = await supabase.from('products').select(PRODUCT_SELECT_COLUMNS).eq('id', id).maybeSingle()
        if (!active) return
        if (error) {
          logClientError('Admin product load failed', error)
          setProductLoadError('Impossible de charger ce produit. Vérifiez votre accès puis réessayez, ou retournez au catalogue.')
          return
        }
        if (!product) {
          setProductLoadError('Ce produit est introuvable. Retournez au catalogue pour choisir un autre produit.')
          return
        }

        let supplierCost: SupplierCost | null = null
        if (staffRole === 'owner' || staffRole === 'admin') {
          const { data: cost, error: costError } = await supabase
            .from('product_costs')
            .select('product_id, purchase_price, currency')
            .eq('product_id', id)
            .maybeSingle()
          if (!active) return
          if (costError) {
            logClientError('Admin product supplier cost load failed', costError)
            setProductLoadError('Impossible de charger les données du produit. Retournez au catalogue puis réessayez.')
            return
          }
          if (cost) {
            supplierCost = {
              purchase_price: cost.purchase_price == null ? null : Number(cost.purchase_price),
              currency: cost.currency === 'CNY' ? 'CNY' : cost.currency === 'FCFA' ? 'FCFA' : null,
            }
          }
        }

        populateProductForm({ ...product, supplier_cost: supplierCost } as Product, id)
      }

      const productRequest = productId ? loadProductById(productId) : Promise.resolve()
      await Promise.all([loadAppSettings(), loadPartnerOptions(), loadAttributeDefinitions(), productRequest])
      if (active) setInitialLoading(false)
    })
    return () => { active = false }
  }, [populateProductForm, productId, sessionError, sessionLoading, staffRole, userId])

  if (sessionLoading || initialLoading) {
    return <main className="admin-page" aria-busy="true"><div className="admin-shell"><Skeleton variant="rect" height={180} /><Skeleton variant="rect" height={420} /></div></main>
  }

    if (sessionError || !userId || !canAccessAdminPath(staffRole, '/admin/produits')) {
    const denied = Boolean(userId && staffRole)
    return (
      <main className="admin-page">
        <section className="admin-access-state">
          <span className="admin-access-icon" aria-hidden="true">⌁</span>
          <p className="eyebrow">ESPACE D’ADMINISTRATION</p>
          <h1>
            {sessionError
              ? 'Connexion momentanément indisponible'
              : !userId
              ? 'Connexion requise'
                : denied
                  ?'Accès refusé'
                  : 'Accès réservé'}
          </h1>
          <p>
            {sessionError
              ? sessionError
              : !userId
              ?'Connectez-vous avec un compte autorisé pour gérer le catalogue.'
                : denied
                  ?'Votre rôle ne permet pas d’accéder à cette page.'
                  : 'Ce compte ne dispose pas du rôle administrateur.'}
          </p>
          {!userId && <Link className="admin-primary-link" href="/login?next=%2Fadmin">Se connecter</Link>}
          {denied && staffRole === 'order_manager' && <Link className="admin-primary-link" href="/admin/commandes">Aller aux commandes</Link>}
          <Link className="admin-secondary-link" href="/">Retour au catalogue</Link>
        </section>
      </main>
    )
  }

  if (productId && productLoadError) {
    return <main className="admin-page"><section className="admin-access-state" role="alert"><h1>Produit indisponible</h1><p>{productLoadError}</p><Link className="admin-primary-link" href="/admin/produits">Retour au catalogue</Link></section></main>
  }

  const imagePreview = imagePreviews[0]?.url ?? existingImages[0]?.image_url ?? getPreviewUrl(form.imageUrl.trim())
  const totalImageCount = existingImages.length + (uploadRetryAvailable ? 0 : imageFiles.length)
  const canPublishWithImages = totalImageCount >= 3
  const configuredAttributes = selectedAttributeKeys.map((attributeKey) => ({
    key: attributeKey,
    label: attributeDefinitions.find((definition) => definition.attribute_key === attributeKey)?.label ?? attributeKey,
    values: parseAttributeValues(attributeValueInputs[attributeKey] ?? ''),
  }))
  const variantCombinations = buildVariantCombinations(configuredAttributes)

  return (
    <main className="admin-page">
      <div className="admin-shell">
        <PageHeader
          eyebrow="Catalogue produits"
          title={editingId ? 'Modifier le produit' : 'Nouveau produit'}
          description="Renseignez les informations, les prix, le stock, les variantes et les photos."
          actions={(
            <div className="admin-ui-product-header-actions">
              <Badge variant={editingId && editingActive ? 'success' : 'warning'}>
                {editingId && editingActive ? 'En ligne' : 'Brouillon'}
              </Badge>
              {editingId && !productId && (
                <Link className="admin-ui-product-edit-link" href={`/admin/produits/${encodeURIComponent(editingId)}`}>
                  Ouvrir la page d’édition permanente
                </Link>
              )}
            </div>
          )}
        />

        <form className="admin-product-form admin-ui-product-form" onSubmit={handleSubmit}>
          <section id="product-info" className="admin-ui-product-section">
            <Card title="Infos" description="Les informations générales présentées sur le catalogue.">
              <Input
                label="Nom du produit"
                autoComplete="off"
                maxLength={120}
                placeholder="Ex. Écouteurs sans fil"
                required
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
              <Textarea
                label="Description"
                maxLength={3000}
                placeholder="Décrivez les caractéristiques utiles du produit..."
                rows={4}
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
              <Select
                label="Catégorie"
                required
                value={form.category}
                onChange={(event) => setForm({ ...form, category: event.target.value })}
              >
                <option value="">Choisir une catégorie</option>
                {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
              </Select>
              <Input
                label="Délai de livraison estimé"
                maxLength={100}
                placeholder="Ex. 5 à 12 jours"
                value={form.deliveryEstimate}
                onChange={(event) => setForm({ ...form, deliveryEstimate: event.target.value })}
              />
              <Select
                label="Origine du produit"
                disabled={saving}
                value={form.origin}
                onChange={(event) => setForm({
                  ...form,
                  origin: event.target.value === 'local' ? 'local' : 'import',
                  partnerId: event.target.value === 'local' ? form.partnerId : '',
                })}
              >
                <option value="import">Import Chine</option>
                <option value="local">Disponible au Sénégal</option>
              </Select>
              <label className="featured-checkbox-row">
                <input
                  checked={form.featured}
                  onChange={(event) => setForm({ ...form, featured: event.target.checked })}
                  type="checkbox"
                />
                <span><strong>Mettre en produit vedette</strong><small>Ce produit apparaîtra en priorité sur l’accueil.</small></span>
              </label>
            </Card>
          </section>

          <section id="product-pricing" className="admin-ui-product-section">
            <Card title="Prix et coûts" description="Prix de vente et, pour les produits importés, les paramètres de calcul et le coût fournisseur.">
              <Input
                label="Prix de vente (FCFA)"
                inputMode="numeric"
                min="1"
                placeholder="25000"
                required
                type="number"
                value={form.price}
                onChange={(event) => setForm({ ...form, price: event.target.value })}
              />
              {form.origin === 'import' && (
                <div className="admin-local-stock-fields">
                  <h3 className="admin-ui-product-subheading">Calcul du prix importé</h3>
                  <Input
                    label="Prix de base produit"
                    hint="Avant transport, autres frais, dédouanement et commission."
                    disabled={saving}
                    min="0"
                    step="0.01"
                    type="number"
                    value={form.importBasePrice}
                    onChange={(event) => setForm({ ...form, importBasePrice: event.target.value })}
                    placeholder="Ex. 45"
                  />
                  <Select
                    label="Devise du prix de base"
                    disabled={saving}
                    value={form.importBaseCurrency}
                    onChange={(event) => setForm({ ...form, importBaseCurrency: event.target.value === 'CNY' ? 'CNY' : 'FCFA' })}
                  >
                    <option value="FCFA">FCFA</option>
                    <option value="CNY">Yuan (CNY)</option>
                  </Select>
                  <Input
                    label="Poids (kg)"
                    hint="Transport = poids × prix transport/kg (paramètres)."
                    disabled={saving}
                    min="0"
                    step="0.001"
                    type="number"
                    value={form.importWeightKg}
                    onChange={(event) => setForm({ ...form, importWeightKg: event.target.value })}
                    placeholder="Ex. 0.8"
                  />
                  <Input
                    label="Autres frais (FCFA)"
                    hint="Inclus dans la base avant dédouanement et commission."
                    disabled={saving}
                    min="0"
                    step="0.01"
                    type="number"
                    value={form.importOtherFeesFcfa}
                    onChange={(event) => setForm({ ...form, importOtherFeesFcfa: event.target.value })}
                    placeholder="0"
                  />
                  {(() => {
                    const previewPrice = getDisplayedUnitPrice({
                      origin: 'import',
                      price: Number(form.price) || 0,
                      import_base_price: form.importBasePrice.trim() === '' ? null : Number(form.importBasePrice),
                      import_base_currency: form.importBaseCurrency,
                      import_weight_kg: form.importWeightKg.trim() === '' ? null : Number(form.importWeightKg),
                      import_other_fees_fcfa: form.importOtherFeesFcfa.trim() === '' ? 0 : Number(form.importOtherFeesFcfa),
                    }, appSettings)
                    const missingRate = form.importBaseCurrency === 'CNY' && (appSettings.cny_to_fcfa_rate == null)
                    const dynamicReady = form.importBasePrice.trim() !== '' && form.importWeightKg.trim() !== '' && !missingRate
                    return (
                      <p className="admin-ui-product-price-preview">
                        <small>
                          Prix final calculé (aperçu, arrondi au multiple de 25 FCFA) : <strong>{previewPrice.toLocaleString('fr-FR')} FCFA</strong>
                          {!dynamicReady && ' — calcul dynamique non appliqué (données incomplètes ou taux CNY manquant), le prix enregistré du produit est utilisé.'}
                        </small>
                      </p>
                    )
                  })()}

                  <h3 className="admin-ui-product-subheading">Coût fournisseur</h3>
                  <Input
                    label="Prix d’achat fournisseur"
                    hint={<>Jamais affiché côté client. Enregistré dans <code>product_costs</code>.</>}
                    disabled={saving}
                    min="0"
                    step="0.01"
                    type="number"
                    value={form.supplierPurchasePrice}
                    onChange={(event) => setForm({ ...form, supplierPurchasePrice: event.target.value })}
                    placeholder="Laisser vide si non renseigné"
                  />
                  <Select
                    label="Devise du prix d’achat fournisseur"
                    disabled={saving}
                    value={form.supplierCurrency}
                    onChange={(event) => setForm({ ...form, supplierCurrency: event.target.value === 'CNY' ? 'CNY' : 'FCFA' })}
                  >
                    <option value="FCFA">FCFA</option>
                    <option value="CNY">Yuan (CNY)</option>
                  </Select>
                </div>
              )}

            </Card>
          </section>

          <section id="product-stock" className="admin-ui-product-section">
            <Card title="Stock" description="Gérez les quantités, la disponibilité et les informations du partenaire local.">
              {form.origin === 'local' && (
                <div className="admin-local-stock-fields">
                  <Input
                    label="Quantité en stock"
                    disabled={saving}
                    min="1"
                    required
                    step="1"
                    type="number"
                    value={form.localStock}
                    onChange={(event) => setForm({ ...form, localStock: event.target.value })}
                  />
                  <Input
                    label="Ville"
                    autoComplete="address-level2"
                    disabled={saving}
                    maxLength={100}
                    placeholder="Ex. Dakar"
                    required
                    value={form.city}
                    onChange={(event) => setForm({ ...form, city: event.target.value })}
                  />
                  <Input
                    label="Délai de livraison local"
                    disabled={saving}
                    maxLength={100}
                    placeholder="Ex. 24-72h"
                    required
                    value={form.deliveryDelay}
                    onChange={(event) => setForm({ ...form, deliveryDelay: event.target.value })}
                  />
                  <Select
                    label="Partenaire"
                    disabled={saving}
                    required
                    value={form.partnerId}
                    onChange={(event) => setForm({ ...form, partnerId: event.target.value })}
                  >
                    <option value="">Choisir un partenaire actif</option>
                    {partnerOptions.map((partner) => <option key={partner.id} value={partner.id}>{partner.name} · {partner.city}</option>)}
                  </Select>
                  {partnerOptions.length === 0 && <small>Aucun partenaire actif. Ajoutez-en depuis l’écran Partenaires.</small>}
                </div>
              )}
              <div className="admin-form-row">
                <label>
                  <span>Quantité minimale (MOQ)</span>
                  <QuantityInput
                    ariaLabel="Quantité minimale (MOQ)"
                    minimum={1}
                    required
                    value={form.moq}
                    onChange={(value) => setForm({ ...form, moq: value })}
                  />
                </label>
                <Select
                  label="Disponibilité"
                  value={form.stockStatus}
                  onChange={(event) => setForm({ ...form, stockStatus: event.target.value })}
                >
                  <option value="available">Disponible</option>
                  <option value="preorder">Sur commande</option>
                  <option value="out_of_stock">Indisponible</option>
                </Select>
              </div>
            </Card>
          </section>

          <section id="product-variants" className="admin-ui-product-section">
            <Card title="Variantes" description="Définissez les choix proposés et leurs stocks et ajustements de prix.">
              <section className="variant-editor" aria-labelledby="variant-editor-title">
                <div className="variant-editor-heading">
                  <h3 id="variant-editor-title">Variantes et stock</h3>
                  <p>Activez les caractéristiques vendues avec plusieurs choix. Sans attribut actif, la disponibilité générale reste utilisée.</p>
                </div>
                {variantConfigLoading ?(
                  <p role="status">Chargement des variantes...</p>
                ) : (
                  <>
                    <div className="variant-attribute-list">
                      {attributeDefinitions.map((definition) => (
                        <label className="featured-checkbox-row" key={definition.attribute_key}>
                          <input
                            checked={selectedAttributeKeys.includes(definition.attribute_key)}
                            disabled={saving}
                            onChange={(event) => setSelectedAttributeKeys((current) => (
                              event.target.checked
                                ? [...current, definition.attribute_key]
                                : current.filter((key) => key !== definition.attribute_key)
                            ))}
                            type="checkbox"
                          />
                          <span><strong>{definition.label}</strong></span>
                        </label>
                      ))}
                    </div>
                    {configuredAttributes.map((attribute) => (
                      <div className="variant-values-field" key={attribute.key}>
                        <Textarea
                          label={`Valeurs : ${attribute.label}`}
                          disabled={saving}
                          onChange={(event) => {
                            const nextValue = event.target.value
                            const nextValues = parseAttributeValues(nextValue)
                            setAttributeValueInputs((current) => ({ ...current, [attribute.key]: nextValue }))
                            if (attribute.key === 'color') {
                              setAttributeColorInputs((current) => ({
                                ...current,
                                color: Object.fromEntries(nextValues.map((value) => [value, current.color?.[value] ?? '#808080'])),
                              }))
                            }
                          }}
                          placeholder="Une valeur par ligne ou séparée par des virgules"
                          rows={3}
                          value={attributeValueInputs[attribute.key] ?? ''}
                        />
                        {attribute.key === 'color' && attribute.values.length > 0 && (
                          <div className="variant-color-editor-list">
                            {attribute.values.map((value) => (
                              <label className="variant-color-editor-row" key={value}>
                                <span><i style={{ backgroundColor: attributeColorInputs.color?.[value] ?? '#808080' }} />{value}</span>
                                <input
                                  aria-label={`Couleur ${value}`}
                                  disabled={saving}
                                  type="color"
                                  value={attributeColorInputs.color?.[value] ?? '#808080'}
                                  onChange={(event) => setAttributeColorInputs((current) => ({
                                    ...current,
                                    color: { ...current.color, [value]: event.target.value },
                                  }))}
                                />
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                    {selectedAttributeKeys.length === 0 ?(
                      <p className="variant-editor-note">Aucune variante : le produit utilise son statut général Disponible / Indisponible.</p>
                    ) : variantCombinations.length === 0 ?(
                      <p className="variant-editor-note">Ajoutez des valeurs pour chaque attribut afin de générer les combinaisons.</p>
                    ) : (
                      <div className="variant-table-wrap">
                        <table className="variant-table">
                          <thead>
                            <tr><th>Combinaison</th><th>Stock (vide = illimité)</th><th>Ajustement du prix (FCFA)</th></tr>
                          </thead>
                          <tbody>
                            {variantCombinations.map((attributeValues) => {
                              const key = getVariantKey(attributeValues)
                              const draft = variantDrafts[key] ?? { stock: '', priceAdjustment: '0' }
                              return (
                                <tr key={key}>
                                  <th scope="row">{configuredAttributes.map((attribute) => `${attribute.label} : ${attributeValues[attribute.key]}`).join(' · ')}</th>
                                  <td><input aria-label={`Stock ${key}`} disabled={saving} min="0" step="1" type="number" value={draft.stock} onChange={(event) => updateVariantDraft(attributeValues, 'stock', event.target.value)} /></td>
                                  <td><input aria-label={`Ajustement de prix ${key}`} disabled={saving} step="any" type="number" value={draft.priceAdjustment} onChange={(event) => updateVariantDraft(attributeValues, 'priceAdjustment', event.target.value)} /></td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </section>
            </Card>
          </section>

          <section id="product-photos" className="admin-ui-product-section">
            <Card
              title="Photos"
              description="JPG, PNG ou WebP, 6 Mo maximum par fichier. Les photos peuvent être réordonnées."
              actions={<Badge variant={canPublishWithImages ? 'success' : 'warning'}>{totalImageCount} / 3 photos</Badge>}
            >
              <p className="admin-ui-product-photo-validation" role="status">
                {canPublishWithImages
                  ? 'Au moins 3 photos sont prêtes pour la publication.'
                  : `Ajoutez ${3 - totalImageCount} photo(s) pour pouvoir publier. Le produit restera en brouillon.`}
              </p>

              {editingId && (
                  <div className="admin-existing-images">
                    <h4>Photos enregistrées</h4>
                    {existingImagesLoading ? (
                      <p role="status">Chargement des photos existantes...</p>
                    ) : existingImages.length === 0 ? (
                      <p>Aucune photo enregistrée pour ce produit.</p>
                    ) : (
                      <ul className="admin-existing-image-list">
                        {existingImages.map((image, index) => (
                          <li key={image.id} className="admin-existing-image-item">
                            <div className="admin-existing-image-preview">
                              <Image src={image.image_url} alt={`Photo ${index + 1}`} fill sizes="96px" unoptimized />
                              {index === 0 && <span className="admin-image-badge">Principale</span>}
                            </div>
                            <div className="admin-existing-image-actions">
                              <Button
                                size="sm"
                                variant="outline"
                                type="button"
                                disabled={imageActionBusy !== null || index === 0}
                                onClick={() => void moveExistingImage(index, -1)}
                              >Monter</Button>
                              <Button
                                size="sm"
                                variant="outline"
                                type="button"
                                disabled={imageActionBusy !== null || index === existingImages.length - 1}
                                onClick={() => void moveExistingImage(index, 1)}
                              >Descendre</Button>
                              <label className="admin-image-replace">
                                <input
                                  accept="image/jpeg,image/png,image/webp"
                                  disabled={imageActionBusy !== null}
                                  type="file"
                                  onChange={(event) => {
                                    const file = event.currentTarget.files?.[0]
                                    event.currentTarget.value = ''
                                    if (file) void replaceExistingImage(image, file)
                                  }}
                                />
                                <span>{imageActionBusy === `replace-${image.id}` ? 'Remplacement...' : 'Remplacer'}</span>
                              </label>
                              <Button
                                size="sm"
                                variant="danger"
                                type="button"
                                disabled={imageActionBusy !== null}
                                onClick={() => void deleteExistingImage(image)}
                              >{imageActionBusy === `delete-${image.id}` ? 'Suppression...' : 'Supprimer'}</Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
              )}

              <Input
                label={editingId ? 'Ajouter de nouvelles photos' : 'Photos du produit'}
                accept="image/jpeg,image/png,image/webp"
                hint={`JPG, PNG ou WebP, 6 Mo maximum chacune. ${imageFiles.length} nouvelle(s) sélectionnée(s). Les nouvelles photos seront ajoutées à la suite, sans dupliquer les photos existantes.`}
                multiple
                onChange={(event) => {
                  const files = Array.from(event.currentTarget.files ?? [])
                  if (files.some((file) => file.size > 6 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) {
                    setFeedback({ kind: 'error', text: 'Chaque photo doit ?tre au format JPG, PNG ou WebP et faire 6 Mo maximum.' })
                    event.currentTarget.value = ''
                    return
                  }
                  setImagePreviews([])
                  setImageFiles(files)
                  setUploadRetryAvailable(false)
                  if (!editingId && files.length > 0 && files.length < 3) {
                    setFeedback({ kind: 'error', text: 'Produit enregistré en brouillon : ajoutez au moins 3 photos au total pour pouvoir le publier.' })
                  } else {
                    setFeedback(null)
                  }
                }}
                type="file"
              />
              {uploadRetryAvailable && editingId && (
                <Button
                  type="button"
                  variant="outline"
                  loading={saving}
                  disabled={imageActionBusy !== null}
                  onClick={() => void retryFailedImageUploads()}
                >
                  Réessayer l’envoi des photos restantes ({imageFiles.length})
                </Button>
              )}

              <Input
                label="URL publique de secours (ne compte pas comme photo enregistrée pour la publication)"
                autoComplete="url"
                placeholder="https://... (facultatif)"
                type="url"
                value={form.imageUrl}
                onChange={(event) => setForm({ ...form, imageUrl: event.target.value })}
                hint="La publication nécessite au moins 3 photos enregistrées en base (product_images). Une URL de secours seule ne suffit pas."
              />

              <div className="admin-preview-row">
                <div className="admin-image-preview">
                  {imagePreview ? (
                    <Image src={imagePreview} alt="Aperçu du produit" fill sizes="104px" unoptimized />
                  ) : (
                    <span aria-hidden="true">Photo</span>
                  )}
                </div>
                <div className="admin-preview-copy">
                  <span>Aperçu catalogue</span>
                  <strong>{form.name.trim() || 'Nom du produit'}</strong>
                  <b>{Number(form.price || 0).toLocaleString('fr-FR')} FCFA</b>
                  <small>{canPublishWithImages ? 'Prêt à publier (3 photos ou plus)' : 'Brouillon tant que le total est inférieur à 3 photos'}</small>
                </div>
              </div>
              {imagePreviews.length > 0 && (
                <div className="admin-image-preview-grid" aria-label="Aperçu des nouvelles photos sélectionnées">
                  {imagePreviews.map((preview, index) => (
                    <div className="admin-gallery-preview" key={`${preview.file.name}-${index}`}>
                      <Image src={preview.url} alt={`Nouvelle photo ${index + 1}`} fill sizes="80px" unoptimized />
                      <span>{index + 1}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </section>

          {feedback && (
            <p className={`admin-feedback ${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>
              {feedback.text}
            </p>
          )}

          <footer className="admin-ui-product-savebar">
            <div className="admin-ui-product-savecopy">
              <strong>{editingId ? 'Modifications du produit' : 'Nouveau produit'}</strong>
              <span>{canPublishWithImages ? '3 photos minimum atteintes' : `Encore ${3 - totalImageCount} photo(s) pour publier`}</span>
            </div>
            <div className="admin-ui-product-saveactions">
              {editingId && editingActive ? (
                <>
                  <Button
                    type="submit"
                    value="save"
                    variant="outline"
                    loading={saving}
                    disabled={imageActionBusy !== null || existingImagesLoading}
                  >
                    Enregistrer les modifications
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    disabled={saving || imageActionBusy !== null}
                    onClick={() => setConfirmUnpublish(true)}
                  >
                    Dépublier
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="submit"
                    value="draft"
                    variant="outline"
                    loading={saving}
                    disabled={imageActionBusy !== null || existingImagesLoading}
                  >
                    Enregistrer en brouillon
                  </Button>
                  <Button
                    type="submit"
                    value="publish"
                    loading={saving}
                    disabled={!canPublishWithImages || imageActionBusy !== null || existingImagesLoading}
                  >
                    Publier le produit
                  </Button>
                </>
              )}
              {editingId && (
                <Button type="button" variant="ghost" disabled={saving} onClick={() => router.push('/admin/produits')}>
                  Retour à la liste
                </Button>
              )}
            </div>
          </footer>
        </form>

        <ConfirmDialog
          open={confirmUnpublish}
          onClose={() => {
            if (!unpublishing) setConfirmUnpublish(false)
          }}
          onConfirm={() => void unpublishProduct()}
          title="Dépublier ce produit ?"
          description="Le produit sera masqué du catalogue public. Ses données et ses photos seront conservées."
          confirmLabel="Dépublier"
          loading={unpublishing}
        />
      </div>
    </main>
  )
}
