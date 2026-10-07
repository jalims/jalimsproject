'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Heart } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { logClientError } from '../../lib/user-facing-errors'

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

    if (result.error) {
      logClientError('Favorite update failed', result.error)
      setErrorMessage('Ce favori n’a pas pu être enregistré. Veuillez réessayer.')
    } else setFavorite(!favorite)
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
        <Heart aria-hidden="true" fill={favorite ? 'currentColor' : 'none'} size={20} strokeWidth={2} />
      </button>
      {errorMessage && <span className="favorite-error" role="alert">Favori non enregistré : {errorMessage}</span>}
    </>
  )
}
