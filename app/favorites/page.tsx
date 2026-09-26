'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

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

  useEffect(() => {
    let active = true
    async function loadFavorites() {
      const { data: userData, error: authError } = await supabase.auth.getUser()
      if (!active) return
      if (authError || !userData.user) {
        setLoading(false)
        return
      }
      setSignedIn(true)

      const { data, error } = await supabase
        .from('favorites')
        .select('products(id, name, price, image_url, category, moq)')
      if (!active) return
      if (error) setErrorMessage(error.message)
      else {
        const favoriteProducts = (data ?? [])
          .flatMap((favorite) => favorite.products)
          .filter((product): product is FavoriteProduct => Boolean(product))
        setProducts(favoriteProducts)
      }
      setLoading(false)
    }
    void loadFavorites()
    return () => {
      active = false
    }
  }, [])

  return (
    <main className="orders-page">
      <div className="orders-shell">
        <header className="orders-heading">
          <p className="eyebrow">VOTRE SÉLECTION</p>
          <h1>Favoris</h1>
          <p>Retrouvez ici les produits gardés pour plus tard.</p>
        </header>
        {loading ? (
          <div className="orders-state" role="status">Chargement de vos favoris...</div>
        ) : !signedIn ? (
          <section className="orders-state orders-empty">
            <span className="destination-icon" aria-hidden="true">♡</span>
            <h2>Connectez-vous pour retrouver vos favoris</h2>
            <p>Vos produits enregistrés sont associés à votre compte.</p>
            <Link className="destination-action" href="/login?next=%2Ffavorites">Se connecter</Link>
          </section>
        ) : errorMessage ? (
          <div className="orders-state orders-error" role="alert">Impossible de charger vos favoris : {errorMessage}</div>
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