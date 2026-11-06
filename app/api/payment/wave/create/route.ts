import { createWavePayment } from '../../../../../lib/payments/wave'

export async function POST(request: Request) {
  return createWavePayment(request)
}
