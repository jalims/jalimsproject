'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Heart, Home, Package, User } from 'lucide-react'

const navigationItems = [
  {
    href: '/',
    label: 'Accueil',
    Icon: Home,
  },
  {
    href: '/orders',
    label: 'Mes commandes',
    Icon: Package,
  },
  {
    href: '/account',
    label: 'Mon compte',
    Icon: User,
  },
  {
    href: '/favorites',
    label: 'Favoris',
    Icon: Heart,
  },
]

export default function BottomNavigation() {
  const pathname = usePathname()

  return (
    <nav className="bottom-navigation" aria-label="Navigation principale">
      <div className="bottom-navigation-inner">
        {navigationItems.map((item) => {
          const Icon = item.Icon
          const active = item.href === '/'
            ? pathname === '/' || pathname.startsWith('/products/') || pathname === '/checkout'
            : pathname === item.href || pathname.startsWith(`${item.href}/`)

          return (
            <Link
              className={`bottom-navigation-link${active ? ' active' : ''}`}
              href={item.href}
              key={item.href}
              aria-current={active ? 'page' : undefined}
            >
              <Icon
                aria-hidden="true"
                className="bottom-navigation-icon"
                fill={active && item.href === '/favorites' ? 'currentColor' : 'none'}
                size={24}
                strokeWidth={active ? 2.6 : 1.9}
              />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}