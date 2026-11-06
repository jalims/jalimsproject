import { handleMockWavePayment } from '../../../../../lib/payments/wave'

export async function POST(request: Request) {
  return handleMockWavePayment(request)
}
