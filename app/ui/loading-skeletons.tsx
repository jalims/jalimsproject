import type { ReactNode } from 'react'

type ProductGridSkeletonProps = {
  count?: number
  mode?: 'catalog' | 'favorites'
}

function SkeletonShape({ className = '' }: { className?: string }) {
  return <span className={`skeleton-shape ${className}`} aria-hidden="true" />
}

function SkeletonRegion({ children }: { children: ReactNode }) {
  return (
    <div className="skeleton-region" aria-busy="true">
      <span className="sr-only">Chargement…</span>
      {children}
    </div>
  )
}

export function ProductCardSkeleton({ mode = 'catalog' }: { mode?: ProductGridSkeletonProps['mode'] }) {
  return (
    <article className="product-card skeleton-card" aria-hidden="true">
      <div className="product-image skeleton-card-image"><SkeletonShape /></div>
      <div className="product-details skeleton-card-details">
        <SkeletonShape className="skeleton-card-title" />
        <SkeletonShape className="skeleton-card-price" />
        {mode === 'catalog' ? (
          <>
            <div className="skeleton-card-actions">
              <SkeletonShape className="skeleton-card-quantity" />
              <SkeletonShape className="skeleton-card-button" />
            </div>
            <SkeletonShape className="skeleton-card-note" />
          </>
        ) : (
          <SkeletonShape className="skeleton-card-button skeleton-favorite-button" />
        )}
      </div>
    </article>
  )
}

export function ProductGridSkeleton({
  count = 8,
  mode = 'catalog',
}: ProductGridSkeletonProps) {
  return (
    <SkeletonRegion>
      <div className="product-grid skeleton-grid">
        {Array.from({ length: count }, (_, index) => <ProductCardSkeleton key={index} mode={mode} />)}
      </div>
    </SkeletonRegion>
  )
}

export function HomeSkeleton() {
  return (
    <SkeletonRegion>
      <main className="shop-page market-home skeleton-home">
        <header className="shop-header market-header">
          <div className="market-utility"><div className="market-utility-inner"><SkeletonShape className="skeleton-home-utility" /><SkeletonShape className="skeleton-home-utility" /></div></div>
          <div className="header-inner market-header-inner">
            <SkeletonShape className="skeleton-home-brand" />
            <SkeletonShape className="skeleton-home-search" />
          </div>
          <nav className="market-nav" aria-hidden="true"><div className="market-nav-inner"><SkeletonShape className="skeleton-home-nav" /><SkeletonShape className="skeleton-home-nav" /><SkeletonShape className="skeleton-home-nav" /></div></nav>
        </header>
        <div className="market-content">
          <section className="market-hero skeleton-home-hero" aria-hidden="true">
            <div className="market-hero-copy">
              <SkeletonShape className="skeleton-home-kicker" />
              <SkeletonShape className="skeleton-home-title" />
              <SkeletonShape className="skeleton-home-description" />
              <SkeletonShape className="skeleton-home-description skeleton-home-description-short" />
              <SkeletonShape className="skeleton-home-cta" />
            </div>
            <div className="market-hero-art"><SkeletonShape className="skeleton-home-art" /></div>
          </section>
          <section className="market-benefits skeleton-home-benefits" aria-hidden="true">
            <SkeletonShape /><SkeletonShape /><SkeletonShape />
          </section>
          <section className="market-categories skeleton-home-categories" aria-hidden="true">
            <SkeletonShape className="skeleton-home-section-title" />
            <div className="skeleton-home-category-grid">{Array.from({ length: 5 }, (_, index) => <SkeletonShape key={index} />)}</div>
          </section>
          <section className="catalog market-catalog skeleton-home-catalog" aria-label="Chargement des produits">
            <div className="market-section-heading catalog-heading"><div><SkeletonShape className="skeleton-home-eyebrow" /><SkeletonShape className="skeleton-home-results-title" /></div><SkeletonShape className="skeleton-home-count" /></div>
            <div className="skeleton-home-filters"><SkeletonShape /><SkeletonShape /><SkeletonShape /></div>
            <ProductGridSkeleton count={8} />
          </section>
        </div>
      </main>
    </SkeletonRegion>
  )
}

