'use client'

import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { Check, Eye, EyeOff, ImageOff, Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { canAccessAdminPath } from '../../../../lib/admin-staff-client'
import { isLocalStockWarning } from '../../../../lib/product-origin'
import { logClientError } from '../../../../lib/user-facing-errors'
import { supabase } from '../../../../lib/supabase'
import { useAdminSession } from '../../admin-session-provider'
import { getDisplayedUnitPrice, DEFAULT_APP_PRICING_SETTINGS, normalizeAppPricingSettings, type AppPricingSettings } from '../../../../lib/imported-product-pricing'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Input,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Skeleton,
  Tabs,
  useToast,
  type DataTableColumn,
} from '../../_components'
import { formatStockUpdatedAt, PRODUCT_SELECT_COLUMNS, requestAdminProducts, type Product, type SupplierCost } from './product-data'

type ProductFilter = 'all' | 'active' | 'hidden' | 'import_missing_purchase'

const productsPageSize = 20

export default function CatalogPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const globalQuery = searchParams.get('q') ?? ''
  const { userId, role: staffRole, loading: sessionLoading, error: sessionError } = useAdminSession()
  const { toast } = useToast()
  const [products, setProducts] = useState<Product[]>([])
  const [supplierCostDrafts, setSupplierCostDrafts] = useState<Record<string, { price: string; currency: 'FCFA' | 'CNY' }>>({})
  const [savingSupplierCostId, setSavingSupplierCostId] = useState<string | null>(null)
  const [savingProductActionId, setSavingProductActionId] = useState<string | null>(null)
  const [productsError, setProductsError] = useState('')
  const [searchValue, setSearchValue] = useState(globalQuery)
  const [debouncedSearch, setDebouncedSearch] = useState(globalQuery)
  const [productFilter, setProductFilter] = useState<ProductFilter>('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [pendingDelete, setPendingDelete] = useState<Product | null>(null)
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null)
  const [stockQuantities, setStockQuantities] = useState<Record<string, string>>({})
  const [confirmingStockId, setConfirmingStockId] = useState<string | null>(null)
  const [loadingProducts, setLoadingProducts] = useState(true)
  const [appSettings, setAppSettings] = useState<AppPricingSettings>(DEFAULT_APP_PRICING_SETTINGS)

  const loadProducts = useCallback(async () => {
    setLoadingProducts(true)
    setProductsError('')
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
    let costLoadError = ''
    if (canViewCosts && rows.length > 0) {
      const { data: costs, error: costsError } = await supabase
        .from('product_costs')
        .select('product_id, purchase_price, currency')
        .in('product_id', rows.map((product) => String(product.id)))
      if (costsError) {
        logClientError('Admin supplier costs load failed', costsError)
        costLoadError = 'Le catalogue est chargé, mais les coûts fournisseur n’ont pas pu être récupérés.'
      } else {
        costsByProductId = Object.fromEntries((costs ?? []).map((cost) => [String(cost.product_id), {
          purchase_price: cost.purchase_price == null ? null : Number(cost.purchase_price),
          currency: cost.currency === 'CNY' ? 'CNY' : cost.currency === 'FCFA' ? 'FCFA' : null,
        }]))
      }
    }

    const merged = rows.map((product) => ({ ...product, supplier_cost: costsByProductId[String(product.id)] ?? null }))
    setProducts(merged)
    setProductsError(costLoadError)
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

  const handleDebouncedSearch = useCallback((value: string) => {
    setDebouncedSearch(value)
    setCurrentPage(1)
  }, [])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => {
      if (!active) return
      setSearchValue(globalQuery)
      setDebouncedSearch(globalQuery)
      setCurrentPage(1)
    })
    return () => { active = false }
  }, [globalQuery])

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
      toast({ title: 'Prix invalide', description: 'Le prix d’achat fournisseur doit être un nombre positif ou vide.', variant: 'danger' })
      return
    }

    setSavingSupplierCostId(productId)
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
      toast({ title: 'Prix fournisseur enregistré', variant: 'success' })
    } catch (error) {
      logClientError('Admin supplier cost save failed', error)
      toast({ title: 'Enregistrement impossible', description: 'Le prix d’achat fournisseur n’a pas pu être enregistré.', variant: 'danger' })
    } finally {
      setSavingSupplierCostId(null)
    }
  }

  async function toggleProduct(product: Product) {
    const id = String(product.id)
    setSavingProductActionId(id)
    const { error } = await requestAdminProducts('PATCH', {
      id: product.id,
      action: 'set-active',
      active: !product.active,
    })
    setSavingProductActionId(null)
    if (error) {
      toast({ title: 'Modification impossible', description: error, variant: 'danger' })
      return
    }
    toast({ title: product.active ? 'Produit masqué' : 'Produit publié', variant: 'success' })
    await loadProducts()
  }

  async function deleteProduct(product: Product) {
    const id = String(product.id)
    setDeletingProductId(id)
    const { error, data } = await requestAdminProducts('DELETE', { id: product.id })
    setDeletingProductId(null)
    if (error) {
      toast({ title: 'Suppression impossible', description: error, variant: 'danger' })
      return
    }

    setPendingDelete(null)
    toast({
      title: data?.archived ? 'Produit archivé' : 'Produit supprimé',
      description: data?.archived
        ? `« ${product.name} » reste masqué car il est lié à des commandes.`
        : `« ${product.name} » a été retiré avec ses photos et ses coûts.`,
      variant: 'success',
    })
    await loadProducts()
  }

  async function confirmLocalStock(product: Product) {
    const id = String(product.id)
    const localStock = Number(stockQuantities[id] ?? product.local_stock)
    if (!Number.isInteger(localStock) || localStock <= 0) {
      toast({ title: 'Stock invalide', description: 'La quantité en stock doit être un entier supérieur à zéro.', variant: 'danger' })
      return
    }

    setConfirmingStockId(id)
    const { error } = await requestAdminProducts('PATCH', {
      id: product.id,
      action: 'confirm-stock',
      localStock,
    })
    setConfirmingStockId(null)
    if (error) {
      toast({ title: 'Confirmation du stock impossible', description: error, variant: 'danger' })
      return
    }
    toast({ title: 'Stock confirmé', description: `Stock confirmé pour ${product.name}.`, variant: 'success' })
    await loadProducts()
  }

  const isOwnerOrAdmin = staffRole === 'owner' || staffRole === 'admin'
  const activeProducts = products.filter((product) => product.active).length
  const hiddenProducts = products.length - activeProducts
  const importedMissingPurchaseCount = products.filter((product) => product.origin === 'import' && product.supplier_cost?.purchase_price == null).length
  const filteredProducts = useMemo(() => {
    const normalizedQuery = debouncedSearch.trim().toLocaleLowerCase()
    return products.filter((product) => {
      const matchesSearch = `${product.name} ${product.category ?? ''}`.toLocaleLowerCase().includes(normalizedQuery)
      const matchesFilter = productFilter === 'all'
        || (productFilter === 'active' && product.active)
        || (productFilter === 'hidden' && !product.active)
        || (productFilter === 'import_missing_purchase' && product.origin === 'import' && product.supplier_cost?.purchase_price == null)
      return matchesSearch && matchesFilter
    })
  }, [debouncedSearch, productFilter, products])
  const pageCount = Math.max(1, Math.ceil(filteredProducts.length / productsPageSize))
  const safePage = Math.min(currentPage, pageCount)
  const paginatedProducts = filteredProducts.slice((safePage - 1) * productsPageSize, safePage * productsPageSize)
  const filterTabs = [
    { id: 'all', label: 'Tous', count: products.length },
    { id: 'active', label: 'En ligne', count: activeProducts },
    { id: 'hidden', label: 'Masqués', count: hiddenProducts },
    { id: 'import_missing_purchase', label: 'Importés sans prix d’achat', count: importedMissingPurchaseCount },
  ]

  const columns: DataTableColumn<Product>[] = [
    {
      key: 'image',
      label: 'Image',
      render: (product) => (
        <div className="admin-list-image">
          {product.image_url
            ? <Image src={product.image_url} alt="" fill sizes="48px" unoptimized />
            : <ImageOff size={18} aria-label={`Aucune image pour ${product.name}`} />}
        </div>
      ),
    },
    {
      key: 'name',
      label: 'Nom',
      render: (product) => (
        <div>
          <strong>{product.name}</strong>
          {product.featured && <div><Badge variant="brand">Vedette</Badge></div>}
        </div>
      ),
    },
    {
      key: 'category',
      label: 'Catégorie',
      render: (product) => product.category || 'Sans catégorie',
    },
    {
      key: 'status',
      label: 'Statut',
      render: (product) => <Badge variant={product.active ? 'success' : 'neutral'}>{product.active ? 'En ligne' : 'Masqué'}</Badge>,
    },
    {
      key: 'origin',
      label: 'Origine',
      render: (product) => <Badge variant={product.origin === 'local' ? 'info' : 'brand'}>{product.origin === 'local' ? 'Local' : 'Import Chine'}</Badge>,
    },
    {
      key: 'stock-cost',
      label: isOwnerOrAdmin ? 'Stock / coût fournisseur' : 'Stock',
      render: (product) => {
        const id = String(product.id)
        if (product.origin === 'local') {
          return (
            <div className="admin-ui-product-stock">
              <span className={isLocalStockWarning(product) ? 'admin-local-stock-warning' : ''}>
                {product.local_stock} en stock{isLocalStockWarning(product) ? ' · À confirmer' : ''}
              </span>
              <Input
                label={`Quantité en stock pour ${product.name}`}
                type="number"
                min="1"
                step="1"
                value={stockQuantities[id] ?? String(product.local_stock ?? '')}
                onChange={(event) => setStockQuantities((current) => ({ ...current, [id]: event.currentTarget.value }))}
              />
              <Button
                size="sm"
                variant="outline"
                leadingIcon={<Check size={15} aria-hidden="true" />}
                loading={confirmingStockId === id}
                onClick={() => void confirmLocalStock(product)}
              >
                Confirmer le stock
              </Button>
              <small>Mis à jour le {formatStockUpdatedAt(product.stock_updated_at)}</small>
            </div>
          )
        }

        if (!isOwnerOrAdmin) return <span>Géré par le fournisseur · MOQ {product.moq}</span>

        return (
          <div className="admin-ui-product-cost">
            <span>
              Coût actuel:{' '}
              <strong>
                {product.supplier_cost?.purchase_price != null
                  ? `${Number(product.supplier_cost.purchase_price).toLocaleString('fr-FR')} ${product.supplier_cost.currency ?? 'FCFA'}`
                  : 'Non renseigné'}
              </strong>
            </span>
            <Input
              label={`Prix d’achat fournisseur pour ${product.name}`}
              inputMode="decimal"
              type="number"
              min="0"
              step="any"
              placeholder="Prix d’achat"
              value={supplierCostDrafts[id]?.price ?? ''}
              onChange={(event) => setSupplierCostDrafts((current) => ({
                ...current,
                [id]: { ...(current[id] ?? { price: '', currency: 'FCFA' }), price: event.currentTarget.value },
              }))}
            />
            <Select
              label={`Devise du prix d’achat pour ${product.name}`}
              value={supplierCostDrafts[id]?.currency ?? 'FCFA'}
              onChange={(event) => setSupplierCostDrafts((current) => ({
                ...current,
                [id]: { ...(current[id] ?? { price: '', currency: 'FCFA' }), currency: event.currentTarget.value === 'CNY' ? 'CNY' : 'FCFA' },
              }))}
            >
              <option value="FCFA">FCFA</option>
              <option value="CNY">Yuan (CNY)</option>
            </Select>
            <Button
              size="sm"
              variant="outline"
              loading={savingSupplierCostId === id}
              onClick={() => void saveSupplierCost(id)}
            >
              Enregistrer le coût
            </Button>
          </div>
        )
      },
    },
    {
      key: 'price-moq',
      label: 'Prix / MOQ',
      render: (product) => (
        <div>
          <strong>{getDisplayedUnitPrice(product, appSettings).toLocaleString('fr-FR')} FCFA</strong>
          <div>MOQ {product.moq}</div>
        </div>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (product) => {
        const id = String(product.id)
        return (
          <div className="admin-ui-product-actions">
            <Button
              size="sm"
              variant="outline"
              leadingIcon={<Pencil size={15} aria-hidden="true" />}
              onClick={() => router.push(`/admin/produits/${encodeURIComponent(id)}`)}
            >
              Modifier
            </Button>
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={product.active ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
              loading={savingProductActionId === id}
              aria-label={product.active ? `Masquer ${product.name}` : `Publier ${product.name}`}
              onClick={() => void toggleProduct(product)}
            >
              {product.active ? 'Masquer' : 'Publier'}
            </Button>
            <Button
              size="sm"
              variant="danger"
              leadingIcon={<Trash2 size={15} aria-hidden="true" />}
              loading={deletingProductId === id}
              aria-label={`Supprimer ou archiver ${product.name}`}
              onClick={() => setPendingDelete(product)}
            >
              Supprimer
            </Button>
          </div>
        )
      },
    },
  ]

  if (sessionLoading) {
    return (
      <main className="admin-page" aria-busy="true">
        <div className="admin-shell">
          <Skeleton variant="rect" height={72} />
          <Skeleton variant="rect" height={420} />
        </div>
      </main>
    )
  }

  if (sessionError || !userId || !canAccessAdminPath(staffRole, '/admin/produits')) {
    const denied = Boolean(userId && staffRole)
    return (
      <main className="admin-page">
        <section className="admin-access-state">
          <p className="eyebrow">ESPACE D’ADMINISTRATION</p>
          <h1>{sessionError ? 'Connexion momentanément indisponible' : !userId ? 'Connexion requise' : denied ? 'Accès refusé' : 'Accès réservé'}</h1>
          <p>{sessionError ? sessionError : !userId ? 'Connectez-vous avec un compte autorisé pour gérer le catalogue.' : denied ? 'Votre rôle ne permet pas d’accéder à cette page.' : 'Ce compte ne dispose pas du rôle administrateur.'}</p>
          {!userId && <Button onClick={() => router.push('/login?next=%2Fadmin%2Fproduits')}>Se connecter</Button>}
          {denied && staffRole === 'order_manager' && <Button variant="outline" onClick={() => router.push('/admin/commandes')}>Aller aux commandes</Button>}
        </section>
      </main>
    )
  }

  const noProductsFound = products.length > 0 && filteredProducts.length === 0
  const catalogIsEmpty = products.length === 0 && !productsError

  return (
    <main className="admin-page">
      <div className="admin-shell">
        <PageHeader
          level={1}
          eyebrow="Catalogue"
          title="Produits"
          description="Recherchez, filtrez et gérez les produits du catalogue."
          actions={(
            <Button leadingIcon={<Plus size={17} aria-hidden="true" />} onClick={() => router.push('/admin/produits/nouveau')}>
              Ajouter un produit
            </Button>
          )}
        />

        <Card title="Catalogue" description={`${products.length} produit${products.length === 1 ? '' : 's'}`}>
          <div className="admin-ui-product-toolbar">
            <SearchInput
              value={searchValue}
              onChange={(value) => {
                setSearchValue(value)
                setCurrentPage(1)
              }}
              onDebouncedChange={handleDebouncedSearch}
              label="Rechercher dans les produits"
              placeholder="Nom ou catégorie"
            />
            <Tabs
              label="Filtrer les produits"
              items={filterTabs}
              value={productFilter}
              onChange={(value) => {
                setProductFilter(value as ProductFilter)
                setCurrentPage(1)
              }}
            />
          </div>

          {productsError && <p className="admin-ui-inline-error" role="alert">{productsError}</p>}
          {productsError && products.length > 0 && (
            <Button variant="outline" onClick={() => void loadProducts()}>Réessayer</Button>
          )}

          {productsError && products.length === 0 && !loadingProducts ? (
            <Button variant="outline" onClick={() => void loadProducts()}>Réessayer</Button>
          ) : noProductsFound ? (
            <p className="admin-ui-no-results" role="status">Aucun produit ne correspond à ces critères.</p>
          ) : (
            <DataTable
              columns={columns}
              rows={paginatedProducts}
              rowKey={(product) => product.id}
              caption="Catalogue des produits"
              loading={loadingProducts}
              emptyState={catalogIsEmpty
                ? <EmptyState title="Aucun produit pour le moment" description="Ajoutez le premier produit au catalogue." action={<Button leadingIcon={<Plus size={16} aria-hidden="true" />} onClick={() => router.push('/admin/produits/nouveau')}>Ajouter un produit</Button>} />
                : <span>Aucun produit ne correspond à ces critères.</span>}
            />
          )}

          {!loadingProducts && filteredProducts.length > 0 && (
            <Pagination
              page={safePage}
              pageSize={productsPageSize}
              totalItems={filteredProducts.length}
              onPageChange={setCurrentPage}
              label="Pagination du catalogue de produits"
            />
          )}
        </Card>

      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => {
          if (deletingProductId === null) setPendingDelete(null)
        }}
        onConfirm={() => {
          if (pendingDelete) void deleteProduct(pendingDelete)
        }}
        title="Supprimer ou archiver ce produit ?"
        description={pendingDelete
          ? `Si « ${pendingDelete.name} » est lié à des commandes, il sera archivé et restera masqué sans effacer l’historique. Sinon, il sera supprimé avec ses photos et ses coûts.`
          : 'Confirmez cette action.'}
        confirmLabel="Supprimer ou archiver"
        confirmVariant="danger"
        loading={deletingProductId !== null}
      />
    </main>
  )
}
