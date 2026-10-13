'use client'

import ConnectionError from '../../ui/connection-error'

export default function ProductError({ reset }: { reset: () => void }) {
  return (
    <main className="orders-page">
      <div className="orders-shell">
        <ConnectionError onRetry={reset} />
      </div>
    </main>
  )
}
