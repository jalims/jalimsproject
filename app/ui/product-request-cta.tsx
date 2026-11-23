'use client'

import { useEffect, useState } from 'react'
import ProductRequestForm from './product-request-form'

type Props = {
  initialSearchQuery?: string
  variant: 'empty' | 'few-results'
}

export default function ProductRequestCta({ initialSearchQuery = '', variant }: Props) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const trimmedSearch = initialSearchQuery.trim()
  const emptyTitle = trimmedSearch
    ? `Tu ne trouves pas « ${trimmedSearch} » ? Envoie-nous le produit ou le lien, on te donne le prix tout compris sous 24h.`
    : 'Tu ne trouves pas ? Envoie-nous le produit ou le lien, on te donne le prix tout compris sous 24h.'

  return (
    <>
      {variant === 'empty' ? (
        <div className="product-request-empty-cta">
          <p className="product-request-empty-title">{emptyTitle}</p>
          <button type="button" className="product-request-open-button" onClick={() => setOpen(true)}>
            Je ne trouve pas mon produit
          </button>
        </div>
      ) : (
        <div className="product-request-few-cta">
          <button type="button" className="product-request-few-link" onClick={() => setOpen(true)}>
            Tu ne trouves pas ton produit ? Envoie-nous le lien ou une photo
          </button>
        </div>
      )}

      {open && (
        <div className="product-request-overlay" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="product-request-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Je ne trouve pas mon produit"
            onClick={(event) => event.stopPropagation()}
          >
            <ProductRequestForm initialSearchQuery={initialSearchQuery} onClose={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  )
}
