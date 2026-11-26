'use client'

import { usePathname } from 'next/navigation'
import BottomNavigation from './ui/bottom-navigation'
import CartHeaderButton from './ui/cart-header-button'

export default function StorefrontChrome() {
  const pathname = usePathname()
  const isAdminRoute = pathname === '/admin' || pathname?.startsWith('/admin/')

  if (isAdminRoute) return null

  return (
    <>
      <CartHeaderButton />
      <BottomNavigation />
    </>
  )
}
