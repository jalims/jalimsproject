import Link from 'next/link'
import { notFound } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import ProductImageGallery from './product-image-gallery'
import ProductPurchaseControls from './product-purchase-controls'

type ProductPageProps = {
  params: Promise<{ id: string }>
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { id } = await params
  const { data: product } = await supabase
    .from('products')
    .select('id, name, description, price, image_url, category, moq, stock_status, active')
    .eq('id', id)
    .eq('active', true)
    .maybeSingle()

  if (!product) notFound()

  const { data: galleryImages } = await supabase
    .from('product_images')
    .select('id, image_url, display_order')
    .eq('product_id', id)
    .order('display_order')

  const images = galleryImages?.length
    ? galleryImages
    : product.image_url ? [{ id: 'legacy-main', image_url: product.image_url, display_order: 0 }] : []

  return (
    <main className="detail-page">
      <div className="detail-shell">
        <Link className="back-link" href="/">← <span>Retour au catalogue</span></Link>
        <article className="detail-layout">
          <ProductImageGallery images={images} productName={product.name} />
          <div className="detail-copy">
            <p className="eyebrow">{product.category || 'SÉLECTION JALIMS'}</p>
            <h1>{product.name}</h1>
            <p className="detail-price">{Number(product.price).toLocaleString('fr-FR')} <span>FCFA</span></p>
            <p className="detail-description">{product.description || 'Commandez ce produit depuis la Chine. Jalims organise son acheminement et le dédouanement jusqu’à votre point de retrait au Sénégal.'}</p>
            <div className="product-specs">
              <span>Commande minimum</span><strong>{product.moq ?? 1} unité{(product.moq ?? 1) > 1 ? 's' : ''}</strong>
              <span>Disponibilité</span><strong>{product.stock_status === 'out_of_stock' ? 'Indisponible' : product.stock_status === 'preorder' ? 'Sur commande' : 'Disponible'}</strong>
            </div>
            <div className="delivery-note">
              <span className="delivery-check" aria-hidden="true">✓</span>
              <span><strong>Transport et dédouanement inclus dans l’accompagnement</strong><br />Le point et les délais de retrait seront confirmés avec vous.</span>
            </div>
            <ProductPurchaseControls productId={String(product.id)} minimumQuantity={product.moq ?? 1} unavailable={product.stock_status === 'out_of_stock'} />
          </div>
        </article>
      </div>
    </main>
  )
}