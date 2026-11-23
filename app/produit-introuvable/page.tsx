import type { Metadata } from 'next'
import ProductRequestForm from '../ui/product-request-form'

export const metadata: Metadata = {
  title: 'Produit introuvable | Jalims',
  description: 'Envoie-nous le produit ou le lien que tu cherches, on te donne le prix tout compris sous 24h sur WhatsApp.',
}

export default function ProduitIntrouvablePage() {
  return (
    <main className="product-request-page">
      <div className="product-request-page-inner">
        <ProductRequestForm />
      </div>
    </main>
  )
}
