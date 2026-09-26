'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const navigationItems = [
  {
    href: '/',
    label: 'Accueil',
    icon: <path d="m3.75 10.5 8.25-7 8.25 7v9.25a1.5 1.5 0 0 1-1.5 1.5h-13.5a1.5 1.5 0 0 1-1.5-1.5V10.5Z" />,
  },
  {
    href: '/orders',
    label: 'Mes commandes',
    icon: (
      <>
        <path d="M3.75 4.75h2l1.5 10.5h9.5l2-7.5H7" />
        <path d="M9 19.25h.01M16.5 19.25h.01" />
        <path d="M10 7.75h6M13 4.75v6" />
      </>
    ),
  },
  {
    href: '/account',
    label: 'Mon compte',
    icon: (
      <>
        <circle cx="12" cy="8" r="3.25" />
        <path d="M5.25 19.25c.55-3.1 3.15-5 6.75-5s6.2 1.9 6.75 5" />
      </>
    ),
  },
  {
    href: '/favorites',
    label: 'Favoris',
    icon: <path d="M20.2 8.65c0 4.15-8.2 9.35-8.2 9.35S3.8 12.8 3.8 8.65A4.15 4.15 0 0 1 12 6.9a4.15 4.15 0 0 1 8.2 1.75Z" />,
  },
]

export default function BottomNavigation() {
  const pathname = usePathname()

  return (
    <nav className="bottom-navigation" aria-label="Navigation principale">
      <div className="bottom-navigation-inner">
        {navigationItems.map((item) => {
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
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {item.icon}
              </svg>
              <span>{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}