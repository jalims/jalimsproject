'use client'

import Image from 'next/image'
import Link from 'next/link'
import { Check, Eye, EyeOff, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { canAccessAdminPath } from '../../../../lib/admin-staff-client'
import { isLocalStockWarning } from '../../../../lib/product-origin'
import { logClientError } from '../../../../lib/user-facing-errors'
import { supabase } from '../../../../lib/supabase'
import { useAdminSession } from '../../admin-session-provider'
import { getDisplayedUnitPrice, DEFAULT_APP_PRICING_SETTINGS, normalizeAppPricingSettings, type AppPricingSettings } from '../../../../lib/imported-product-pricing'
import { formatStockUpdatedAt, PRODUCT_SELECT_COLUMNS, requestAdminProducts, type Product, type SupplierCost } from './product-data'

type ProductFilter = 'all' | 'active' | 'hidden' | 'import_missing_purchase'

export default function CatalogPage() {
  const { userId, role: staffRole, loading: sessionLoading, error: sessionError } = useAdminSession()
  const [products, setProducts] = useState<Product[]>([])
  const [supplierCostDrafts, setSupplierCostDrafts] = useState<Record<string, { price: string; currency: 'FCFA' | 'CNY' }>>({})
  const [savingSupplierCostId, setSavingSupplierCostId] = useState<string | null>(null)
  const [productsError, setProductsError] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [productFilter, setProductFilter] = useState<ProductFilter>('all')
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null)
  const [stockQuantities, setStockQuantities] = useState<Record<string, string>>({})
  const [confirmingStockId, setConfirmingStockId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [loadingProducts, setLoadingProducts] = useState(true)
  const [appSettings, setAppSettings] = useState<AppPricingSettings>(DEFAULT_APP_PRICING_SETTINGS)

  const loadProducts = useCallback(async () => {
    setLoadingProducts(true)
    const { data, error } = await supabase
      .from('products')
      .select(PRODUCT_SELECT_COLUMNS)
      .order('name')

    if (error) {
      logClientError('Admin product list load failed', error)
      setProductsError('Impossible de charger le catalogue pour le moment.')
      setLoadingProducts(false)
      return
    }

    const rows = (data ?? []) as Product[]
    const canViewCosts = staffRole === 'owner' || staffRole === 'admin'
    let costsByProductId: Record<string, SupplierCost> = {}
    if (canViewCosts && rows.length > 0) {
      const { data: costs, error: costsError } = await supabase
        .from('product_costs')
        .select('product_id, purchase_price, currency')
        .in('product_id', rows.map((product) => String(product.id)))
      if (costsError) {
        logClientError('Admin supplier costs load failed', costsError)
      } else {
        costsByProductId = Object.fromEntries((costs ?? []).map((cost) => [String(cost.product_id), {
          purchase_price: cost.purchase_price == null ? null : Number(cost.purchase_price),
          currency: cost.currency === 'CNY' ? 'CNY' : cost.currency === 'FCFA' ? 'FCFA' : null,
        }]))
      }
    }

    const merged = rows.map((product) => ({ ...product, supplier_cost: costsByProductId[String(product.id)] ?? null }))
    setProductsError('')
    setProducts(merged)
    setSupplierCostDrafts((current) => {
      const next = { ...current }
      for (const product of merged) {
        const id = String(product.id)
        if (!next[id]) {
          next[id] = {
            price: product.supplier_cost?.purchase_price != null ? String(product.supplier_cost.purchase_price) : '',
            currency: product.supplier_cost?.currency ?? 'FCFA',
          }
        }
      }
      return next
    })
    setLoadingProducts(false)
  }, [staffRole])

  const loadAppSettings = useCallback(async () => {
    const { data, error } = await supabase
      .from('app_settings')
      .select('transport_price_per_kg_fcfa, commission_percent, customs_percent, cny_to_fcfa_rate')
      .eq('id', 1)
      .maybeSingle()
    if (!error) setAppSettings(normalizeAppPricingSettings(data as Partial<AppPricingSettings> | null))
  }, [])

  useEffect(() => {
    if (sessionLoading || sessionError || !userId || !canAccessAdminPath(staffRole, '/admin/produits')) return
    let active = true
    void Promise.resolve().then(() => {
      if (!active) return
      void loadProducts()
      void loadAppSettings()
    })
    return () => { active = false }
  }, [loadAppSettings, loadProducts, sessionError, sessionLoading, staffRole, userId])

  async function saveSupplierCost(productId: string) {
    const draft = supplierCostDrafts[productId] ?? { price: '', currency: 'FCFA' as const }
    const raw = draft.price.trim()
    const price = raw === '' ? null : Number(raw)
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      setFeedback({ kind: 'error', text: 'Le prix d’achat fournisseur doit être un nombre positif ou vide.' })
      return
    }
    setSavingSupplierCostId(productId)
    setFeedback(null)
    try {
      const result = price === null
        ? await supabase.from('product_costs').delete().eq('product_id', productId)
        : await supabase.from('product_costs').upsert({
            product_id: productId,
            purchase_price: price,
            currency: draft.currency,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'product_id' })
      if (result.error) throw result.error
      await loadProducts()
      setFeedback({ kind: 'success', text: 'Prix d’achat fournisseur enregistré.' })
    } catch (error) {
      logClientError('Admin supplier cost save failed', error)
      setFeedback({ kind: 'error', text: 'Le prix d’achat fournisseur n’a pas pu être enregistré.' })
    } finally {
      setSavingSupplierCostId(null)
    }
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
    setFeedback({
      kind: 'success',
      text: data?.archived
        ? `Produit archivé : « ${product.name} » reste masqué car il est lié à des commandes.`
        : `Produit supprimé : « ${product.name} » a été retiré avec ses photos et ses coûts.`,
    })
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

  if (sessionLoading) {
    return <main className="admin-page"><div className="admin-state">Vérification de l’accès...</div></main>
  }

  if (sessionError || !userId || !canAccessAdminPath(staffRole, '/admin/produits')) {
    const denied = Boolean(userId && staffRole)
    return (
      <main className="admin-page">
        <section className="admin-access-state">
          <span className="admin-access-icon" aria-hidden="true">⌁</span>
          <p className="eyebrow">ESPACE D’ADMINISTRATION</p>
          <h1>{sessionError ? 'Connexion momentanément indisponible' : !userId ? 'Connexion requise' : denied ? 'Accès refusé' : 'Accès réservé'}</h1>
          <p>{sessionError ? sessionError : !userId ? 'Connectez-vous avec un compte autorisé pour gérer le catalogue.' : denied ? 'Votre rôle ne permet pas d’accéder à cette page.' : 'Ce compte ne dispose pas du rôle administrateur.'}</p>
          {!userId && <Link className="admin-primary-link" href="/login?next=%2Fadmin%2Fproduits">Se connecter</Link>}
          {denied && staffRole === 'order_manager' && <Link className="admin-primary-link" href="/admin/commandes">Aller aux commandes</Link>}
          <Link className="admin-secondary-link" href="/">Retour au catalogue</Link>
        </section>
      </main>
    )
  }

  const activeProducts = products.filter((product) => product.active).length
  const hiddenProducts = products.length - activeProducts
  const importedMissingPurchaseCount = products.filter((product) => product.origin === 'import' && product.supplier_cost?.purchase_price == null).length
  const visibleProducts = products.filter((product) => {
    const matchesSearch = `${product.name} ${product.category ?? ''}`.toLocaleLowerCase().includes(productSearch.trim().toLocaleLowerCase())
    const matchesFilter = productFilter === 'all'
      || (productFilter === 'active' && product.active)
      || (productFilter === 'hidden' && !product.active)
      || (productFilter === 'import_missing_purchase' && product.origin === 'import' && product.supplier_cost?.purchase_price == null)
    return matchesSearch && matchesFilter
  })

  return (
    <main className="admin-page">
      <div className="admin-shell">
        <header className="admin-header">
          <div>
            <p className="eyebrow">JALIMS <span className="admin-header-divider">/</span> ESPACE ADMIN</p>
            <h1>Produits</h1>
            <p>Gérez votre catalogue et préparez vos produits à la vente.</p>
          </div>
          <Link className="admin-primary-link" href="/admin/produits/nouveau"><Plus aria-hidden="true" size={18} /> Ajouter un produit</Link>
        </header>

        <section className="admin-metrics" aria-label="Résumé du catalogue">
          <article className="admin-metric-card"><span>Produits au total</span><strong>{products.length}</strong></article>
          <article className="admin-metric-card"><span>En ligne</span><strong>{activeProducts}</strong></article>
          <article className="admin-metric-card"><span>Masqués</span><strong>{hiddenProducts}</strong></article>
        </section>

        <section className="admin-products-panel" aria-labelledby="active-products-title">
          <div className="admin-section-heading">
            <div><p className="eyebrow">INVENTAIRE</p><h2 id="active-products-title">Vos produits</h2></div>
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

          {feedback && <p className={`admin-feedback ${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.text}</p>}
          {productsError ? (
            <p className="admin-list-error" role="alert">{productsError}</p>
          ) : loadingProducts ? (
            <p className="admin-state" role="status">Chargement du catalogue...</p>
          ) : visibleProducts.length === 0 ? (
            <p className="admin-empty-list">{products.length === 0 ? 'Aucun produit pour le moment. Ajoutez votre premier article.' : 'Aucun produit ne correspond à cette recherche.'}</p>
          ) : (
            <ul className="admin-product-list">
              {visibleProducts.map((product) => {
                const id = String(product.id)
                const isOwnerOrAdmin = staffRole === 'owner' || staffRole === 'admin'
                return (
                  <li className={isLocalStockWarning(product) ? 'admin-local-stock-warning' : ''} key={product.id}>
                    <div className="admin-list-image">{product.image_url && <Image src={product.image_url} alt="" fill sizes="48px" unoptimized />}</div>
                    <div className="admin-list-copy">
                      <strong>{product.name}</strong>
                      <span>{product.featured ? 'Vedette · ' : ''}{product.category || 'Sans catégorie'} · Minimum {product.moq}</span>
                      {product.origin === 'local' ? (
                        <span className="admin-local-stock-details">
                          Disponible au Sénégal · Stock {product.local_stock} · {product.city || 'Ville à confirmer'} · Mis à jour le {formatStockUpdatedAt(product.stock_updated_at)}{isLocalStockWarning(product) ? ' · Stock à confirmer' : ''}
                        </span>
                      ) : (
                        <>
                          <span className="admin-import-origin">Import Chine</span>
                          {isOwnerOrAdmin && <div className="admin-supplier-cost">
                            {product.supplier_cost?.purchase_price != null
                              ? <span>Prix d’achat fournisseur : <strong>{Number(product.supplier_cost.purchase_price).toLocaleString('fr-FR')} {product.supplier_cost.currency ?? 'FCFA'}</strong></span>
                              : <span className="admin-supplier-cost-missing">À renseigner</span>}
                            <div className="admin-supplier-cost-editor">
                              <input aria-label={`Prix d’achat fournisseur pour ${product.name}`} inputMode="decimal" min="0" placeholder="Prix d’achat" step="any" type="number" value={supplierCostDrafts[id]?.price ?? ''} onChange={(event) => setSupplierCostDrafts((current) => ({ ...current, [id]: { ...(current[id] ?? { price: '', currency: 'FCFA' }), price: event.target.value } }))} />
                              <select aria-label={`Devise du prix d’achat pour ${product.name}`} value={supplierCostDrafts[id]?.currency ?? 'FCFA'} onChange={(event) => setSupplierCostDrafts((current) => ({ ...current, [id]: { ...(current[id] ?? { price: '', currency: 'FCFA' }), currency: event.target.value === 'CNY' ? 'CNY' : 'FCFA' } }))}>
                                <option value="FCFA">FCFA</option><option value="CNY">Yuan</option>
                              </select>
                              <button className="admin-list-action" disabled={savingSupplierCostId === id} onClick={() => void saveSupplierCost(id)} type="button">{savingSupplierCostId === id ? '...' : 'Enregistrer'}</button>
                            </div>
                          </div>}
                        </>
                      )}
                    </div>
                    <b>{getDisplayedUnitPrice(product, appSettings).toLocaleString('fr-FR')} FCFA</b>
                    <span className={`admin-product-status ${product.active ? 'is-live' : 'is-hidden'}`}>{product.active ? 'En ligne' : 'Masqué'}</span>
                    {product.origin === 'local' && (
                      <div className="admin-local-stock-actions">
                        <label><span className="sr-only">Quantité de stock pour {product.name}</span><input aria-label={`Quantité en stock pour ${product.name}`} min="1" step="1" type="number" value={stockQuantities[id] ?? String(product.local_stock ?? '')} onChange={(event) => setStockQuantities((current) => ({ ...current, [id]: event.target.value }))} /></label>
                        <button className="admin-stock-confirm" disabled={confirmingStockId === id} onClick={() => void confirmLocalStock(product)} type="button"><Check aria-hidden="true" size={16} />{confirmingStockId === id ? 'Confirmation...' : 'Confirmer le stock aujourd’hui'}</button>
                      </div>
                    )}
                    <Link className="admin-list-action" href={`/admin/produits/${encodeURIComponent(id)}`} aria-label={`Modifier ${product.name}`}><Pencil aria-hidden="true" size={16} /></Link>
                    <button className="admin-list-action" type="button" onClick={() => void toggleProduct(product)} aria-label={`${product.active ? 'Masquer' : 'Publier'} ${product.name}`}>{product.active ? <EyeOff aria-hidden="true" size={16} /> : <Eye aria-hidden="true" size={16} />}</button>
                    <button className="admin-list-action is-danger" type="button" disabled={deletingProductId === id} onClick={() => void deleteProduct(product)} aria-label={`Supprimer ou archiver ${product.name}`}>{deletingProductId === id ? '...' : <Trash2 aria-hidden="true" size={16} />}</button>
                  </li>
                )
              })}
            </ul>
          )}
          <Link className="admin-catalog-link" href="/">Voir le catalogue <span aria-hidden="true">→</span></Link>
        </section>
      </div>
    </main>
  )
}
