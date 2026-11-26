'use client'

import {
  Bell,
  ChartNoAxesColumnIncreasing,
  ChevronDown,
  CircleUserRound,
  FileText,
  Handshake,
  House,
  LogOut,
  MapPin,
  Menu,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Store,
  Truck,
  Upload,
  Users,
  X,
  MessageSquareText,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { canAccessAdminPath, type StaffRole } from '../../lib/admin-staff-client'
import { logClientError } from '../../lib/user-facing-errors'
import { supabase } from '../../lib/supabase'
import { useAdminSession } from './admin-session-provider'
import { AdminDashboardProvider } from './admin-dashboard-context'
import { ToastProvider } from './_components'

type NavigationItem = {
  href: string
  label: string
  Icon: LucideIcon
}

type SearchTarget = {
  value: 'commandes' | 'produits' | 'clients'
  label: string
  href: string
}

const navigationSections: { label: string; items: NavigationItem[] }[] = [
  {
    label: 'Pilotage',
    items: [
      { href: '/admin', label: 'Tableau de bord', Icon: House },
      { href: '/admin/statistiques', label: 'Statistiques', Icon: ChartNoAxesColumnIncreasing },
    ],
  },
  {
    label: 'Ventes',
    items: [
      { href: '/admin/commandes', label: 'Commandes', Icon: Truck },
      { href: '/admin/clients', label: 'Clients', Icon: Users },
      { href: '/admin/demandes', label: 'Demandes clients', Icon: MessageSquareText },
    ],
  },
  {
    label: 'Catalogue',
    items: [
      { href: '/admin/produits', label: 'Produits', Icon: Package },
      { href: '/admin/importer', label: 'Importer', Icon: Upload },
      { href: '/admin/partenaires', label: 'Partenaires', Icon: Handshake },
      { href: '/admin/retraits', label: 'Points de retrait', Icon: MapPin },
    ],
  },
  {
    label: 'Contenu',
    items: [
      { href: '/admin/accueil', label: 'Textes accueil', Icon: House },
      { href: '/admin/conditions', label: 'Conditions', Icon: FileText },
      { href: '/admin/messages', label: 'Messages', Icon: MessageSquareText },
    ],
  },
  {
    label: 'Réglages',
    items: [
      { href: '/admin/parametres', label: 'Paramètres', Icon: Settings },
      { href: '/admin/equipe', label: 'Équipe', Icon: Users },
    ],
  },
]

const searchTargets: SearchTarget[] = [
  { value: 'commandes', label: 'Commandes', href: '/admin/commandes' },
  { value: 'produits', label: 'Produits', href: '/admin/produits' },
  { value: 'clients', label: 'Clients', href: '/admin/clients' },
]

const pageTitles: Record<string, string> = {
  '/admin': 'Tableau de bord',
  '/admin/accueil': 'Textes accueil',
  '/admin/clients': 'Clients',
  '/admin/commandes': 'Commandes',
  '/admin/conditions': 'Conditions générales',
  '/admin/demandes': 'Demandes clients',
  '/admin/equipe': 'Équipe',
  '/admin/importer': 'Importer',
  '/admin/messages': 'Messages clients',
  '/admin/parametres': 'Paramètres',
  '/admin/partenaires': 'Partenaires',
  '/admin/produits': 'Produits',
  '/admin/retraits': 'Points de retrait',
  '/admin/statistiques': 'Statistiques',
}

const roleLabels: Record<StaffRole, string> = {
  owner: 'Propriétaire',
  admin: 'Administrateur',
  order_manager: 'Gestionnaire de commandes',
}

function getPageTitle(pathname: string) {
  return pageTitles[pathname] ?? 'Administration'
}

export default function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { email: adminEmail, role: staffRole, loading: roleLoading, error: roleError } = useAdminSession()
  const [notificationCount, setNotificationCount] = useState<number | null>(null)
  const [notificationError, setNotificationError] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const [searchTarget, setSearchTarget] = useState<SearchTarget['value']>('commandes')
  const [signOutError, setSignOutError] = useState('')
  const notificationLoaded = useRef(false)
  const shellMounted = useRef(false)

  useEffect(() => {
    shellMounted.current = true
    return () => {
      shellMounted.current = false
    }
  }, [])

  useEffect(() => {
    if (
      pathname !== '/admin'
      || (staffRole !== 'owner' && staffRole !== 'admin')
      || notificationLoaded.current
    ) {
      return
    }

    notificationLoaded.current = true

    async function loadRequestCount() {
      try {
        const { data, error } = await supabase.auth.getSession()
        if (error) throw error
        const token = data.session?.access_token
        if (!token) throw new Error('Session d’administration absente.')

        const response = await fetch('/api/admin/product-requests?mode=count', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        if (!response.ok) throw new Error('Impossible de charger le compteur des demandes.')

        const body = await response.json() as { newCount?: unknown }
        if (typeof body.newCount !== 'number' || !Number.isFinite(body.newCount)) {
          throw new Error('Réponse invalide du compteur des demandes.')
        }
        if (shellMounted.current) setNotificationCount(body.newCount)
      } catch (error) {
        logClientError('Admin request notification count', error)
        if (shellMounted.current) setNotificationError('Compteur des demandes indisponible.')
      }
    }

    void loadRequestCount()
  }, [pathname, staffRole])

  useEffect(() => {
    if (!mobileSidebarOpen) return

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setMobileSidebarOpen(false)
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [mobileSidebarOpen])

  const visibleSections = navigationSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => canAccessAdminPath(staffRole, item.href)),
    }))
    .filter((section) => section.items.length > 0)
  const availableSearchTargets = staffRole === 'order_manager'
    ? searchTargets.filter((target) => target.value === 'commandes')
    : searchTargets
  const activeSearchTarget = availableSearchTargets.find((target) => target.value === searchTarget)
    ?? availableSearchTargets[0]
  const isOwnerOrAdmin = staffRole === 'owner' || staffRole === 'admin'

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const query = searchValue.trim()
    if (!query || !activeSearchTarget) return
    router.push(`${activeSearchTarget.href}?q=${encodeURIComponent(query)}`)
    setMobileSidebarOpen(false)
  }

  async function signOut() {
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      router.replace('/login')
    } catch (error) {
      logClientError('Admin sign out', error)
      setSignOutError('La déconnexion a échoué. Réessayez.')
    }
  }

  return (
    <div
      className="admin-app"
      data-sidebar-collapsed={sidebarCollapsed}
      data-mobile-open={mobileSidebarOpen}
    >
      <ToastProvider>
      {mobileSidebarOpen && (
        <button
          type="button"
          className="admin-sidebar-backdrop"
          aria-label="Fermer le menu"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      <aside className="admin-sidebar" aria-label="Navigation admin">
        <div className="admin-sidebar-brand">
          <Link href={staffRole === 'order_manager' ? '/admin/commandes' : '/admin'} aria-label="Jalims administration">
            <span className="admin-brand-mark">J</span>
            <span className="admin-brand-copy">
              <strong>Jalims</strong>
              <small>Administration</small>
            </span>
          </Link>
          <button
            type="button"
            className="admin-sidebar-collapse"
            aria-label={sidebarCollapsed ? 'Déplier le menu' : 'Replier le menu'}
            title={sidebarCollapsed ? 'Déplier le menu' : 'Replier le menu'}
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
          <button
            type="button"
            className="admin-sidebar-mobile-close"
            aria-label="Fermer le menu"
            onClick={() => setMobileSidebarOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        <nav className="admin-sidebar-nav" aria-label="Menu principal">
          {roleLoading && <p className="admin-sidebar-loading">Chargement du menu…</p>}
          {visibleSections.map((section) => (
            <section className="admin-nav-section" key={section.label}>
              <h2>{section.label}</h2>
              {section.items.map(({ href, label, Icon }) => {
                const isActive = pathname === href
                return (
                  <Link
                    className={`admin-nav-link${isActive ? ' is-active' : ''}`}
                    href={href}
                    key={href}
                    title={label}
                    aria-label={label}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => setMobileSidebarOpen(false)}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span className="admin-nav-label">{label}</span>
                    {href === '/admin/demandes' && notificationCount !== null && notificationCount > 0 && (
                      <span className="admin-nav-count" aria-label={`${notificationCount} nouvelles demandes`}>
                        {notificationCount}
                      </span>
                    )}
                  </Link>
                )
              })}
            </section>
          ))}
        </nav>

        <Link className="admin-store-link" href="/">
          <Store size={18} aria-hidden="true" />
          <span className="admin-nav-label">Voir la boutique</span>
        </Link>
      </aside>

      <div className="admin-workspace">
        <header className={`admin-topbar${staffRole ? ' has-search' : ''}`}>
          <div className="admin-topbar-title">
            <button
              type="button"
              className="admin-mobile-menu-button"
              aria-label="Ouvrir le menu"
              aria-expanded={mobileSidebarOpen}
              onClick={() => setMobileSidebarOpen(true)}
            >
              <Menu size={21} />
            </button>
            <h1>{getPageTitle(pathname)}</h1>
          </div>

          <div className="admin-topbar-actions">
            {staffRole && (
              <form className="admin-global-search" role="search" onSubmit={submitSearch}>
                <label className="admin-visually-hidden" htmlFor="admin-search-target">Rechercher dans</label>
                <select
                  id="admin-search-target"
                  value={activeSearchTarget?.value ?? 'commandes'}
                  onChange={(event) => setSearchTarget(event.target.value as SearchTarget['value'])}
                  aria-label="Type de recherche"
                >
                  {availableSearchTargets.map((target) => (
                    <option key={target.value} value={target.value}>{target.label}</option>
                  ))}
                </select>
                <label className="admin-visually-hidden" htmlFor="admin-global-search">Terme recherché</label>
                <input
                  id="admin-global-search"
                  type="search"
                  value={searchValue}
                  onChange={(event) => setSearchValue(event.target.value)}
                  placeholder="Rechercher…"
                />
                <button type="submit" aria-label="Lancer la recherche">
                  <Search size={18} aria-hidden="true" />
                </button>
              </form>
            )}

            {isOwnerOrAdmin && (
              <Link
                className="admin-notification-link"
                href="/admin/demandes"
                aria-label={notificationCount ? `${notificationCount} nouvelles demandes` : 'Demandes clients'}
                title="Demandes clients"
              >
                <Bell size={19} aria-hidden="true" />
                {notificationCount !== null && notificationCount > 0 && (
                  <span className="admin-notification-count">{notificationCount}</span>
                )}
              </Link>
            )}

            {staffRole && (
              <details className="admin-profile-menu">
                <summary aria-label="Ouvrir le menu du profil">
                  <CircleUserRound size={20} aria-hidden="true" />
                  <span className="admin-profile-copy">
                    <strong>{adminEmail || 'Compte admin'}</strong>
                    <small>{roleLabels[staffRole]}</small>
                  </span>
                  <ChevronDown size={16} aria-hidden="true" />
                </summary>
                <div className="admin-profile-dropdown">
                  <p>{adminEmail}</p>
                  <span>{roleLabels[staffRole]}</span>
                  <Link href="/">
                    <Store size={16} aria-hidden="true" />
                    Voir la boutique
                  </Link>
                  <button type="button" onClick={signOut}>
                    <LogOut size={16} aria-hidden="true" />
                    Déconnexion
                  </button>
                </div>
              </details>
            )}
          </div>
        </header>

        <div className="admin-content">
          {roleError && <p className="admin-shell-alert" role="alert">{roleError}</p>}
          {signOutError && <p className="admin-shell-alert" role="alert">{signOutError}</p>}
          {notificationError && <p className="admin-shell-alert" role="alert">{notificationError}</p>}
          <AdminDashboardProvider
            newRequestCount={notificationCount}
            newRequestError={notificationError || null}
          >
            {children}
          </AdminDashboardProvider>
        </div>
      </div>
      </ToastProvider>
    </div>
  )
}
