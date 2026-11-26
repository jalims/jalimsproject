import { Suspense } from 'react'
import CatalogPage from './_components/catalog-page'
import { Skeleton } from '../_components'

export default function ProductsPage() {
  return (
    <Suspense fallback={(
      <main className="admin-page" aria-busy="true">
        <div className="admin-shell">
          <Skeleton variant="rect" height={72} />
          <Skeleton variant="rect" height={420} />
        </div>
      </main>
    )}>
      <CatalogPage />
    </Suspense>
  )
}
