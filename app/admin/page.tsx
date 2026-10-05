'use client'

import Image from 'next/image'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { hasJalimsAdminAccess } from '../../lib/admin-access'
import QuantityInput from '../ui/quantity-input'

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
}

type AccessState = 'checking' | 'signed-out' | 'not-admin' | 'auth-error' | 'ready'
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
}

function getPreviewUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
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

export default function AdminPage() {
  const [access, setAccess] = useState<AccessState>('checking')
  const [adminEmail, setAdminEmail] = useState('')
  const [currentRole, setCurrentRole] = useState('')
  const [authError, setAuthError] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [productsError, setProductsError] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [productFilter, setProductFilter] = useState<'all' | 'active' | 'hidden'>('all')
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingActive, setEditingActive] = useState(true)
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [imagePreviews, setImagePreviews] = useState<{ file: File; url: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]) 
  const [attributeDefinitions, setAttributeDefinitions] = useState<AttributeDefinition[]>([])
  const [selectedAttributeKeys, setSelectedAttributeKeys] = useState<string[]>([])
  const [attributeValueInputs, setAttributeValueInputs] = useState<Record<string, string>>({})
  const [attributeColorInputs, setAttributeColorInputs] = useState<Record<string, Record<string, string>>>({})
  const [variantDrafts, setVariantDrafts] = useState<Record<string, VariantDraft>>({})
  const [variantConfigLoading, setVariantConfigLoading] = useState(false)

  async function loadProducts() {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, description, price, delivery_estimate, image_url, category, moq, stock_status, active, featured')
      .order('name')

    if (error) {
      setProductsError(error.message)
      return
    }

    setProductsError('')
    setProducts((data ?? []) as Product[])
  }

  async function loadAttributeDefinitions() {
    const { data, error } = await supabase
      .from('product_attribute_definitions')
      .select('attribute_key, label, sort_order')
      .eq('enabled', true)
      .order('sort_order')

    if (error) {
      setFeedback({ kind: 'error', text: `Impossible de charger les attributs produit : ${error.message}` })
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
        setAuthError(error.message)
        setAccess('auth-error')
        return
      }

      if (!data.user) {
        setAccess('signed-out')
        return
      }

      const role = typeof data.user.app_metadata?.role === 'string' ? data.user.app_metadata.role : ''
      setAdminEmail(data.user.email ?? '')
      setCurrentRole(role)

      if (!hasJalimsAdminAccess(data.user)) {
        setAccess('not-admin')
        return
      }

      setAccess('ready')
      void loadProducts()
      void loadAttributeDefinitions()
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
      reader.onload = () => typeof reader.result === 'string' ? resolve({ file, url: reader.result }) : reject(new Error('Aperçu image indisponible'))
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
    const imageUrl = getPreviewUrl(form.imageUrl.trim())
    const configuredAttributes = selectedAttributeKeys.map((attributeKey) => ({
      attribute_key: attributeKey,
      attribute_values: parseAttributeValues(attributeValueInputs[attributeKey] ?? ''),
      attribute_colors: attributeKey === 'color' ? attributeColorInputs[attributeKey] ?? {} : {},
    }))
    const variantCombinations = buildVariantCombinations(configuredAttributes.map((attribute) => ({
      key: attribute.attribute_key,
      values: attribute.attribute_values,
    })))

    if (!name || !Number.isFinite(price) || price <= 0 || !Number.isInteger(moq) || moq < 1) {
      setFeedback({ kind: 'error', text: 'Vérifiez le nom, le prix et la quantité minimale.' })
      return
    }

    if (variantConfigLoading || configuredAttributes.some((attribute) => attribute.attribute_values.length === 0)) {
      setFeedback({ kind: 'error', text: 'Ajoutez au moins une valeur pour chaque attribut activé.' })
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

    if ((!editingId && imageFiles.length < 3) || (imageFiles.length > 0 && imageFiles.length < 3)) {
      setFeedback({ kind: 'error', text: 'Sélectionnez au moins 3 photos JPG, PNG ou WebP. Vous pouvez en ajouter 5 ou plus.' })
      return
    }

    if (imageFiles.some((file) => file.size > 6 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) {
      setFeedback({ kind: 'error', text: 'Chaque photo doit être au format JPG, PNG ou WebP et faire 6 Mo maximum.' })
      return
    }

    const { data: refreshedAuth, error: refreshError } = await supabase.auth.refreshSession()
    if (refreshError || !hasJalimsAdminAccess(refreshedAuth.session?.user)) {
      setFeedback({
        kind: 'error',
        text: 'Impossible de confirmer le rôle admin dans le jeton renouvelé. Vérifiez app_metadata.role = admin dans Supabase, puis déconnectez-vous et reconnectez-vous.',
      })
      return
    }

    setSaving(true)
    let productId = editingId
    let createdProduct = false
    const uploadedPaths: string[] = []
    let productImageUrl = imageUrl

    if (!productId) {
      productId = crypto.randomUUID()
      const { error } = await supabase.from('products').insert({
        id: productId,
        name,
        description: form.description.trim(),
        price,
        image_url: null,
        category: form.category.trim() || null,
        moq,
        stock_status: form.stockStatus,
        featured: form.featured,
        active: false,
      })

      if (error) {
        setSaving(false)
        const policyHelp = error?.message.toLowerCase().includes('row-level security')
          ? ` Compte connecté : ${refreshedAuth.session?.user.email ?? 'inconnu'} · rôle JWT : ${String(refreshedAuth.session?.user.app_metadata?.role ?? 'absent')}. Vérifiez la politique SQL products puis reconnectez-vous.`
          : ''
        setFeedback({ kind: 'error', text: `Création refusée : ${error.message}.${policyHelp}` })
        return
      }
      createdProduct = true
    }

    if (imageFiles.length > 0) {
      const { data: existingImages } = await supabase
        .from('product_images')
        .select('display_order')
        .eq('product_id', productId)
        .order('display_order', { ascending: false })
        .limit(1)
      const firstOrder = (existingImages?.[0]?.display_order ?? -1) + 1
      const galleryRows: { product_id: string; image_url: string; storage_path: string; display_order: number }[] = []

      for (const [index, file] of imageFiles.entries()) {
        const objectPath = `${productId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`
        const { error: uploadError } = await supabase.storage.from('products').upload(objectPath, file, {
          cacheControl: '3600',
          contentType: file.type,
          upsert: false,
        })

        if (uploadError) {
          if (uploadedPaths.length) await supabase.storage.from('products').remove(uploadedPaths)
          if (createdProduct) await supabase.from('products').delete().eq('id', productId)
          setSaving(false)
          const roleIssue = uploadError.message.toLowerCase().includes('row-level security')
            ? ' Dans Supabase SQL Editor, exécutez supabase/migrations/20260926_product_gallery_storage_rls.sql. Le bucket products doit autoriser les photos et la session doit avoir role admin.'
            : ''
          setFeedback({ kind: 'error', text: `Envoi photo ${index + 1}/${imageFiles.length} refusé : ${uploadError.message}.${roleIssue}` })
          return
        }

        uploadedPaths.push(objectPath)
        const publicUrl = supabase.storage.from('products').getPublicUrl(objectPath).data.publicUrl
        if (index === 0) productImageUrl = publicUrl
        galleryRows.push({
          product_id: productId,
          image_url: publicUrl,
          storage_path: objectPath,
          display_order: firstOrder + index,
        })
      }

      const { error: galleryError } = await supabase.from('product_images').insert(galleryRows)
      if (galleryError) {
        await supabase.storage.from('products').remove(uploadedPaths)
        if (createdProduct) await supabase.from('products').delete().eq('id', productId)
        setSaving(false)
        setFeedback({ kind: 'error', text: `Photos envoyées, mais la galerie n’a pas pu être enregistrée : ${galleryError.message}. Vérifiez que la migration galerie est appliquée.` })
        return
      }
    }

    const productValues = {
      name,
      description: form.description.trim(),
      price,
      delivery_estimate: form.deliveryEstimate.trim() || null,
      image_url: productImageUrl,
      category: form.category.trim() || null,
      moq,
      stock_status: form.stockStatus,
      featured: form.featured,
      active: editingId ? editingActive : false,
    }
    const { error } = await supabase.from('products').update(productValues).eq('id', productId)

    if (error) {
      setSaving(false)
      if (uploadedPaths.length) await supabase.storage.from('products').remove(uploadedPaths)
      if (createdProduct) await supabase.from('products').delete().eq('id', productId)
      setFeedback({
        kind: 'error',
        text: `Publication refusée par Supabase : ${error.message}`,
      })
      return
    }

    const { error: variantError } = await supabase.rpc('save_product_variant_configuration', {
      p_product_id: productId,
      p_attributes: configuredAttributes,
      p_variants: configuredVariants,
    })

    if (variantError) {
      setSaving(false)
      if (createdProduct) {
        if (uploadedPaths.length) await supabase.storage.from('products').remove(uploadedPaths)
        await supabase.from('products').delete().eq('id', productId)
      }
      setFeedback({ kind: 'error', text: `Configuration des variantes refusée : ${variantError.message}` })
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
        setSaving(false)
        if (createdProduct) {
          if (uploadedPaths.length) await supabase.storage.from('products').remove(uploadedPaths)
          await supabase.from('products').delete().eq('id', productId)
        }
        setFeedback({
          kind: 'error',
          text: `Les variantes sont enregistrées, mais les couleurs n’ont pas pu être enregistrées${colorError ? ` : ${colorError.message}` : '.'}`,
        })
        return
      }
    }

    if (createdProduct) {
      const { error: activateError } = await supabase.from('products').update({ active: true }).eq('id', productId)
      if (activateError) {
        setSaving(false)
        setFeedback({ kind: 'error', text: `Variantes enregistrées, mais le produit n’a pas pu être publié : ${activateError.message}` })
        return
      }
    }

    setSaving(false)

    setForm(emptyForm)
    setImageFiles([])
    setEditingId(null)
    setSelectedAttributeKeys([])
    setAttributeValueInputs({})
    setAttributeColorInputs({})
    setVariantDrafts({})
    setFeedback({ kind: 'success', text: editingId ? 'Produit modifié.' : 'Produit publié dans le catalogue.' })
    setImagePreviews([])
    await loadProducts()
  }

  function editProduct(product: Product) {
    setEditingId(String(product.id))
    setEditingActive(product.active)
    setImageFiles([])
    setImagePreviews([])
    setSelectedAttributeKeys([])
    setAttributeValueInputs({})
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
    })
    setFeedback(null)
    void loadProductVariantConfiguration(String(product.id))
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
      setFeedback({ kind: 'error', text: `Impossible de charger les variantes : ${(attributesError ?? variantsError)?.message}` })
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
    const { error } = await supabase.from('products').update({ active: !product.active }).eq('id', product.id)
    if (error) {
      setFeedback({ kind: 'error', text: `Modification refusée : ${error.message}` })
      return
    }
    if (editingId === String(product.id)) {
      setEditingId(null)
      setEditingActive(true)
      setForm(emptyForm)
      setImageFiles([])
      setImagePreviews([])
      setSelectedAttributeKeys([])
      setAttributeValueInputs({})
      setAttributeColorInputs({})
      setVariantDrafts({})
    }
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
                ? 'Connexion à Supabase impossible'
                : 'Accès réservé'}
          </h1>
          <p>
            {access === 'signed-out'
              ? 'Connectez-vous avec un compte administrateur pour gérer le catalogue.'
              : access === 'auth-error'
                ? `Erreur d’authentification : ${authError}`
                : 'Ce compte ne dispose pas du rôle administrateur.'}
          </p>
          {access === 'not-admin' && (
            <p className="admin-diagnostic" role="status">
              Compte détecté : <strong>{adminEmail || 'adresse indisponible'}</strong><br />
              Rôle reçu : <strong>{currentRole || 'absent'}</strong>
            </p>
          )}
          <Link className="admin-primary-link" href="/login?next=%2Fadmin">Se connecter</Link>
          <Link className="admin-secondary-link" href="/">Retour au catalogue</Link>
        </section>
      </main>
    )
  }

  const imagePreview = imagePreviews[0]?.url ?? getPreviewUrl(form.imageUrl.trim())
  const activeProducts = products.filter((product) => product.active).length
  const hiddenProducts = products.length - activeProducts
  const visibleProducts = products.filter((product) => {
    const matchesSearch = `${product.name} ${product.category ?? ''}`.toLocaleLowerCase().includes(productSearch.trim().toLocaleLowerCase())
    const matchesFilter = productFilter === 'all' || (productFilter === 'active' ? product.active : !product.active)
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
          <Link className="admin-nav-item" href="/admin/commandes"><span className="admin-nav-icon" aria-hidden="true">↗</span> Commandes</Link>
          <Link className="admin-nav-item" href="/admin/retraits"><span className="admin-nav-icon" aria-hidden="true">⌖</span> Points de retrait</Link>
          <Link className="admin-nav-item" href="/admin/accueil"><span className="admin-nav-icon" aria-hidden="true">T</span> Textes accueil</Link>
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
                <h2>{editingId ? 'Modifier le produit' : 'Informations produit'}</h2>
              </div>
              <span className="publish-badge"><span /> {editingId ? 'Modification' : 'Prêt à publier'}</span>
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
                {variantConfigLoading ? (
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
                    {selectedAttributeKeys.length === 0 ? (
                      <p className="variant-editor-note">Aucune variante : le produit utilise son statut général Disponible / Indisponible.</p>
                    ) : variantCombinations.length === 0 ? (
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

              <label>
                <span>Photo du produit</span>
                <input
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={(event) => {
                    const files = Array.from(event.currentTarget.files ?? [])
                    if (files.some((file) => file.size > 6 * 1024 * 1024)) {
                      setFeedback({ kind: 'error', text: 'Chaque photo doit faire 6 Mo maximum.' })
                      event.currentTarget.value = ''
                      return
                    }
                    if (files.length > 0 && files.length < 3) {
                      setFeedback({ kind: 'error', text: 'Sélectionnez au moins 3 photos en une seule fois. Vous pouvez en choisir 5 ou plus.' })
                      event.currentTarget.value = ''
                      return
                    }
                    setFeedback(null)
                    setImagePreviews([])
                    setImageFiles(files)
                  }}
                  type="file"
                />
                <small className="field-hint">Minimum 3 photos, 5 ou plus accepté. JPG, PNG ou WebP, 6 Mo maximum chacune. {imageFiles.length} sélectionnée{imageFiles.length === 1 ? '' : 's'}.</small>
              </label>

              <label>
                <span>URL publique de secours (réservée aux produits existants)</span>
                <input
                  autoComplete="url"
                  placeholder="https://... (facultatif si vous importez une photo)"
                  type="url"
                  value={form.imageUrl}
                  onChange={(event) => {
                    setForm({ ...form, imageUrl: event.target.value })
                  }}
                />
              </label>

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
                </div>
              </div>
              {imagePreviews.length > 1 && (
                <div className="admin-image-preview-grid" aria-label="Aperçu des photos sélectionnées">
                  {imagePreviews.map((preview, index) => (
                    <div className="admin-gallery-preview" key={`${preview.file.name}-${index}`}>
                      <Image src={preview.url} alt={`Photo ${index + 1}`} fill sizes="80px" unoptimized />
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

              <button className="admin-submit" type="submit" disabled={saving}>
                {saving ? 'Enregistrement...' : editingId ? 'Enregistrer les modifications' : 'Publier le produit'}
                {!saving && <span aria-hidden="true">→</span>}
              </button>
              {editingId && <button className="admin-cancel-edit" type="button" onClick={() => { setEditingId(null); setImageFiles([]); setImagePreviews([]); setSelectedAttributeKeys([]); setAttributeValueInputs({}); setAttributeColorInputs({}); setVariantDrafts({}); setForm(emptyForm); setFeedback(null) }}>Annuler la modification</button>}
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
            </div>
            {productsError ? (
              <p className="admin-list-error">Impossible de charger le catalogue : {productsError}</p>
            ) : visibleProducts.length === 0 ? (
              <p className="admin-empty-list">{products.length === 0 ? 'Aucun produit pour le moment. Ajoutez votre premier article.' : 'Aucun produit ne correspond à cette recherche.'}</p>
            ) : (
              <ul className="admin-product-list">
                {visibleProducts.map((product) => (
                  <li key={product.id}>
                    <div className="admin-list-image">
                      {product.image_url && <Image src={product.image_url} alt="" fill sizes="48px" unoptimized />}
                    </div>
                    <div className="admin-list-copy">
                      <strong>{product.name}</strong>
                      <span>{product.featured ? 'Vedette · ' : ''}{product.category || 'Sans catégorie'} · Minimum {product.moq}</span>
                    </div>
                    <b>{Number(product.price).toLocaleString('fr-FR')} FCFA</b>
                    <span className={`admin-product-status ${product.active ? 'is-live' : 'is-hidden'}`}>{product.active ? 'En ligne' : 'Masqué'}</span>
                    <button className="admin-list-action" type="button" onClick={() => editProduct(product)} aria-label={`Modifier ${product.name}`}>✎</button>
                    <button className="admin-list-action" type="button" onClick={() => void toggleProduct(product)} aria-label={`${product.active ? 'Désactiver' : 'Réactiver'} ${product.name}`}>{product.active ? '−' : '+'}</button>
                  </li>
                ))}
              </ul>
            )}
            <Link className="admin-catalog-link" href="/">Voir le catalogue <span aria-hidden="true">→</span></Link>
          </section>
        </div>
      </div>
    </main>
  )
}