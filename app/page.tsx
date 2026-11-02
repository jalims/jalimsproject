'use client'

import { Suspense, useDeferredValue, useEffect, useRef, useState, type FormEvent } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { MessageCircle, Search } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { logClientError } from '../lib/user-facing-errors'
import { hasFreshLocalStock } from '../lib/product-origin'
import FavoriteButton from './ui/favorite-button'
import QuantityInput from './ui/quantity-input'
import ConnectionError from './ui/connection-error'
import ProductOriginBadge from './ui/product-origin-badge'
import { HomeSkeleton, ProductGridSkeleton } from './ui/loading-skeletons'
import {
  defaultHomepageContent,
  defaultHomepageDesignContent,
  getHomepageDesignContent,
  type HomepageContent,
  type HomepageDesignContent,
} from '../lib/homepage-content'
import {
  HomepageBenefits,
  HomepageFeaturedHeading,
  HomepageHero,
  HomepageProcess,
  HomepageTopBand,
} from './ui/homepage-redesign-sections'
import { trackSearch } from '../lib/analytics'

type Product = {
  id: string | number
  name: string
  price: number
  image_url: string | null
  category: string | null
  moq: number
  stock_status: string
  active: boolean
  featured: boolean
  origin: string
  local_stock: number | null
  city: string | null
  delivery_delay: string | null
  stock_updated_at: string | null
}

type OriginFilter = 'all' | 'local' | 'import'

type CategoryOption = {
  value: string
  label: string
  image_url: string | null
}

const categoryNames: Record<string, string> = {
  electronics: 'Électronique',
  electronique: 'Électronique',
  fashion: 'Mode',
  mode: 'Mode',
  home: 'Maison',
  maison: 'Maison',
  beauty: 'Beauté',
  beaute: 'Beauté',
}

function getCategoryLabel(category: string) {
  return categoryNames[category.trim().toLocaleLowerCase()] ?? category
}

function normalizeSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
}

function ProductImage({ product }: { product: Product }) {
  const [failed, setFailed] = useState(false)

  return (
    <div className="product-image">
      {product.image_url && !failed ? (
        <Image
          src={product.image_url}
          alt={product.name}
          fill
          sizes="(max-width: 719px) 50vw, 33vw"
          unoptimized
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="image-placeholder" aria-hidden="true">J</span>
      )}
    </div>
  )
}

function HomepageProductCard({
  product,
  quantity,
  onQuantityChange,
  onQuantityStep,
}: {
  product: Product
  quantity: string
  onQuantityChange: (value: string) => void
  onQuantityStep: (delta: number) => void
}) {
  const productKey = String(product.id)
  const minimumQuantity = product.moq ?? 1
  const parsedQuantity = Number.parseInt(quantity, 10)
  const orderQuantity = Number.isFinite(parsedQuantity) ? Math.max(minimumQuantity, parsedQuantity) : minimumQuantity
  const checkoutUrl = `/products/${encodeURIComponent(productKey)}?quantity=${orderQuantity}`

  return (
    <article className="product-card" key={productKey}>
      <Link className="product-image-link" href={`/products/${encodeURIComponent(productKey)}`} aria-label={`Voir ${product.name}`}>
        <ProductImage product={product} />
        {product.category && <span className="product-category-tag">{getCategoryLabel(product.category)}</span>}
      </Link>
      <FavoriteButton productId={productKey} productName={product.name} />
      <div className="product-details">
        <h3 title={product.name}>
          {product.featured && <span className="featured-product-mark" aria-label="Produit vedette">★</span>}
          <Link href={`/products/${encodeURIComponent(productKey)}`}>{product.name}</Link>
        </h3>
        <ProductOriginBadge
          origin={product.origin}
          localStock={product.local_stock}
          city={product.city}
          deliveryDelay={product.delivery_delay}
          stockUpdatedAt={product.stock_updated_at}
        />
        <p className="product-price">{Number(product.price).toLocaleString('fr-FR')} <span>FCFA</span></p>
        <div className="product-actions">
          <div className="quantity-control" aria-label={`Quantité de ${product.name}`}>
            <button type="button" aria-label="Diminuer la quantité" onClick={() => onQuantityStep(-1)}>−</button>
            <QuantityInput
              ariaLabel={`Quantité de ${product.name}`}
              minimum={minimumQuantity}
              value={quantity}
              onChange={onQuantityChange}
            />
            <button type="button" aria-label="Augmenter la quantité" onClick={() => onQuantityStep(1)}>+</button>
          </div>
          <Link className="order-button" href={checkoutUrl}>
            Commander <span aria-hidden="true">→</span>
          </Link>
        </div>
        {minimumQuantity > 1 && <small className="product-moq-note">Minimum : {minimumQuantity} unités</small>}
      </div>
    </article>
  )
}

