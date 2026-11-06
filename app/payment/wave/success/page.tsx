import WaveReturnStatus from '../return-status'

type WaveSuccessPageProps = {
  searchParams: Promise<{ order_id?: string | string[] }>
}

export default async function WaveSuccessPage({ searchParams }: WaveSuccessPageProps) {
  const { order_id: orderId } = await searchParams

  return (
    <WaveReturnStatus
      mode="success"
      orderId={typeof orderId === 'string' ? orderId : null}
    />
  )
}
