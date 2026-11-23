export type AppPricingSettings = {
  transport_price_per_kg_fcfa: number
  commission_percent: number
  customs_percent: number
  cny_to_fcfa_rate: number | null
}

export const DEFAULT_APP_PRICING_SETTINGS: AppPricingSettings = {
  transport_price_per_kg_fcfa: 0,
  commission_percent: 0,
  customs_percent: 0,
  cny_to_fcfa_rate: null,
}

export type ImportedProductPricingInput = {
  origin?: 'local' | 'import' | null
  price: number
  import_base_price?: number | null
  import_base_currency?: 'FCFA' | 'CNY' | null
  import_weight_kg?: number | null
  import_other_fees_fcfa?: number | null
}

export function roundToNearest25Fcfa(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.round(value / 25) * 25
}

export function normalizeAppPricingSettings(value: Partial<AppPricingSettings> | null | undefined): AppPricingSettings {
  const transport = Number(value?.transport_price_per_kg_fcfa)
  const commission = Number(value?.commission_percent)
  const customs = Number(value?.customs_percent)
  const rawRate = value?.cny_to_fcfa_rate as unknown
  const rate = rawRate === null || rawRate === undefined || rawRate === '' ? NaN : Number(rawRate)
  return {
    transport_price_per_kg_fcfa: Number.isFinite(transport) && transport >= 0 ? transport : 0,
    commission_percent: Number.isFinite(commission) && commission >= 0 ? commission : 0,
    customs_percent: Number.isFinite(customs) && customs >= 0 ? customs : 0,
    cny_to_fcfa_rate: Number.isFinite(rate) && rate > 0 ? rate : null,
  }
}

export function canComputeImportedProductPrice(product: ImportedProductPricingInput, settings?: AppPricingSettings | null) {
  if (product.origin === 'local') return false
  const hasBase = Number.isFinite(Number(product.import_base_price))
  const hasWeight = Number.isFinite(Number(product.import_weight_kg)) && Number(product.import_weight_kg) > 0
  const currency = product.import_base_currency === 'CNY' || product.import_base_currency === 'FCFA' || product.import_base_currency == null
  if (!hasBase || !hasWeight || !currency) return false
  if ((product.import_base_currency ?? 'FCFA') === 'CNY') {
    const rate = settings ? normalizeAppPricingSettings(settings).cny_to_fcfa_rate : null
    return rate != null && rate > 0
  }
  return true
}

export function computeImportedProductUnitPrice(
  product: ImportedProductPricingInput,
  settings: AppPricingSettings,
  variantAdjustmentFcfa = 0,
) {
  if (product.origin === 'local' || !canComputeImportedProductPrice(product, settings)) {
    const fallback = Number(product.price) + Number(variantAdjustmentFcfa || 0)
    return Number.isFinite(fallback) ? fallback : 0
  }

  const s = normalizeAppPricingSettings(settings)
  const baseAmount = Number(product.import_base_price) || 0
  const weight = Number(product.import_weight_kg) || 0
  const otherFees = Number(product.import_other_fees_fcfa) || 0
  const adjustment = Number(variantAdjustmentFcfa) || 0
  const baseProductFcfa = ((product.import_base_currency ?? 'FCFA') === 'CNY' ? baseAmount * (s.cny_to_fcfa_rate ?? 0) : baseAmount) + adjustment
  const transport = weight * s.transport_price_per_kg_fcfa
  const preCustomsBase = baseProductFcfa + transport + otherFees
  const customs = preCustomsBase * (s.customs_percent / 100)
  const base = preCustomsBase + customs
  const commission = base * (s.commission_percent / 100)
  return roundToNearest25Fcfa(base + commission)
}

export function getDisplayedUnitPrice(
  product: ImportedProductPricingInput,
  settings: AppPricingSettings | null | undefined,
  variantAdjustmentFcfa = 0,
) {
  if (product.origin === 'local') {
    const localPrice = Number(product.price) + Number(variantAdjustmentFcfa || 0)
    return Number.isFinite(localPrice) ? localPrice : 0
  }
  return computeImportedProductUnitPrice(product, settings ?? DEFAULT_APP_PRICING_SETTINGS, variantAdjustmentFcfa)
}