function HomeContent() {
  const searchParams = useSearchParams()
  const urlSearch = searchParams.get('q') ?? ''
  const originParam = searchParams.get('origine')
  const originFilter: OriginFilter = originParam === 'local' || originParam === 'import' ? originParam : 'all'
  const [products, setProducts] = useState<Product[]>([])
  const [homepageContent, setHomepageContent] = useState<HomepageContent>(defaultHomepageContent)
  const [designContent, setDesignContent] = useState<HomepageDesignContent>(defaultHomepageDesignContent)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [retryCount, setRetryCount] = useState(0)
  const [search, setSearch] = useState(urlSearch)
  const [activeCategory, setActiveCategory] = useState('')
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [headerHidden, setHeaderHidden] = useState(false)
  const previousScrollY = useRef(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLElement>(null)
  const searchHistoryEntryRef = useRef(false)
  const deferredSearch = useDeferredValue(search)

  useEffect(() => {
    let cancelled = false

    async function loadProducts() {
      setLoading(true)
      setLoadError('')

      try {
        const [{ data, error }, { data: contentData }] = await Promise.all([
          supabase
            .from('products')
            .select('id, name, price, image_url, category, moq, stock_status, active, featured, origin, local_stock, city, delivery_delay, stock_updated_at')
            .eq('active', true),
          supabase.from('homepage_content').select('*').eq('id', 1).maybeSingle(),
        ])

        if (cancelled) return

        if (contentData) {
          setHomepageContent({ ...defaultHomepageContent, ...contentData })
          setDesignContent(getHomepageDesignContent(contentData.design_content))
        }

        if (error) {
          logClientError('Product catalog load failed', error)
          setLoadError('La connexion est lente ou coupée.')
        } else {
          setProducts((data ?? []) as Product[])
        }
        setLoading(false)
      } catch (error) {
        if (cancelled) return
        logClientError('Product catalog load failed', error)
        setLoadError('La connexion est lente ou coupée.')
        setLoading(false)
      }
    }

    void loadProducts()
    return () => {
      cancelled = true
    }
  }, [retryCount])

  useEffect(() => {
    function syncSearchFromHistory() {
      searchHistoryEntryRef.current = false
      setSearch(new URLSearchParams(window.location.search).get('q') ?? '')
    }

    window.addEventListener('popstate', syncSearchFromHistory)
    return () => window.removeEventListener('popstate', syncSearchFromHistory)
  }, [])

  useEffect(() => {
    function handleScroll() {
      const currentScrollY = window.scrollY
      const scrollDifference = currentScrollY - previousScrollY.current

      if (currentScrollY < 72) setHeaderHidden(false)
      else if (scrollDifference > 7) setHeaderHidden(true)
      else if (scrollDifference < -7) setHeaderHidden(false)

      previousScrollY.current = currentScrollY
    }

    previousScrollY.current = window.scrollY
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const categories: CategoryOption[] = Array.from(
    products.reduce((categoryMap, product) => {
      const category = product.category?.trim()
      if (category && !categoryMap.has(getCategoryLabel(category))) {
        categoryMap.set(getCategoryLabel(category), {
          value: category,
          label: getCategoryLabel(category),
          image_url: product.image_url,
        })
      }
      return categoryMap
    }, new Map<string, CategoryOption>()).values(),
  )

  const normalizedSearch = normalizeSearchText(deferredSearch.trim())
  const visibleProducts = products.filter((product) => {
    const searchableText = normalizeSearchText(`${product.name} ${product.category ?? ''}`)
    const matchesSearch = searchableText.includes(normalizedSearch)
    const matchesCategory = !activeCategory || product.category?.toLocaleLowerCase() === activeCategory.toLocaleLowerCase()
    const matchesOrigin = originFilter === 'all'
      || (originFilter === 'local' && hasFreshLocalStock(product))
      || (originFilter === 'import' && product.origin === 'import')
    return matchesSearch && matchesCategory && matchesOrigin
  })

  useEffect(() => {
    if (loading || loadError || search !== deferredSearch) return
    const timeout = window.setTimeout(() => trackSearch(deferredSearch, visibleProducts.length), 700)
    return () => window.clearTimeout(timeout)
  }, [deferredSearch, loadError, loading, search, visibleProducts.length])

  const markedProducts = products.filter((product) => product.featured)

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    searchInputRef.current?.blur()

    window.setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 250)
  }

  function changeSearch(value: string) {
    setSearch(value)
    const nextParams = new URLSearchParams(searchParams.toString())
    if (value.trim()) nextParams.set('q', value.trim())
    else nextParams.delete('q')
    const query = nextParams.toString()
    const nextUrl = query ? `/?${query}` : '/'
    const currentUrl = `${window.location.pathname}${window.location.search}`
    if (nextUrl !== currentUrl) {
      if (searchHistoryEntryRef.current) {
        window.history.replaceState(null, '', nextUrl)
      } else {
        window.history.pushState(null, '', nextUrl)
        searchHistoryEntryRef.current = true
      }
    }
  }

  function clearSearch() {
    changeSearch('')
  }

  function changeOriginFilter(filter: OriginFilter) {
    const nextParams = new URLSearchParams(searchParams.toString())
    if (filter === 'all') nextParams.delete('origine')
    else nextParams.set('origine', filter)
    const query = nextParams.toString()
    window.history.pushState(null, '', query ? `/?${query}` : '/')
  }

  function changeQuantity(productKey: string, delta: number) {
  const minimumQuantity = products.find((product) => String(product.id) === productKey)?.moq ?? 1
  setQuantities((current) => {
    const currentValue = current[productKey]
    const numericCurrent = currentValue === '' || currentValue === undefined ? minimumQuantity : Number(currentValue)
    return {
      ...current,
      [productKey]: String(Math.max(minimumQuantity, numericCurrent + delta)),
    }
  })
}

  if (loading) return <HomeSkeleton />

  return (
    <main className="shop-page market-home">
      <header className={`shop-header market-header${headerHidden ? ' market-header-hidden' : ''}`}>
        <HomepageTopBand design={designContent} />
        <div className="header-inner market-header-inner">
          <Link className="brand market-brand" href="/" aria-label="Jalims, accueil">
            Jalims<span>market</span>
          </Link>
          <form className="search-field market-search" role="search" onSubmit={submitSearch}>
            <Search className="search-lucide" aria-hidden="true" size={19} strokeWidth={2} />
            <input
              ref={searchInputRef}
              type="search"
              enterKeyHint="search"
              inputMode="search"
              autoComplete="off"
              autoCorrect="off"
              aria-label="Rechercher un produit"
              placeholder="Chercher un produit, une catégorie..."
              value={search}
              onChange={(event) => changeSearch(event.target.value)}
            />
            {search && (
              <button className="clear-search" type="button" onClick={clearSearch} aria-label="Effacer la recherche">×</button>
            )}
            <button className="market-search-submit" type="submit" aria-label="Rechercher">
              <Search aria-hidden="true" size={18} strokeWidth={2.3} />
            </button>
          </form>
        </div>
        <nav className="market-nav" aria-label="Catégories du catalogue">
          <div className="market-nav-inner">
            <button
              type="button"
              className={`market-nav-item ${activeCategory === '' ? 'active' : ''}`}
              aria-pressed={activeCategory === ''}
              onClick={() => setActiveCategory('')}
            >
              Tous les produits
            </button>
            {categories.map((category) => (
              <button
                type="button"
                className={`market-nav-item ${activeCategory === category.value ? 'active' : ''}`}
                key={category.value}
                aria-pressed={activeCategory === category.value}
                onClick={() => setActiveCategory(category.value)}
              >
                {category.label}
              </button>
            ))}
            <span className="market-nav-promise">Prix en FCFA <b>·</b> Retrait au Sénégal</span>
          </div>
        </nav>
      </header>

      <div className="market-content">
        <HomepageHero design={designContent} />
        <HomepageBenefits design={designContent} />

        <section className="home-redesign-featured" aria-label={designContent.featuredTitle}>
          <HomepageFeaturedHeading design={designContent} />
          {markedProducts.length > 0 ? (
            <div className="home-redesign-featured-row">
              {markedProducts.map((product) => {
                const productKey = String(product.id)
                return (
                  <HomepageProductCard
                    key={productKey}
                    product={product}
                    quantity={quantities[productKey] ?? String(product.moq ?? 1)}
                    onQuantityChange={(value) => setQuantities((current) => ({ ...current, [productKey]: value }))}
                    onQuantityStep={(delta) => changeQuantity(productKey, delta)}
                  />
                )
              })}
            </div>
          ) : (
            <p className="home-redesign-featured-empty">{designContent.featuredEmptyText}</p>
          )}
        </section>

        <HomepageProcess design={designContent} />

        <section className="market-categories" aria-labelledby="categories-title">
          <div className="market-section-heading">
            <div>
              <p className="eyebrow">TROUVEZ VOTRE UNIVERS</p>
              <h2 id="categories-title">Explorer les catégories</h2>
            </div>
            <span className="section-side-note">Des produits sélectionnés pour vous</span>
          </div>
          {categories.length > 0 ? (
            <div className="category-tiles">
              {categories.slice(0, 5).map((category, index) => (
                <button
                  type="button"
                  className={`category-tile category-tile-${index + 1}${activeCategory === category.value ? ' active' : ''}`}
                  key={category.value}
                  aria-pressed={activeCategory === category.value}
                  onClick={() => {
                    setActiveCategory(category.value)
                    document.getElementById('products')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                >
                  <span className="category-tile-image">
                    {category.image_url ? (
                      <Image src={category.image_url} alt="" fill sizes="130px" unoptimized />
                    ) : (
                      <span className="category-initial" aria-hidden="true">{category.label.slice(0, 1)}</span>
                    )}
                  </span>
                  <span className="category-tile-label">{category.label}<i aria-hidden="true">→</i></span>
                </button>
              ))}
            </div>
          ) : (
            <div className="category-empty">Les catégories apparaîtront ici dès que les produits seront publiés.</div>
          )}
        </section>

        <section className="catalog market-catalog" id="products" aria-label="Catalogue des produits" ref={resultsRef}>
          <div className="market-section-heading catalog-heading">
            <div>
              <p className="eyebrow">LA SÉLECTION JALIMS</p>
              <h2>
                {deferredSearch.trim() && !loading && !loadError
                  ? `Résultats pour « ${deferredSearch.trim()} » (${visibleProducts.length} produit${visibleProducts.length === 1 ? '' : 's'})`
                  : search || activeCategory
                    ? 'Vos résultats'
                    : 'Les trouvailles du moment'}
              </h2>
            </div>
            {!loading && !loadError && (
              <span className="catalog-result-count" aria-live="polite" aria-atomic="true">
                {visibleProducts.length} produit{visibleProducts.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {search !== deferredSearch && <span className="search-progress" role="status">Mise à jour des résultats...</span>}

          <div className="catalog-filter-bar" role="group" aria-label="Filtrer les produits">
            <button className={originFilter === 'all' ? 'active' : ''} type="button" aria-pressed={originFilter === 'all'} onClick={() => changeOriginFilter('all')}>Tous</button>
            <button className={originFilter === 'local' ? 'active' : ''} type="button" aria-pressed={originFilter === 'local'} onClick={() => changeOriginFilter('local')}>Disponible au Sénégal</button>
            <button className={originFilter === 'import' ? 'active' : ''} type="button" aria-pressed={originFilter === 'import'} onClick={() => changeOriginFilter('import')}>Import Chine</button>
          </div>

          {loading ? (
            <ProductGridSkeleton count={8} />
          ) : loadError ? (
            <ConnectionError onRetry={() => setRetryCount((count) => count + 1)} />
          ) : visibleProducts.length === 0 ? (
            <div className="catalog-state empty-state">
              <span className="empty-mark" aria-hidden="true">⌕</span>
              <strong>{deferredSearch.trim() ? `Aucun produit trouvé pour « ${deferredSearch.trim()} »` : 'Aucun produit trouvé'}</strong>
              {deferredSearch.trim() ? (
                <>
                  <span>Vérifiez l’orthographe ou essayez un mot plus court.</span>
                  <a href="#categories-title">Voir les catégories</a>
                </>
              ) : (
                <span>Essayez un autre mot ou choisissez une autre catégorie.</span>
              )}
            </div>
          ) : (
            <div className="product-grid">
              {visibleProducts.map((product) => {
                const productKey = String(product.id)
                return (
                  <HomepageProductCard
                    key={productKey}
                    product={product}
                    quantity={quantities[productKey] ?? String(product.moq ?? 1)}
                    onQuantityChange={(value) => setQuantities((current) => ({ ...current, [productKey]: value }))}
                    onQuantityStep={(delta) => changeQuantity(productKey, delta)}
                  />
                )
              })}
            </div>
          )}
        </section>
        <footer className="market-footer">
          <div className="market-footer-main">
            <div className="market-footer-brand-block">
              <Link className="market-footer-brand" href="/">Jalims</Link>
              <span>Le commerce sans frontières, à votre portée.</span>
            </div>
            <section className="market-footer-column" aria-labelledby="footer-about-title">
              <h2 id="footer-about-title">{homepageContent.footer_about_title}</h2>
              <p>{homepageContent.footer_about_text}</p>
            </section>
            <section className="market-footer-column market-footer-contact" aria-labelledby="footer-contact-title">
              <h2 id="footer-contact-title">{homepageContent.footer_contact_title}</h2>
              {homepageContent.footer_contact_email && <a href={`mailto:${homepageContent.footer_contact_email}`}>{homepageContent.footer_contact_email}</a>}
                {homepageContent.footer_contact_phone && <a href={`https://wa.me/${homepageContent.footer_contact_phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer"><MessageCircle aria-hidden="true" size={15} /> {homepageContent.footer_contact_phone}</a>}
            </section>
            <section className="market-footer-column" aria-labelledby="footer-social-title">
              <h2 id="footer-social-title">Suivez-nous</h2>
              <div className="market-footer-socials">
                {homepageContent.footer_tiktok_url && <a href={homepageContent.footer_tiktok_url} target="_blank" rel="noreferrer" aria-label="Jalims sur TikTok">TikTok</a>}
                {homepageContent.footer_youtube_url && <a href={homepageContent.footer_youtube_url} target="_blank" rel="noreferrer" aria-label="Jalims sur YouTube">YouTube</a>}
                {homepageContent.footer_instagram_url && <a href={homepageContent.footer_instagram_url} target="_blank" rel="noreferrer" aria-label="Jalims sur Instagram">Instagram</a>}
                {homepageContent.footer_facebook_url && <a href={homepageContent.footer_facebook_url} target="_blank" rel="noreferrer" aria-label="Jalims sur Facebook">Facebook</a>}
                {!homepageContent.footer_tiktok_url && !homepageContent.footer_youtube_url && !homepageContent.footer_instagram_url && !homepageContent.footer_facebook_url && <span className="market-footer-no-socials">Liens à venir</span>}
              </div>
            </section>
          </div>
          <div className="market-footer-bottom">
            <span>© {new Date().getFullYear()} Jalims</span>
            <span>Fait pour les commerçants du Sénégal</span>
            <Link className="legal-footer-link" href="/conditions">Conditions générales</Link>
          </div>
        </footer>
      </div>
    </main>
  )
}

export default function Home() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <HomeContent />
    </Suspense>
  )
}