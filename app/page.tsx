'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { MapPin, MessageCircle, Route, Search, ShieldCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { logClientError } from '../lib/user-facing-errors'
import FavoriteButton from './ui/favorite-button'
import QuantityInput from './ui/quantity-input'
import { defaultHomepageContent, type HomepageContent } from '../lib/homepage-content'

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
}

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

export default function Home() {
  const [products, setProducts] = useState<Product[]>([])
  const [homepageContent, setHomepageContent] = useState<HomepageContent>(defaultHomepageContent)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('')
  const [productFilter, setProductFilter] = useState<'all' | 'featured' | 'available'>('all')
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [headerHidden, setHeaderHidden] = useState(false)
  const previousScrollY = useRef(0)

  useEffect(() => {
    let cancelled = false

    async function loadProducts() {
      setLoading(true)
      setLoadError('')

      const [{ data, error }, { data: contentData }] = await Promise.all([
        supabase
          .from('products')
          .select('id, name, price, image_url, category, moq, stock_status, active, featured')
          .eq('active', true),
        supabase.from('homepage_content').select('*').eq('id', 1).maybeSingle(),
      ])

      if (cancelled) return

      if (contentData) setHomepageContent({ ...defaultHomepageContent, ...contentData })

      if (error) {
        logClientError('Product catalog load failed', error)
        setLoadError('Le catalogue est momentanément indisponible. Veuillez réessayer.')
      } else {
        setProducts((data ?? []) as Product[])
      }
      setLoading(false)
    }

    void loadProducts()
    return () => {
      cancelled = true
    }
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

  const visibleProducts = products.filter((product) => {
    const matchesSearch = product.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
    const matchesCategory = !activeCategory || product.category?.toLocaleLowerCase() === activeCategory.toLocaleLowerCase()
    const matchesFeatured = productFilter !== 'featured' || product.featured
    const matchesAvailability = productFilter !== 'available' || !['out_of_stock', 'rupture', 'unavailable', 'indisponible'].includes(product.stock_status.toLocaleLowerCase())
    return matchesSearch && matchesCategory && matchesFeatured && matchesAvailability
  })

  const markedProducts = products.filter((product) => product.featured)
  const featuredProducts = (markedProducts.length > 0 ? markedProducts : products).slice(0, 3)

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

  return (
    <main className="shop-page market-home">
      <header className={`shop-header market-header${headerHidden ? ' market-header-hidden' : ''}`}>
        <div className="market-utility">
          <div className="market-utility-inner">
            <span><i aria-hidden="true" /> {homepageContent.utility_primary}</span>
            <span>{homepageContent.utility_secondary}</span>
          </div>
        </div>
        <div className="header-inner market-header-inner">
          <Link className="brand market-brand" href="/" aria-label="Jalims, accueil">
            Jalims<span>market</span>
          </Link>
          <label className="search-field market-search">
            <Search className="search-lucide" aria-hidden="true" size={19} strokeWidth={2} />
            <span className="sr-only">Rechercher un produit</span>
            <input
              type="search"
              placeholder="Chercher un produit, une catégorie..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <button className="clear-search" type="button" onClick={() => setSearch('')} aria-label="Effacer la recherche">×</button>
            )}
            <button className="market-search-submit" type="button" aria-label="Rechercher">
              <Search aria-hidden="true" size={18} strokeWidth={2.3} />
            </button>
          </label>
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
        <section className="market-hero" aria-label="Bienvenue sur Jalims">
          <div className="market-hero-copy">
            <p className="market-kicker"><span /> {homepageContent.hero_kicker}</p>
            <h1>{homepageContent.hero_title.split(/\r?\n/).map((line, index) => <span key={`${line}-${index}`}>{line}</span>)}</h1>
            <p>{homepageContent.hero_description}</p>
            <a className="market-hero-cta" href="#products">{homepageContent.hero_cta} <span aria-hidden="true">→</span></a>
            <div className="market-local-note"><span className="senegal-mark" role="img" aria-label="Drapeau du Sénégal"><i /><i /><i /></span> {homepageContent.hero_local_note}</div>
          </div>
          <div className="market-hero-art" aria-label="Produits à découvrir">
            {featuredProducts.length > 0 ? (
              <div className="market-showcase">
                {featuredProducts.map((product, index) => (
                  <Link
                    className={`showcase-product showcase-product-${index + 1}`}
                    href={`/products/${encodeURIComponent(String(product.id))}`}
                    key={product.id}
                  >
                    <div className="showcase-image">
                      {product.image_url ? (
                        <Image src={product.image_url} alt={product.name} fill sizes="(max-width: 720px) 30vw, 18vw" unoptimized />
                      ) : (
                        <span className="image-placeholder" aria-hidden="true">J</span>
                      )}
                    </div>
                    <span className="showcase-caption">{product.name}</span>
                  </Link>
                ))}
                <span className="showcase-stamp">SÉLECTION<br />JALIMS</span>
              </div>
            ) : (
              <div className="hero-empty-art">
                <span className="hero-empty-mark">J</span>
                <span>Les découvertes<br />commencent ici</span>
              </div>
            )}
          </div>
          <span className="hero-index" aria-hidden="true">01 <i /> 03</span>
        </section>

        <section className="market-benefits" aria-label="Les services Jalims">
          <div className="benefit-item">
            <span className="benefit-symbol benefit-route" aria-hidden="true"><Route size={18} strokeWidth={2} /></span>
            <span><strong>{homepageContent.benefit_one_title}</strong><small>{homepageContent.benefit_one_description}</small></span>
          </div>
          <span className="benefit-divider" />
          <div className="benefit-item">
            <span className="benefit-symbol benefit-shield" aria-hidden="true"><ShieldCheck size={18} strokeWidth={2} /></span>
            <span><strong>{homepageContent.benefit_two_title}</strong><small>{homepageContent.benefit_two_description}</small></span>
          </div>
          <span className="benefit-divider" />
          <div className="benefit-item">
            <span className="benefit-symbol benefit-pin" aria-hidden="true"><MapPin size={18} strokeWidth={2} /></span>
            <span><strong>{homepageContent.benefit_three_title}</strong><small>{homepageContent.benefit_three_description}</small></span>
          </div>
        </section>

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

        <section className="catalog market-catalog" id="products" aria-label="Catalogue des produits">
          <div className="market-section-heading catalog-heading">
            <div>
              <p className="eyebrow">LA SÉLECTION JALIMS</p>
              <h2>{search || activeCategory ? 'Vos résultats' : 'Les trouvailles du moment'}</h2>
            </div>
            {!loading && !loadError && <span className="catalog-result-count">{visibleProducts.length} article{visibleProducts.length !== 1 ? 's' : ''}</span>}
          </div>

          <div className="catalog-filter-bar" role="group" aria-label="Filtrer les produits">
            <button className={productFilter === 'all' ? 'active' : ''} type="button" aria-pressed={productFilter === 'all'} onClick={() => setProductFilter('all')}>Tous</button>
            <button className={productFilter === 'featured' ? 'active' : ''} type="button" aria-pressed={productFilter === 'featured'} onClick={() => setProductFilter('featured')}>Produits vedettes</button>
            <button className={productFilter === 'available' ? 'active' : ''} type="button" aria-pressed={productFilter === 'available'} onClick={() => setProductFilter('available')}>Disponibles</button>
            {productFilter !== 'all' && (
              <button className="catalog-filter-reset" type="button" onClick={() => setProductFilter('all')}>Effacer le filtre</button>
            )}
          </div>

          {loading ? (
            <div className="catalog-state" role="status">Chargement...</div>
          ) : loadError ? (
            <div className="catalog-state" role="alert">
              <span>Les produits n’ont pas pu être chargés : {loadError}</span>
              <button type="button" onClick={() => window.location.reload()}>Réessayer</button>
            </div>
          ) : visibleProducts.length === 0 ? (
            <div className="catalog-state empty-state">
              <span className="empty-mark" aria-hidden="true">⌕</span>
              <strong>Aucun produit trouvé</strong>
              <span>Essayez un autre mot ou choisissez une autre catégorie.</span>
            </div>
          ) : (
            <div className="product-grid">
              {visibleProducts.map((product) => {
                const productKey = String(product.id)
                const minimumQuantity = product.moq ?? 1
                const quantity = quantities[productKey] ?? String(minimumQuantity)
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
                      <p className="product-price">{Number(product.price).toLocaleString('fr-FR')} <span>FCFA</span></p>
                      <div className="product-actions">
                        <div className="quantity-control" aria-label={`Quantité de ${product.name}`}>
  <button type="button" aria-label="Diminuer la quantité" onClick={() => changeQuantity(productKey, -1)}>−</button>
  <QuantityInput
    ariaLabel={`Quantité de ${product.name}`}
    minimum={minimumQuantity}
    value={quantity}
    onChange={(value) => setQuantities((current) => ({ ...current, [productKey]: value }))}
  />
  <button type="button" aria-label="Augmenter la quantité" onClick={() => changeQuantity(productKey, 1)}>+</button>
</div>
                        <Link className="order-button" href={checkoutUrl}>
                          Commander <span aria-hidden="true">→</span>
                        </Link>
                      </div>
                      {minimumQuantity > 1 && <small className="product-moq-note">Minimum : {minimumQuantity} unités</small>}
                    </div>
                  </article>
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
          </div>
        </footer>
      </div>
    </main>
  )
}