'use client'

import Image from 'next/image'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { canAccessAdminPath, getStaffRoleForUser, type StaffRole } from '../../lib/admin-staff-client'
import { isLocalStockWarning } from '../../lib/product-origin'
import { getAuthErrorMessage, logClientError } from '../../lib/user-facing-errors'
import { DEFAULT_APP_PRICING_SETTINGS, getDisplayedUnitPrice, normalizeAppPricingSettings, type AppPricingSettings } from '../../lib/imported-product-pricing'
import QuantityInput from '../ui/quantity-input'

type SupplierCost = {
  purchase_price: number | null
  currency: 'FCFA' | 'CNY' | null
}

type Product = {
  id: string | number
  name: string
  description: string
  price: number
  delivery_estimate: string | null
  image_url: string | null
  category: string | null
  moq: number
  stock_status: string
  active: boolean
  featured: boolean
  origin: 'local' | 'import'
  local_stock: number
  city: string | null
  delivery_delay: string | null
  stock_updated_at: string | null
  partner_id: string | null
  import_base_price: number | null
  import_base_currency: 'FCFA' | 'CNY' | null
  import_weight_kg: number | null
  import_other_fees_fcfa: number
  supplier_cost?: SupplierCost | null
}

type AccessState = 'checking' | 'signed-out' | 'not-admin' | 'denied' | 'auth-error' | 'ready'
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

