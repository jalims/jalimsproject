'use client'

import { useEffect, useState } from 'react'
import { logClientError } from '../user-facing-errors'

export type WaveAvailability = 'checking' | 'enabled' | 'disabled' | 'unavailable'

export function useWaveAvailability() {
  const [availability, setAvailability] = useState<WaveAvailability>('checking')

  useEffect(() => {
    const controller = new AbortController()

    async function checkAvailability() {
      try {
        const response = await fetch('/api/payment/wave/status', {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) {
          throw new Error(`Wave availability check failed with HTTP ${response.status}`)
        }

        const result = await response.json() as { enabled?: unknown }
        if (typeof result.enabled !== 'boolean') {
          throw new Error('Wave availability response is invalid')
        }

        setAvailability(result.enabled ? 'enabled' : 'disabled')
      } catch (error) {
        if (controller.signal.aborted) return
        logClientError('Wave availability check failed', error)
        setAvailability('unavailable')
      }
    }

    void checkAvailability()
    return () => controller.abort()
  }, [])

  return {
    availability,
    enabled: availability === 'enabled',
  }
}
