import { ProductGridSkeleton } from '../ui/loading-skeletons'

export default function Loading() {
  return (
    <main className="orders-page">
      <div className="orders-shell">
        <header className="orders-heading">
          <p className="eyebrow">VOTRE SÉLECTION</p>
          <h1>Favoris</h1>
          <p>Retrouvez ici les produits gardés pour plus tard.</p>
        </header>
        <ProductGridSkeleton count={6} mode="favorites" />
      </div>
    </main>
  )
}
