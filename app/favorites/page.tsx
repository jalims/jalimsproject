'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { logClientError } from '../../lib/user-facing-errors'
import ConnectionError from '../ui/connection-error'
import { ProductGridSkeleton } from '../ui/loading-skeletons'

type FavoriteProduct = {
  id: string
  name: string
  price: number
  image_url: string | null
  category: string | null
  moq: number
}

export default function FavoritesPage() {
  const [loading, setLoading] = useState(true)
  const [signedIn, setSignedIn] = useState(false)
  const [products, setProducts] = useState<FavoriteProduct[]>([])
  const [errorMessage, setErrorMessage] = useState('')
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    let active = true
    async function loadFavorites() {
      setLoading(true)
      setErrorMessage('')
      try {
        const { data: userData, error: authError } = await supabase.auth.getUser()
        if (!active) return
        if (authError && authError.name !== 'AuthSessionMissingError') {
          logClientError('Favorites authentication check failed', authError)
          setErrorMessage('La connexion est lente ou coupée.')
          setLoading(false)
          return
        }
        if (authError?.name === 'AuthSessionMissingError' || !userData.user) {
          setSignedIn(false)
          setLoading(false)
          return
        }
        setSignedIn(true)

        const { data, error } = await supabase
          .from('favorites')
          .select('products(id, name, price, image_url, category, moq)')
        if (!active) return
        if (error) {
          logClientError('Favorites load failed', error)
          setErrorMessage('La connexion est lente ou coupée.')
        } else {
          const favoriteProducts = (data ?? [])
            .flatMap((favorite) => favorite.products)
            .filter((product): product is FavoriteProduct => Boolean(product))
          setProducts(favoriteProducts)
        }
        setLoading(false)
      } catch (error) {
        if (!active) return
        logClientError('Favorites load failed', error)
        setErrorMessage('La connexion est lente ou coupée.')
        setLoading(false)
      }
    }
    void loadFavorites()
    return () => {
      active = false
    }
  }, [retryCount])

  return (
    <main className="orders-page">
      <div className="orders-shell">
        <header className="orders-heading">
          <p className="eyebrow">VOTRE SÉLECTION</p>
          <h1>Favoris</h1>
          <p>Retrouvez ici les produits gardés pour plus tard.</p>
        </header>
        {loading ? (
          <ProductGridSkeleton count={6} mode="favorites" />
        ) : errorMessage ? (
          <ConnectionError onRetry={() => setRetryCount((count) => count + 1)} />
        ) : !signedIn ? (
          <section className="orders-state orders-empty">
            <span className="destination-icon" aria-hidden="true">♡</span>
            <h2>Connectez-vous pour retrouver votre liste de favoris</h2>
            <Link className="destination-action" href="/login?next=%2Ffavorites">Se connecter</Link>
          </section>
        ) : products.length === 0 ? (
          <section className="orders-state orders-empty">
            <span className="destination-icon" aria-hidden="true">♡</span>
            <h2>Aucun favori pour le moment</h2>
            <p>Touchez le cœur d’un produit pour le retrouver ici.</p>
            <Link className="destination-action" href="/">Découvrir les produits</Link>
          </section>
        ) : (
          <div className="product-grid">
            {products.map((product) => (
              <article className="product-card" key={product.id}>
                <Link className="product-image-link" href={`/products/${encodeURIComponent(product.id)}`}>
                  <div className="product-image">
                    {product.image_url ? <Image src={product.image_url} alt={product.name} fill sizes="(max-width: 719px) 50vw, 33vw" unoptimized /> : <span className="image-placeholder">J</span>}
                  </div>
                </Link>
                <div className="product-details">
                  <h3><Link href={`/products/${encodeURIComponent(product.id)}`}>{product.name}</Link></h3>
                  <p className="product-price">{Number(product.price).toLocaleString('fr-FR')} <span>FCFA</span></p>
                  <Link className="order-button" href={`/products/${encodeURIComponent(product.id)}`}>Voir le produit <span aria-hidden="true">→</span></Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}