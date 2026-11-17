import BictorysReturnStatus from '../return-status'

type BictorysSuccessPageProps = {
  searchParams: Promise<{ order_id?: string | string[] }>
}

export default async function BictorysSuccessPage({ searchParams }: BictorysSuccessPageProps) {
  const { order_id: orderId } = await searchParams

  return (
    <BictorysReturnStatus
      mode="success"
      orderId={typeof orderId === 'string' ? orderId : null}
    />
  )
}
