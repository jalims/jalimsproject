'use client'

export default function ConnectionError({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="skeleton-connection-error" role="alert">
      <p>La connexion est lente ou coupée.</p>
      <button className="skeleton-retry" type="button" onClick={onRetry}>Réessayer</button>
    </section>
  )
}
