import BictorysReturnStatus from '../return-status'

type BictorysErrorPageProps = {
  searchParams: Promise<{ order_id?: string | string[] }>
}

export default async function BictorysErrorPage({ searchParams }: BictorysErrorPageProps) {
  const { order_id: orderId } = await searchParams

  return (
    <BictorysReturnStatus
      mode="error"
      orderId={typeof orderId === 'string' ? orderId : null}
    />
  )
}
