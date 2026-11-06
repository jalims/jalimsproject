import WaveReturnStatus from '../return-status'

type WaveErrorPageProps = {
  searchParams: Promise<{ order_id?: string | string[] }>
}

export default async function WaveErrorPage({ searchParams }: WaveErrorPageProps) {
  const { order_id: orderId } = await searchParams

  return (
    <WaveReturnStatus
      mode="error"
      orderId={typeof orderId === 'string' ? orderId : null}
    />
  )
}
