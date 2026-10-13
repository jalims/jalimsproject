import { OrdersListSkeleton } from '../ui/loading-skeletons'

export default function Loading() {
  return (
    <main className="orders-page">
      <div className="orders-shell">
        <header className="orders-heading">
          <p className="eyebrow">VOTRE ESPACE JALIMS</p>
          <h1>Mes commandes</h1>
          <p>Suivez chaque étape, de la commande au retrait.</p>
        </header>
        <OrdersListSkeleton />
      </div>
    </main>
  )
}