async function requestAdminProducts(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body: Record<string, unknown>) {
  try {
    const { data, error } = await supabase.auth.getSession()
    if (error) {
      logClientError('Admin product session read failed', error)
      return { error: 'Impossible de vérifier votre session administrateur. Reconnectez-vous puis réessayez.', data: null }
    }

    const accessToken = data.session?.access_token
    if (!accessToken) return { error: 'Votre session a expiré. Reconnectez-vous puis réessayez.', data: null }

    const response = await fetch('/api/admin/products', {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    let result: unknown
    try {
      result = await response.json()
    } catch (error) {
      logClientError('Admin product API response parsing failed', error)
      return { error: 'La réponse du serveur est invalide. Réessayez.', data: null }
    }

    if (!response.ok) {
      const message = typeof result === 'object' && result !== null && 'error' in result && typeof result.error === 'string'
        ? result.error
        : 'La modification du produit n’a pas pu être enregistrée.'
      return { error: message, data: null }
    }

    return { error: null, data: result as Record<string, unknown> | null }
  } catch (error) {
    logClientError('Admin product API request failed', error)
    return { error: 'Le serveur est momentanément inaccessible. Vérifiez votre connexion puis réessayez.', data: null }
  }
}

async function requestAdminProductImages(method: 'PATCH' | 'DELETE', body: Record<string, unknown>) {
  try {
    const { data, error } = await supabase.auth.getSession()
    if (error) {
      logClientError('Admin product image session read failed', error)
      return { error: 'Impossible de vérifier votre session administrateur. Reconnectez-vous puis réessayez.', data: null }
    }

    const accessToken = data.session?.access_token
    if (!accessToken) return { error: 'Votre session a expiré. Reconnectez-vous puis réessayez.', data: null }

    const response = await fetch('/api/admin/products/images', {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    let result: unknown
    try {
      result = await response.json()
    } catch (error) {
      logClientError('Admin product image API response parsing failed', error)
      return { error: 'La réponse du serveur est invalide. Réessayez.', data: null }
    }

    if (!response.ok) {
      const message = typeof result === 'object' && result !== null && 'error' in result && typeof result.error === 'string'
        ? result.error
        : 'La modification de l’image n’a pas pu être enregistrée.'
      return { error: message, data: null }
    }

    return { error: null, data: result as Record<string, unknown> | null }
  } catch (error) {
    logClientError('Admin product image API request failed', error)
    return { error: 'Le serveur est momentanément inaccessible. Vérifiez votre connexion puis réessayez.', data: null }
  }
}

function formatStockUpdatedAt(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Jamais'
  return new Date(value).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}

async function removeCreatedProduct(productId: string) {
  const { error } = await requestAdminProducts('DELETE', { id: productId })
  if (error) logClientError('Admin product draft cleanup failed', error)
}

export default function AdminPage() {
  const [access, setAccess] = useState<AccessState>('checking')
  const [adminEmail, setAdminEmail] = useState('')
  const [staffRole, setStaffRole] = useState<StaffRole | null>(null)
  const [authError, setAuthError] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [partnerOptions, setPartnerOptions] = useState<PartnerOption[]>([])
  const [appSettings, setAppSettings] = useState<AppPricingSettings>(DEFAULT_APP_PRICING_SETTINGS)
  const [supplierCostDrafts, setSupplierCostDrafts] = useState<Record<string, { price: string; currency: 'FCFA' | 'CNY' }>>({})
  const [savingSupplierCostId, setSavingSupplierCostId] = useState<string | null>(null)
  const [productsError, setProductsError] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [productFilter, setProductFilter] = useState<'all' | 'active' | 'hidden' | 'import_missing_purchase'>('all')
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingActive, setEditingActive] = useState(true)
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [imagePreviews, setImagePreviews] = useState<{ file: File; url: string }[]>([])
  const [existingImages, setExistingImages] = useState<ExistingProductImage[]>([])
  const [existingImagesLoading, setExistingImagesLoading] = useState(false)
  const [imageActionBusy, setImageActionBusy] = useState<string | null>(null)
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [categoryOptions, setCategoryOptions] = useState<string[]>([])
  const [attributeDefinitions, setAttributeDefinitions] = useState<AttributeDefinition[]>([])
  const [selectedAttributeKeys, setSelectedAttributeKeys] = useState<string[]>([])
  const [attributeValueInputs, setAttributeValueInputs] = useState<Record<string, string>>({})
  const [attributeColorInputs, setAttributeColorInputs] = useState<Record<string, Record<string, string>>>({})
  const [variantDrafts, setVariantDrafts] = useState<Record<string, VariantDraft>>({})
  const [variantConfigLoading, setVariantConfigLoading] = useState(false)
  const [stockQuantities, setStockQuantities] = useState<Record<string, string>>({})
  const [confirmingStockId, setConfirmingStockId] = useState<string | null>(null)
  const [newProductRequestCount, setNewProductRequestCount] = useState(0)

  async function loadAppSettings() {
    const { data, error } = await supabase
      .from('app_settings')
      .select('transport_price_per_kg_fcfa, commission_percent, customs_percent, cny_to_fcfa_rate')
      .eq('id', 1)
      .maybeSingle()
    if (!error) setAppSettings(normalizeAppPricingSettings(data as Partial<AppPricingSettings> | null))
  }

  async function loadProducts() {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, description, price, delivery_estimate, image_url, category, moq, stock_status, active, featured, origin, local_stock, city, delivery_delay, stock_updated_at, partner_id, import_base_price, import_base_currency, import_weight_kg, import_other_fees_fcfa')
      .order('name')

    if (error) {
      logClientError('Admin product list load failed', error)
      setProductsError('Impossible de charger le catalogue pour le moment.')
      return
    }

    const rows = (data ?? []) as Product[]
    const ids = rows.map((p) => String(p.id))
    let costsByProductId: Record<string, SupplierCost> = {}
    if (ids.length > 0) {
      const { data: costs, error: costsError } = await supabase
        .from('product_costs')
        .select('product_id, purchase_price, currency')
        .in('product_id', ids)
      if (costsError) {
        logClientError('Admin supplier costs load failed', costsError)
      } else {
        costsByProductId = Object.fromEntries((costs ?? []).map((c) => [String(c.product_id), {
          purchase_price: c.purchase_price == null ? null : Number(c.purchase_price),
          currency: c.currency === 'CNY' ? 'CNY' : c.currency === 'FCFA' ? 'FCFA' : null,
        }]))
      }
    }

    const merged = rows.map((p) => ({ ...p, supplier_cost: costsByProductId[String(p.id)] ?? null }))
    setProductsError('')
    setProducts(merged)
    setSupplierCostDrafts((current) => {
      const next = { ...current }
      for (const p of merged) {
        const pid = String(p.id)
        if (!next[pid]) {
          next[pid] = {
            price: p.supplier_cost?.purchase_price != null ? String(p.supplier_cost.purchase_price) : '',
            currency: p.supplier_cost?.currency ?? 'FCFA',
          }
        }
      }
      return next
    })
  }

  async function saveSupplierCost(productId: string) {
    const draft = supplierCostDrafts[productId] ?? { price: '', currency: 'FCFA' as const }
    const raw = draft.price.trim()
    const price = raw === '' ? null : Number(raw)
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      setFeedback({ kind: 'error', text: 'Le prix d’achat fournisseur doit être un nombre positif ou vide.' })
      return
    }
    const currency = price === null ? null : draft.currency
    setSavingSupplierCostId(productId)
    setFeedback(null)
    try {
      if (price === null) {
        const { error } = await supabase.from('product_costs').delete().eq('product_id', productId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('product_costs').upsert({
          product_id: productId,
          purchase_price: price,
          currency,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'product_id' })
        if (error) throw error
      }
      await loadProducts()
      setFeedback({ kind: 'success', text: 'Prix d’achat fournisseur enregistré.' })
    } catch (error) {
      logClientError('Admin supplier cost save failed', error)
      setFeedback({ kind: 'error', text: 'Le prix d’achat fournisseur n’a pas pu être enregistré.' })
    } finally {
      setSavingSupplierCostId(null)
    }
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
    let mounted = true

    async function checkAccess() {
      const { data, error } = await supabase.auth.getUser()

      if (!mounted) return

      if (error?.name === 'AuthSessionMissingError') {
        setAccess('signed-out')
        return
      }

      if (error) {
        setAuthError(getAuthErrorMessage(error))
        setAccess('auth-error')
        return
      }

      if (!data.user) {
        setAccess('signed-out')
        return
      }

      setAdminEmail(data.user.email ?? '')
      const role = await getStaffRoleForUser(data.user)
      if (!mounted) return
      setStaffRole(role)

      if (!canAccessAdminPath(role, '/admin')) {
        setAccess(role ? 'denied' : 'not-admin')
        return
      }

      setAccess('ready')
      void loadAppSettings()
      void loadProducts()
      void loadPartnerOptions()
      void loadAttributeDefinitions()
      if (role === 'owner' || role === 'admin') {
        void (async () => {
          const { data: sessionData } = await supabase.auth.getSession()
          const token = sessionData.session?.access_token
          if (!token) return
          try {
            const response = await fetch('/api/admin/product-requests?mode=count', {
              headers: { Authorization: `Bearer ${token}` },
              cache: 'no-store',
            })
            if (!response.ok) return
            const body = await response.json() as { newCount?: number }
            if (mounted && typeof body.newCount === 'number') {
              setNewProductRequestCount(body.newCount)
            }
          } catch {
            // ignore badge count errors
          }
        })()
      }
    }

    void checkAccess()
    return () => {
      mounted = false
    }
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFeedback(null)

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
    const publishable = totalImages >= 3

    if (!editingId && imageFiles.length === 0) {
      setFeedback({ kind: 'error', text: 'Ajoutez au moins une photo pour créer ce produit (1 ou 2 photos : brouillon, 3 ou plus : publication possible).' })
      return
    }

    if (editingId && totalImages === 0 && !fallbackImageUrl) {
      setFeedback({ kind: 'error', text: 'Ajoutez au moins une photo ou conservez une image existante.' })
      return
    }

    const { data: refreshedAuth, error: refreshError } = await supabase.auth.refreshSession()
    const refreshedUser = refreshedAuth.session?.user
    const refreshedRole = refreshedUser ? await getStaffRoleForUser(refreshedUser) : null
    if (refreshError || !canAccessAdminPath(refreshedRole, '/admin')) {
      if (refreshError) logClientError('Admin access refresh failed', refreshError)
      setFeedback({
        kind: 'error',
        text: 'Impossible de vérifier votre accès administrateur. Reconnectez-vous puis réessayez.',
      })
      return
    }

    setSaving(true)
    let productId = editingId
    let createdProduct = false
    const uploadedPaths: string[] = []

    const baseImageUrl = editingId
      ? (existingImages[0]?.image_url ?? fallbackImageUrl ?? null)
      : (fallbackImageUrl ?? null)
    const desiredActive = editingId ? (editingActive && publishable) : publishable
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
      createdProduct = true
    }

    let primaryImageUrl = baseImageUrl
    if (imageFiles.length > 0) {
      const { data: existingRows, error: existingRowsError } = await supabase
        .from('product_images')
        .select('display_order')
        .eq('product_id', productId)
        .order('display_order', { ascending: false })
        .limit(1)
      if (existingRowsError) {
        logClientError('Admin product image order lookup failed', existingRowsError)
        if (createdProduct) await removeCreatedProduct(productId)
        setSaving(false)
        setFeedback({ kind: 'error', text: 'Impossible de préparer l’ajout des photos. Réessayez.' })
        return
      }
      const firstOrder = (existingRows?.[0]?.display_order ?? -1) + 1
      const galleryRows: { product_id: string; image_url: string; storage_path: string; display_order: number }[] = []

      for (const [index, file] of imageFiles.entries()) {
        const objectPath = `${productId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`
        const { error: uploadError } = await supabase.storage.from('products').upload(objectPath, file, {
          cacheControl: '3600',
          contentType: file.type,
          upsert: false,
        })

        if (uploadError) {
          logClientError('Admin product image upload failed', uploadError)
          if (uploadedPaths.length) await supabase.storage.from('products').remove(uploadedPaths)
          if (createdProduct) await removeCreatedProduct(productId)
          setSaving(false)
          setFeedback({ kind: 'error', text: `La photo ${index + 1}/${imageFiles.length} n’a pas pu être envoyée. Vérifiez votre accès administrateur et réessayez.` })
          return
        }

        uploadedPaths.push(objectPath)
        const publicUrl = supabase.storage.from('products').getPublicUrl(objectPath).data.publicUrl
        if (existingImages.length === 0 && index === 0) primaryImageUrl = publicUrl
        galleryRows.push({
          product_id: productId,
          image_url: publicUrl,
          storage_path: objectPath,
          display_order: firstOrder + index,
        })
      }

      const { error: galleryError } = await supabase.from('product_images').insert(galleryRows)
      if (galleryError) {
        logClientError('Admin product gallery save failed', galleryError)
        await supabase.storage.from('products').remove(uploadedPaths)
        if (createdProduct) await removeCreatedProduct(productId)
        setSaving(false)
        setFeedback({ kind: 'error', text: 'Les photos ont été envoyées, mais elles n’ont pas pu être ajoutées au produit.' })
        return
      }
    }

    const finalPrimaryImageUrl = existingImages[0]?.image_url ?? primaryImageUrl ?? null
    const { error } = await requestAdminProducts('PUT', {
      id: productId,
      product: { ...productValues, image_url: finalPrimaryImageUrl, active: desiredActive },
    })

    if (error) {
      setSaving(false)
      if (uploadedPaths.length) await supabase.storage.from('products').remove(uploadedPaths)
      if (createdProduct) await removeCreatedProduct(productId)
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
      if (createdProduct) {
        if (uploadedPaths.length) await supabase.storage.from('products').remove(uploadedPaths)
        await removeCreatedProduct(productId)
      }
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
        if (createdProduct) {
          if (uploadedPaths.length) await supabase.storage.from('products').remove(uploadedPaths)
          await removeCreatedProduct(productId)
        }
        setFeedback({
          kind: 'error',
          text: 'Les options sont enregistrées, mais les couleurs n’ont pas pu être enregistrées.',
        })
        return
      }
    }

    let activationMessage = ''
    if (desiredActive) {
      const { error: activateError } = await requestAdminProducts('PATCH', {
        id: productId,
        action: 'set-active',
        active: true,
      })
      if (activateError) {
        setSaving(false)
        setFeedback({ kind: 'error', text: `Les modifications sont enregistrées, mais le produit n’a pas pu être publié : ${activateError}` })
        await loadProducts()
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
        await loadProducts()
        return
      }
    } else if (productId && form.origin === 'local') {
      await supabase.from('product_costs').delete().eq('product_id', productId)
    }

    setSaving(false)
    setForm(emptyForm)
    setImageFiles([])
    setImagePreviews([])
    setExistingImages([])
    setEditingId(null)
    setEditingActive(true)
    setSelectedAttributeKeys([])
    setAttributeValueInputs({})
    setAttributeColorInputs({})
    setVariantDrafts({})
    setFeedback({
      kind: publishable ? 'success' : 'success',
      text: (editingId ? 'Produit modifi?.' : 'Produit enregistr?.') + activationMessage,
    })
    await loadProducts()
  }

  async function loadProductImages(productId: string) {
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
  }

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
    await loadProducts()
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
    if (refreshError || !canAccessAdminPath(refreshedRole, '/admin')) {
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
    await loadProducts()
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
    await loadProducts()
  }

  function editProduct(product: Product) {
    const productId = String(product.id)
    setEditingId(productId)
    setEditingActive(product.active)
    setImageFiles([])
    setImagePreviews([])
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
      importBaseCurrency: (product.import_base_currency === 'CNY' ? 'CNY' : 'FCFA'),
      importWeightKg: product.import_weight_kg != null ? String(product.import_weight_kg) : '',
      importOtherFeesFcfa: product.import_other_fees_fcfa != null ? String(product.import_other_fees_fcfa) : '0',
      supplierPurchasePrice: product.supplier_cost?.purchase_price != null ? String(product.supplier_cost.purchase_price) : '',
      supplierCurrency: product.supplier_cost?.currency === 'CNY' ? 'CNY' : 'FCFA',
    })
    setFeedback(null)
    void loadProductVariantConfiguration(productId)
    void loadProductImages(productId)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function loadProductVariantConfiguration(productId: string) {
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
  }

  async function toggleProduct(product: Product) {
    const { error } = await requestAdminProducts('PATCH', {
      id: product.id,
      action: 'set-active',
      active: !product.active,
    })
    if (error) {
      setFeedback({ kind: 'error', text: error })
      return
    }
    if (editingId === String(product.id)) {
      setEditingId(null)
      setEditingActive(true)
      setForm(emptyForm)
      setImageFiles([])
      setImagePreviews([])
      setExistingImages([])
      setSelectedAttributeKeys([])
      setAttributeValueInputs({})
      setAttributeColorInputs({})
      setVariantDrafts({})
    }
    await loadProducts()
  }

  async function deleteProduct(product: Product) {
    const confirmed = window.confirm(
      `Supprimer « ${product.name} » ?\n\nSi le produit est lié à des commandes, il sera archivé (masqué) sans effacer l’historique. S’il n’a jamais été commandé, il sera supprimé définitivement avec ses photos et ses coûts.`,
    )
    if (!confirmed) return

    setDeletingProductId(String(product.id))
    const { error, data } = await requestAdminProducts('DELETE', { id: product.id })
    setDeletingProductId(null)
    if (error) {
      setFeedback({ kind: 'error', text: error })
      return
    }

    if (editingId === String(product.id)) {
      setEditingId(null)
      setEditingActive(true)
      setForm(emptyForm)
      setImageFiles([])
      setImagePreviews([])
      setExistingImages([])
      setSelectedAttributeKeys([])
      setAttributeValueInputs({})
      setAttributeColorInputs({})
      setVariantDrafts({})
    }

    if (data?.archived) {
      setFeedback({ kind: 'success', text: `Produit archivé : « ${product.name} » reste masqué car il est lié à des commandes.` })
    } else {
      setFeedback({ kind: 'success', text: `Produit supprimé : « ${product.name} » a été retiré avec ses photos et ses coûts.` })
    }
    await loadProducts()
  }

  async function confirmLocalStock(product: Product) {
    const localStock = Number(stockQuantities[String(product.id)] ?? product.local_stock)
    if (!Number.isInteger(localStock) || localStock <= 0) {
      setFeedback({ kind: 'error', text: 'La quantité en stock doit être un entier supérieur à zéro.' })
      return
    }

    setConfirmingStockId(String(product.id))
    const { error } = await requestAdminProducts('PATCH', {
      id: product.id,
      action: 'confirm-stock',
      localStock,
    })
    setConfirmingStockId(null)

    if (error) {
      setFeedback({ kind: 'error', text: error })
      return
    }

    setFeedback({ kind: 'success', text: `Stock confirmé pour ${product.name}.` })
    await loadProducts()
  }

  async function signOut() {
    await supabase.auth.signOut()
    setAccess('signed-out')
  }

  if (access === 'checking') {
    return <main className="admin-page"><div className="admin-state">Vérification de l’accès...</div></main>
  }

  if (access !== 'ready') {
    return (
      <main className="admin-page">
        <section className="admin-access-state">
          <span className="admin-access-icon" aria-hidden="true">⌁</span>
          <p className="eyebrow">ESPACE D’ADMINISTRATION</p>
          <h1>
            {access === 'signed-out'
              ? 'Connexion requise'
              : access === 'auth-error'
                ?'Connexion momentanément indisponible'
                : access === 'denied'
                  ?'Accès refusé'
                  : 'Accès réservé'}
          </h1>
          <p>
            {access === 'signed-out'
              ?'Connectez-vous avec un compte autorisé pour gérer le catalogue.'
              : access === 'auth-error'
                ?authError
                : access === 'denied'
                  ?'Votre rôle ne permet pas d’accéder à cette page.'
                  : 'Ce compte ne dispose pas du rôle administrateur.'}
          </p>
          {access === 'signed-out' && <Link className="admin-primary-link" href="/login?next=%2Fadmin">Se connecter</Link>}
          {access === 'denied' && staffRole === 'order_manager' && <Link className="admin-primary-link" href="/admin/commandes">Aller aux commandes</Link>}
          <Link className="admin-secondary-link" href="/">Retour au catalogue</Link>
        </section>
      </main>
    )
  }

  const imagePreview = imagePreviews[0]?.url ?? existingImages[0]?.image_url ?? getPreviewUrl(form.imageUrl.trim())
  const totalImageCount = existingImages.length + imageFiles.length
  const canPublishWithImages = totalImageCount >= 3
  const activeProducts = products.filter((product) => product.active).length
  const hiddenProducts = products.length - activeProducts
  const importedMissingPurchaseCount = products.filter((product) => product.origin === 'import' && (product.supplier_cost?.purchase_price == null)).length
  const visibleProducts = products.filter((product) => {
    const matchesSearch = `${product.name} ${product.category ?? ''}`.toLocaleLowerCase().includes(productSearch.trim().toLocaleLowerCase())
    const matchesFilter = productFilter === 'all'
      || (productFilter === 'active' ? product.active : false)
      || (productFilter === 'hidden' ? !product.active : false)
      || (productFilter === 'import_missing_purchase' ? (product.origin === 'import' && product.supplier_cost?.purchase_price == null) : false)
    return matchesSearch && matchesFilter
  })
  const configuredAttributes = selectedAttributeKeys.map((attributeKey) => ({
    key: attributeKey,
    label: attributeDefinitions.find((definition) => definition.attribute_key === attributeKey)?.label ?? attributeKey,
    values: parseAttributeValues(attributeValueInputs[attributeKey] ?? ''),
  }))
  const variantCombinations = buildVariantCombinations(configuredAttributes)

  return (
    <main className="admin-page">
      <div className="admin-shell">
        <header className="admin-header">
          <div>
            <p className="eyebrow">JALIMS <span className="admin-header-divider">/</span> ESPACE ADMIN</p>
            <h1>Tableau de bord</h1>
            <p>Gérez votre catalogue et préparez vos produits à la vente.</p>
          </div>
          <div className="admin-session">
            <span className="admin-online-mark" aria-hidden="true" />
            <span>{adminEmail}</span>
            <button type="button" onClick={signOut}>Déconnexion</button>
          </div>
        </header>
        <nav className="admin-shortcuts" aria-label="Outils d’administration">
          <Link className="admin-nav-item current" href="/admin"><span className="admin-nav-icon" aria-hidden="true">▦</span> Produits</Link>
          <Link className="admin-nav-item" href="/admin/importer"><span className="admin-nav-icon" aria-hidden="true">↑</span> Importer des produits</Link>
          <Link className="admin-nav-item" href="/admin/commandes"><span className="admin-nav-icon" aria-hidden="true">↗</span> Commandes</Link>
          {(staffRole === 'owner' || staffRole === 'admin') && <Link className="admin-nav-item" href="/admin/equipe"><span className="admin-nav-icon" aria-hidden="true">⚙</span> Équipe</Link>}
          {(staffRole === 'owner' || staffRole === 'admin') && <Link className="admin-nav-item" href="/admin/parametres"><span className="admin-nav-icon" aria-hidden="true">⚙</span> Paramètres</Link>}
          <Link className="admin-nav-item" href="/admin/partenaires"><span className="admin-nav-icon" aria-hidden="true">⌖</span> Partenaires</Link>
          <Link className="admin-nav-item" href="/admin/clients"><span className="admin-nav-icon" aria-hidden="true">♙</span> Clients</Link>
          <Link className="admin-nav-item" href="/admin/statistiques"><span className="admin-nav-icon" aria-hidden="true">▤</span> Statistiques</Link>
          {(staffRole === 'owner' || staffRole === 'admin') && (
            <Link className="admin-nav-item" href="/admin/demandes">
              <span className="admin-nav-icon" aria-hidden="true">?</span> Demandes
              {newProductRequestCount > 0 && (
                <span style={{ marginLeft: 6, minWidth: 20, height: 20, padding: '0 6px', borderRadius: 999, background: '#FE6E00', color: '#fff', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  {newProductRequestCount}
                </span>
              )}
            </Link>
          )}
          <Link className="admin-nav-item" href="/admin/messages"><span className="admin-nav-icon" aria-hidden="true">✉</span> Messages</Link>
          <Link className="admin-nav-item" href="/admin/retraits"><span className="admin-nav-icon" aria-hidden="true">⌖</span> Points de retrait</Link>
          <Link className="admin-nav-item" href="/admin/accueil"><span className="admin-nav-icon" aria-hidden="true">T</span> Textes accueil</Link>
          <Link className="admin-nav-item" href="/admin/conditions"><span className="admin-nav-icon" aria-hidden="true">§</span> Conditions</Link>
          <Link className="admin-nav-catalog" href="/">Voir la boutique <span aria-hidden="true">↗</span></Link>
        </nav>

        <section className="admin-metrics" aria-label="Résumé du catalogue">
          <article className="admin-metric-card">
            <span className="admin-metric-icon inventory" aria-hidden="true">▦</span>
            <div><span>Produits au total</span><strong>{products.length}</strong><small>Dans votre catalogue</small></div>
          </article>
          <article className="admin-metric-card">
            <span className="admin-metric-icon published" aria-hidden="true">✓</span>
            <div><span>En ligne</span><strong>{activeProducts}</strong><small>Visibles aux clients</small></div>
          </article>
          <article className="admin-metric-card">
            <span className="admin-metric-icon draft" aria-hidden="true">◷</span>
            <div><span>Masqués</span><strong>{hiddenProducts}</strong><small>Non visibles en boutique</small></div>
          </article>
        </section>

        <div className="admin-layout">
          <section className="admin-form-panel">
            <div className="admin-section-heading">
              <div>
                <p className="eyebrow">NOUVEL ARTICLE</p>
                <h2>{editingId ?'Modifier le produit' : 'Informations produit'}</h2>
              </div>
              <span className="publish-badge"><span /> {editingId ?'Modification' : 'Prêt à publier'}</span>
            </div>

            <form className="admin-product-form" onSubmit={handleSubmit}>
              <label>
                <span>Nom du produit</span>
                <input
                  autoComplete="off"
                  maxLength={120}
                  placeholder="Ex. Écouteurs sans fil"
                  required
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </label>

              <label>
                <span>Description</span>
                <textarea
                  maxLength={3000}
                  placeholder="Décrivez les caractéristiques utiles du produit..."
                  rows={4}
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                />
              </label>

              <div className="admin-form-row">
                <label>
                  <span>Prix de vente <small>FCFA</small></span>
                  <input
                    inputMode="numeric"
                    min="1"
                    placeholder="25000"
                    required
                    type="number"
                    value={form.price}
                    onChange={(event) => setForm({ ...form, price: event.target.value })}
                  />
                </label>
                <label>
  <span>Catégorie</span>
  <select
    required
    value={form.category}
    onChange={(event) => setForm({ ...form, category: event.target.value })}
  >
    <option value="">Choisir une catégorie</option>
    {categoryOptions.map((cat) => (
      <option key={cat} value={cat}>
        {cat}
      </option>
    ))}
  </select>
</label>
              </div>

              <label>
                <span>Délai de livraison estimé</span>
                <input
                  maxLength={100}
                  placeholder="Ex. 5 à 12 jours"
                  type="text"
                  value={form.deliveryEstimate}
                  onChange={(event) => setForm({ ...form, deliveryEstimate: event.target.value })}
                />
              </label>

              <label>
                <span>Origine du produit</span>
                <select
                  disabled={saving}
                  value={form.origin}
                  onChange={(event) => setForm({
                    ...form,
                    origin: event.target.value === 'local' ? 'local' : 'import',
                    partnerId: event.target.value === 'local' ?form.partnerId : '',
                  })}
                >
                  <option value="import">Import Chine</option>
                  <option value="local">Disponible au Sénégal</option>
                </select>
              </label>

              {form.origin === 'local' && (
                <div className="admin-local-stock-fields">
                  <label>
                    <span>Quantité en stock</span>
                    <input
                      disabled={saving}
                      min="1"
                      required
                      step="1"
                      type="number"
                      value={form.localStock}
                      onChange={(event) => setForm({ ...form, localStock: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Ville</span>
                    <input
                      autoComplete="address-level2"
                      disabled={saving}
                      maxLength={100}
                      placeholder="Ex. Dakar"
                      required
                      value={form.city}
                      onChange={(event) => setForm({ ...form, city: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Délai de livraison local</span>
                    <input
                      disabled={saving}
                      maxLength={100}
                      placeholder="Ex. 24-72h"
                      required
                      value={form.deliveryDelay}
                      onChange={(event) => setForm({ ...form, deliveryDelay: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Partenaire</span>
                    <select
                      disabled={saving}
                      required
                      value={form.partnerId}
                      onChange={(event) => setForm({ ...form, partnerId: event.target.value })}
                    >
                      <option value="">Choisir un partenaire actif</option>
                      {partnerOptions.map((partner) => (
                        <option key={partner.id} value={partner.id}>{partner.name} · {partner.city}</option>
                      ))}
                    </select>
                    {partnerOptions.length === 0 && <small>Aucun partenaire actif. Ajoutez-en depuis l’écran Partenaires.</small>}
                  </label>
                </div>
              )}

              {form.origin === 'import' && (
                <div className="admin-local-stock-fields">
                  <p className="eyebrow" style={{ margin: 0 }}>CALCUL PRIX IMPORTÉ</p>
                  <label>
                    <span>Prix de base produit</span>
                    <input
                      disabled={saving}
                      min="0"
                      step="0.01"
                      type="number"
                      value={form.importBasePrice}
                      onChange={(event) => setForm({ ...form, importBasePrice: event.target.value })}
                      placeholder="Ex. 45"
                    />
                    <small>Prix du produit avant transport, autres frais, dédouanement et commission.</small>
                  </label>
                  <label>
                    <span>Devise du prix de base</span>
                    <select
                      disabled={saving}
                      value={form.importBaseCurrency}
                      onChange={(event) => setForm({ ...form, importBaseCurrency: event.target.value === 'CNY' ? 'CNY' : 'FCFA' })}
                    >
                      <option value="FCFA">FCFA</option>
                      <option value="CNY">Yuan (CNY)</option>
                    </select>
                  </label>
                  <label>
                    <span>Poids (kg)</span>
                    <input
                      disabled={saving}
                      min="0"
                      step="0.001"
                      type="number"
                      value={form.importWeightKg}
                      onChange={(event) => setForm({ ...form, importWeightKg: event.target.value })}
                      placeholder="Ex. 0.8"
                    />
                    <small>Transport = poids × prix transport/kg (paramètres).</small>
                  </label>
                  <label>
                    <span>Autres frais (FCFA)</span>
                    <input
                      disabled={saving}
                      min="0"
                      step="0.01"
                      type="number"
                      value={form.importOtherFeesFcfa}
                      onChange={(event) => setForm({ ...form, importOtherFeesFcfa: event.target.value })}
                      placeholder="0"
                    />
                    <small>Autres frais déjà pris en compte, inclus dans la base avant dédouanement et commission.</small>
                  </label>
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
                      <p style={{ margin: 0 }}>
                        <small>
                          Prix final calculé (aperçu, arrondi au multiple de 25 FCFA) : <strong>{previewPrice.toLocaleString('fr-FR')} FCFA</strong>
                          {!dynamicReady && ' — calcul dynamique non appliqué (données incomplètes ou taux CNY manquant), le prix enregistré du produit est utilisé.'}
                        </small>
                      </p>
                    )
                  })()}

                  <p className="eyebrow" style={{ margin: '8px 0 0' }}>PRIX D’ACHAT FOURNISSEUR (admin)</p>
                  <label>
                    <span>Prix d’achat fournisseur</span>
                    <input
                      disabled={saving}
                      min="0"
                      step="0.01"
                      type="number"
                      value={form.supplierPurchasePrice}
                      onChange={(event) => setForm({ ...form, supplierPurchasePrice: event.target.value })}
                      placeholder="Laisser vide si non renseigné"
                    />
                    <small>Jamais affiché côté client. Enregistré dans <code>product_costs</code>.</small>
                  </label>
                  <label>
                    <span>Devise du prix d’achat fournisseur</span>
                    <select
                      disabled={saving}
                      value={form.supplierCurrency}
                      onChange={(event) => setForm({ ...form, supplierCurrency: event.target.value === 'CNY' ? 'CNY' : 'FCFA' })}
                    >
                      <option value="FCFA">FCFA</option>
                      <option value="CNY">Yuan (CNY)</option>
                    </select>
                  </label>
                </div>
              )}

              <label className="featured-checkbox-row">
                <input
                  checked={form.featured}
                  onChange={(event) => setForm({ ...form, featured: event.target.checked })}
                  type="checkbox"
                />
                <span><strong>Mettre en produit vedette</strong><small>Ce produit apparaîtra en priorité sur l’accueil.</small></span>
              </label>

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
                <label>
                  <span>Disponibilité</span>
                  <select value={form.stockStatus} onChange={(event) => setForm({ ...form, stockStatus: event.target.value })}>
                    <option value="available">Disponible</option>
                    <option value="preorder">Sur commande</option>
                    <option value="out_of_stock">Indisponible</option>
                  </select>
                </label>
              </div>

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
                        <label>
                          <span>Valeurs : {attribute.label}</span>
                          <textarea
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
                        </label>
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

              <section className="admin-photo-manager" aria-label="Photos du produit">
                <div className="admin-section-heading">
                  <div>
                    <h3>Photos du produit</h3>
                    <p>Total : {totalImageCount} image(s) (existantes + nouvelles). {canPublishWithImages ? 'Publication possible (3 photos ou plus).' : 'Ajoutez au moins 3 photos au total pour publier ce produit. Il restera en brouillon.'}</p>
                  </div>
                </div>

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
                              <button
                                type="button"
                                disabled={imageActionBusy !== null || index === 0}
                                onClick={() => void moveExistingImage(index, -1)}
                              >Monter</button>
                              <button
                                type="button"
                                disabled={imageActionBusy !== null || index === existingImages.length - 1}
                                onClick={() => void moveExistingImage(index, 1)}
                              >Descendre</button>
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
                              <button
                                type="button"
                                disabled={imageActionBusy !== null}
                                onClick={() => void deleteExistingImage(image)}
                              >{imageActionBusy === `delete-${image.id}` ? 'Suppression...' : 'Supprimer'}</button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                <label>
                  <span>{editingId ? 'Ajouter de nouvelles photos' : 'Photos du produit'}</span>
                  <input
                    accept="image/jpeg,image/png,image/webp"
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
                      if (!editingId && files.length > 0 && files.length < 3) {
                        setFeedback({ kind: 'error', text: 'Produit enregistré en brouillon : ajoutez au moins 3 photos au total pour pouvoir le publier.' })
                      } else {
                        setFeedback(null)
                      }
                    }}
                    type="file"
                  />
                  <small className="field-hint">JPG, PNG ou WebP, 6 Mo maximum chacune. {imageFiles.length} nouvelle(s) sélectionnée(s). Les nouvelles photos seront ajoutées à la suite, sans dupliquer les photos existantes.</small>
                </label>

                <label>
                  <span>URL publique de secours (ne compte pas comme photo enregistrée pour la publication)</span>
                  <input
                    autoComplete="url"
                    placeholder="https://... (facultatif)"
                    type="url"
                    value={form.imageUrl}
                    onChange={(event) => {
                      setForm({ ...form, imageUrl: event.target.value })
                    }}
                  />
                  <small className="field-hint">La publication nécessite au moins 3 photos enregistrées en base (product_images). Une URL de secours seule ne suffit pas.</small>
                </label>
              </section>

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

              {feedback && (
                <p className={`admin-feedback ${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>
                  {feedback.text}
                </p>
              )}

              <button className="admin-submit" type="submit" disabled={saving || imageActionBusy !== null || existingImagesLoading}>
                {saving ? 'Enregistrement...' : editingId ? 'Enregistrer les modifications' : (canPublishWithImages ? 'Publier le produit' : 'Enregistrer en brouillon')}
                {!saving && <span aria-hidden="true">{'\u2192'}</span>}
              </button>
              {editingId && <button className="admin-cancel-edit" type="button" onClick={() => { setEditingId(null); setEditingActive(true); setImageFiles([]); setImagePreviews([]); setExistingImages([]); setSelectedAttributeKeys([]); setAttributeValueInputs({}); setAttributeColorInputs({}); setVariantDrafts({}); setForm(emptyForm); setFeedback(null) }}>Annuler la modification</button>}
            </form>
          </section>

          <section className="admin-products-panel" aria-labelledby="active-products-title">
            <div className="admin-section-heading">
              <div>
                <p className="eyebrow">INVENTAIRE</p>
                <h2 id="active-products-title">Vos produits</h2>
              </div>
              <span className="admin-product-count">{products.length}</span>
            </div>
            <label className="admin-search-field">
              <Search aria-hidden="true" size={17} strokeWidth={2} />
              <span className="sr-only">Rechercher dans les produits</span>
              <input placeholder="Rechercher un produit..." value={productSearch} onChange={(event) => setProductSearch(event.target.value)} />
            </label>
            <div className="admin-product-filters" role="group" aria-label="Filtrer les produits">
              <button className={productFilter === 'all' ? 'active' : ''} type="button" onClick={() => setProductFilter('all')}>Tous <span>{products.length}</span></button>
              <button className={productFilter === 'active' ? 'active' : ''} type="button" onClick={() => setProductFilter('active')}>En ligne <span>{activeProducts}</span></button>
              <button className={productFilter === 'hidden' ? 'active' : ''} type="button" onClick={() => setProductFilter('hidden')}>Masqués <span>{hiddenProducts}</span></button>
              <button className={productFilter === 'import_missing_purchase' ? 'active' : ''} type="button" onClick={() => setProductFilter('import_missing_purchase')}>Importés sans prix d’achat <span>{importedMissingPurchaseCount}</span></button>
            </div>
            {productsError ?(
              <p className="admin-list-error">Impossible de charger le catalogue : {productsError}</p>
            ) : visibleProducts.length === 0 ?(
              <p className="admin-empty-list">{products.length === 0 ?'Aucun produit pour le moment. Ajoutez votre premier article.' : 'Aucun produit ne correspond à cette recherche.'}</p>
            ) : (
              <ul className="admin-product-list">
                {visibleProducts.map((product) => (
                  <li
                    className={isLocalStockWarning(product) ?'admin-local-stock-warning' : ''}
                    key={product.id}
                  >
                    <div className="admin-list-image">
                      {product.image_url && <Image src={product.image_url} alt="" fill sizes="48px" unoptimized />}
                    </div>
                    <div className="admin-list-copy">
                      <strong>{product.name}</strong>
                      <span>{product.featured ?'Vedette · ' : ''}{product.category || 'Sans catégorie'} · Minimum {product.moq}</span>
                      {product.origin === 'local' ?(
                        <span className="admin-local-stock-details">
                          Disponible au Sénégal · Stock {product.local_stock} · {product.city || 'Ville à confirmer'} · Mis à jour le {formatStockUpdatedAt(product.stock_updated_at)}{isLocalStockWarning(product) ?' · Stock à confirmer' : ''}
                        </span>
                      ) : (
                        <>
                          <span className="admin-import-origin">Import Chine</span>
                          <div className="admin-supplier-cost">
                            {product.supplier_cost?.purchase_price != null ? (
                              <span>Prix d’achat fournisseur : <strong>{Number(product.supplier_cost.purchase_price).toLocaleString('fr-FR')} {product.supplier_cost.currency ?? 'FCFA'}</strong></span>
                            ) : (
                              <span className="admin-supplier-cost-missing">À renseigner</span>
                            )}
                            <div className="admin-supplier-cost-editor">
                              <input
                                aria-label={`Prix d’achat fournisseur pour ${product.name}`}
                                inputMode="decimal"
                                min="0"
                                placeholder="Prix d’achat"
                                step="any"
                                type="number"
                                value={supplierCostDrafts[String(product.id)]?.price ?? ''}
                                onChange={(event) => setSupplierCostDrafts((current) => ({
                                  ...current,
                                  [String(product.id)]: {
                                    ...(current[String(product.id)] ?? { price: '', currency: 'FCFA' }),
                                    price: event.target.value,
                                  },
                                }))}
                              />
                              <select
                                aria-label={`Devise du prix d’achat pour ${product.name}`}
                                value={supplierCostDrafts[String(product.id)]?.currency ?? 'FCFA'}
                                onChange={(event) => setSupplierCostDrafts((current) => ({
                                  ...current,
                                  [String(product.id)]: {
                                    ...(current[String(product.id)] ?? { price: '', currency: 'FCFA' }),
                                    currency: event.target.value === 'CNY' ? 'CNY' : 'FCFA',
                                  },
                                }))}
                              >
                                <option value="FCFA">FCFA</option>
                                <option value="CNY">Yuan</option>
                              </select>
                              <button
                                className="admin-list-action"
                                disabled={savingSupplierCostId === String(product.id)}
                                onClick={() => void saveSupplierCost(String(product.id))}
                                type="button"
                              >
                                {savingSupplierCostId === String(product.id) ? '...' : 'Enregistrer'}
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                    <b>{getDisplayedUnitPrice(product, appSettings).toLocaleString('fr-FR')} FCFA</b>
                    <span className={`admin-product-status ${product.active ? 'is-live' : 'is-hidden'}`}>{product.active ? 'En ligne' : 'Masqué'}</span>
                    {product.origin === 'local' && (
                      <div className="admin-local-stock-actions">
                        <label>
                          <span className="sr-only">Quantité de stock pour {product.name}</span>
                          <input
                            aria-label={`Quantité en stock pour ${product.name}`}
                            min="1"
                            step="1"
                            type="number"
                            value={stockQuantities[String(product.id)] ?? String(product.local_stock ?? '')}
                            onChange={(event) => setStockQuantities((current) => ({
                              ...current,
                              [String(product.id)]: event.target.value,
                            }))}
                          />
                        </label>
                        <button
                          className="admin-stock-confirm"
                          disabled={confirmingStockId === String(product.id)}
                          onClick={() => void confirmLocalStock(product)}
                          type="button"
                        >
                          {confirmingStockId === String(product.id) ? 'Confirmation...' : 'Confirmer le stock aujourd’hui'}
                        </button>
                      </div>
                    )}
                    <button className="admin-list-action" type="button" onClick={() => editProduct(product)} aria-label={`Modifier ${product.name}`}>✎</button>
                    <button className="admin-list-action" type="button" onClick={() => void toggleProduct(product)} aria-label={`${product.active ? 'Désactiver' : 'Réactiver'} ${product.name}`} >{product.active ? '−' : '+'}</button>
                    <button className="admin-list-action is-danger" type="button" disabled={deletingProductId === String(product.id)} onClick={() => void deleteProduct(product)} aria-label={`Supprimer ou archiver ${product.name}`}>
                      {deletingProductId === String(product.id) ? '...' : 'Supprimer'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Link className="admin-catalog-link" href="/">Voir le catalogue <span aria-hidden="true">{'\u2192'}</span></Link>
          </section>
        </div>
      </div>
    </main>
  )
}
