import { notFound } from 'next/navigation'
import { isWaveMockEnabled } from '../../../../lib/payments/wave'
import MockWaveActions from './mock-actions'

type WaveMockPageProps = {
  searchParams: Promise<{ order_id?: string }>
}

const orderIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default async function WaveMockPage({ searchParams }: WaveMockPageProps) {
  const { order_id: orderId } = await searchParams
  if (!isWaveMockEnabled() || !orderId || !orderIdPattern.test(orderId)) notFound()

  return (
    <main className="orders-page">
      <div className="orders-shell">
        <header className="orders-heading">
          <p className="eyebrow">SIMULATION WAVE</p>
          <h1>Tester le paiement</h1>
          <p>Cette page de simulation n’effectue aucun paiement réel.</p>
        </header>
        <MockWaveActions orderId={orderId} />
      </div>
    </main>
  )
}