export function ProductDetailSkeleton() {
  return (
    <SkeletonRegion>
      <main className="detail-page skeleton-detail-page">
        <div className="detail-shell">
          <SkeletonShape className="skeleton-detail-back" />
          <article className="detail-layout">
            <div className="detail-gallery">
              <div className="detail-image skeleton-detail-image"><SkeletonShape /></div>
              <div className="detail-gallery-thumbnails" aria-hidden="true">
                {Array.from({ length: 5 }, (_, index) => <SkeletonShape className="skeleton-detail-thumbnail" key={index} />)}
              </div>
            </div>
            <div className="detail-copy">
              <SkeletonShape className="skeleton-detail-category" />
              <SkeletonShape className="skeleton-detail-title" />
              <SkeletonShape className="skeleton-detail-price" />
              <SkeletonShape className="skeleton-detail-description" />
              <SkeletonShape className="skeleton-detail-description" />
              <SkeletonShape className="skeleton-detail-description skeleton-detail-description-short" />
              <SkeletonShape className="skeleton-detail-specs" />
              <SkeletonShape className="skeleton-detail-delivery" />
              <div className="detail-purchase">
                <SkeletonShape className="skeleton-detail-variant" />
                <SkeletonShape className="skeleton-detail-variant" />
                <SkeletonShape className="skeleton-detail-button" />
              </div>
            </div>
          </article>
        </div>
      </main>
    </SkeletonRegion>
  )
}

export function VariantCartSkeleton() {
  return (
    <SkeletonRegion>
      <main className="orders-page">
        <div className="orders-shell variant-cart-shell">
          <header className="orders-heading skeleton-cart-heading">
            <SkeletonShape className="skeleton-cart-kicker" />
            <SkeletonShape className="skeleton-cart-title" />
            <SkeletonShape className="skeleton-cart-subtitle" />
          </header>
          <section className="variant-cart-product skeleton-cart-product">
            <SkeletonShape className="skeleton-cart-product-image" />
            <div><SkeletonShape className="skeleton-cart-product-title" /><SkeletonShape className="skeleton-cart-product-note" /></div>
          </section>
          <div className="variant-cart-lines skeleton-cart-lines">
            {Array.from({ length: 3 }, (_, index) => (
              <article className="variant-cart-line skeleton-cart-line" key={index}>
                <SkeletonShape className="skeleton-cart-variant" />
                <SkeletonShape className="skeleton-cart-stock" />
                <SkeletonShape className="skeleton-cart-quantity" />
                <SkeletonShape className="skeleton-cart-total" />
                <SkeletonShape className="skeleton-cart-remove" />
              </article>
            ))}
          </div>
          <section className="variant-cart-checkout skeleton-cart-checkout">
            <SkeletonShape className="skeleton-cart-field" />
            <SkeletonShape className="skeleton-cart-field" />
            <SkeletonShape className="skeleton-cart-total-line" />
            <SkeletonShape className="skeleton-cart-button" />
          </section>
        </div>
      </main>
    </SkeletonRegion>
  )
}

export function OrdersListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <SkeletonRegion>
      <div className="orders-list skeleton-orders-list">
        {Array.from({ length: count }, (_, index) => (
          <article className="order-card skeleton-order-card" key={index}>
            <div className="order-card-heading">
              <div><SkeletonShape className="skeleton-order-caption" /><SkeletonShape className="skeleton-order-code" /></div>
              <SkeletonShape className="skeleton-order-status" />
            </div>
            <div className="order-tracking skeleton-order-tracking" aria-hidden="true">
              {Array.from({ length: 5 }, (_, step) => <SkeletonShape key={step} />)}
            </div>
            <div className="order-card-product">
              <SkeletonShape className="order-product-thumb skeleton-order-image" />
              <div className="order-product-name skeleton-order-product-info"><SkeletonShape /><SkeletonShape /><SkeletonShape /></div>
              <SkeletonShape className="skeleton-order-total" />
            </div>
            <div className="order-card-footer"><SkeletonShape className="skeleton-order-footer" /><SkeletonShape className="skeleton-order-footer" /></div>
          </article>
        ))}
      </div>
    </SkeletonRegion>
  )
}
