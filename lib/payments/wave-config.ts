const waveMockEnabled = process.env.WAVE_MOCK === 'true'

if (waveMockEnabled && process.env.NODE_ENV === 'production') {
  throw new Error('WAVE_MOCK=true is not allowed when NODE_ENV=production.')
}

export function isWaveEnabled() {
  return process.env.WAVE_ENABLED === 'true' || waveMockEnabled
}

export function isWaveMockEnabled() {
  return waveMockEnabled
}
