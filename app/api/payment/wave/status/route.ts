import { isWaveEnabled } from '../../../../../lib/payments/wave-config'

export async function GET() {
  return Response.json(
    { enabled: isWaveEnabled() },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
