import { createBictorysPayment } from '../../../../../lib/payments/bictorys'

export async function POST(request: Request) {
  return createBictorysPayment(request)
}
