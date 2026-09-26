'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

export default function FavoriteButton({ productId, productName }: { productId: string; productName: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [favorite, setFavorite] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let active = true
    void supabase.auth.getUser().then(async ({ data }) => {
      if (!active || !data.user) return
      setUserId(data.user.id)
      const { data: saved, error } = await supabase
        .from('favorites')
        .select('product_id')
        .eq('user_id', data.user.id)
        .eq('product_id', productId)
        .maybeSingle()
      if (active && !error) setFavorite(Boolean(saved))
    })
    return () => {
      active = false
    }
  }, [productId])

  async function toggleFavorite() {
    setErrorMessage('')
    if (!userId) {
      router.push(`/login?next=${encodeURIComponent(pathname)}`)
      return
    }

    setLoading(true)
    const result = favorite
      ? await supabase.from('favorites').delete().eq('user_id', userId).eq('product_id', productId)
      : await supabase.from('favorites').insert({ user_id: userId, product_id: productId })
    setLoading(false)

    if (result.error) setErrorMessage(result.error.message)
    else setFavorite(!favorite)
  }

  return (
    <>
      <button
        className={`favorite-toggle${favorite ? ' saved' : ''}`}
        type="button"
        aria-label={favorite ? `Retirer ${productName} des favoris` : `Ajouter ${productName} aux favoris`}
        aria-pressed={favorite}
        disabled={loading}
        onClick={() => void toggleFavorite()}
      >
        <svg viewBox="0 0 24 24" fill={favorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20.2 8.65c0 4.15-8.2 9.35-8.2 9.35S3.8 12.8 3.8 8.65A4.15 4.15 0 0 1 12 6.9a4.15 4.15 0 0 1 8.2 1.75Z" />
        </svg>
      </button>
      {errorMessage && <span className="favorite-error" role="alert">Favori non enregistré : {errorMessage}</span>}
    </>
  )
}
