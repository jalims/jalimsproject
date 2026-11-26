'use client'

import { logClientError } from '../../../../lib/user-facing-errors'
import { supabase } from '../../../../lib/supabase'

export type SupplierCost = {
  purchase_price: number | null
  currency: 'FCFA' | 'CNY' | null
}

export type Product = {
  id: string | number
  name: string
  description: string
  price: number
  delivery_estimate: string | null
  image_url: string | null
  category: string | null
  moq: number
  stock_status: string
  active: boolean
  featured: boolean
  origin: 'local' | 'import'
  local_stock: number
  city: string | null
  delivery_delay: string | null
  stock_updated_at: string | null
  partner_id: string | null
  import_base_price: number | null
  import_base_currency: 'FCFA' | 'CNY' | null
  import_weight_kg: number | null
  import_other_fees_fcfa: number
  supplier_cost?: SupplierCost | null
}

export const PRODUCT_SELECT_COLUMNS = 'id, name, description, price, delivery_estimate, image_url, category, moq, stock_status, active, featured, origin, local_stock, city, delivery_delay, stock_updated_at, partner_id, import_base_price, import_base_currency, import_weight_kg, import_other_fees_fcfa'

export async function requestAdminProducts(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body: Record<string, unknown>) {
  try {
    const { data, error } = await supabase.auth.getSession()
    if (error) {
      logClientError('Admin product session read failed', error)
      return { error: 'Impossible de vérifier votre session administrateur. Reconnectez-vous puis réessayez.', data: null }
    }

    const accessToken = data.session?.access_token
    if (!accessToken) return { error: 'Votre session a expiré. Reconnectez-vous puis réessayez.', data: null }

    const response = await fetch('/api/admin/products', {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    let result: unknown
    try {
      result = await response.json()
    } catch (error) {
      logClientError('Admin product API response parsing failed', error)
      return { error: 'La réponse du serveur est invalide. Réessayez.', data: null }
    }

    if (!response.ok) {
      const message = typeof result === 'object' && result !== null && 'error' in result && typeof result.error === 'string'
        ? result.error
        : 'La modification du produit n’a pas pu être enregistrée.'
      return { error: message, data: null }
    }

    return { error: null, data: result as Record<string, unknown> | null }
  } catch (error) {
    logClientError('Admin product API request failed', error)
    return { error: 'Le serveur est momentanément inaccessible. Vérifiez votre connexion puis réessayez.', data: null }
  }
}

export async function requestAdminProductImages(method: 'PATCH' | 'DELETE', body: Record<string, unknown>) {
  try {
    const { data, error } = await supabase.auth.getSession()
    if (error) {
      logClientError('Admin product image session read failed', error)
      return { error: 'Impossible de vérifier votre session administrateur. Reconnectez-vous puis réessayez.', data: null }
    }

    const accessToken = data.session?.access_token
    if (!accessToken) return { error: 'Votre session a expiré. Reconnectez-vous puis réessayez.', data: null }

    const response = await fetch('/api/admin/products/images', {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    let result: unknown
    try {
      result = await response.json()
    } catch (error) {
      logClientError('Admin product image API response parsing failed', error)
      return { error: 'La réponse du serveur est invalide. Réessayez.', data: null }
    }

    if (!response.ok) {
      const message = typeof result === 'object' && result !== null && 'error' in result && typeof result.error === 'string'
        ? result.error
        : 'La modification de l’image n’a pas pu être enregistrée.'
      return { error: message, data: null }
    }

    return { error: null, data: result as Record<string, unknown> | null }
  } catch (error) {
    logClientError('Admin product image API request failed', error)
    return { error: 'Le serveur est momentanément inaccessible. Vérifiez votre connexion puis réessayez.', data: null }
  }
}

export function formatStockUpdatedAt(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Jamais'
  return new Date(value).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}

export async function removeCreatedProduct(productId: string) {
  const { error } = await requestAdminProducts('DELETE', { id: productId })
  if (error) logClientError('Admin product draft cleanup failed', error)
}
