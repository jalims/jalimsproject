'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { normalizeSenegalPhone } from '../../../lib/order-messages'
import { supabase } from '../../../lib/supabase'

type Client = {
  id: string
  name: string
  phone: string
  email: string
  created_at: string
  email_confirmed: boolean
  order_count: number
  total_spent: number
}
type ClientResponse = { clients: Client[]; page: number; hasMore: boolean }

async function readResponse(response: Response): Promise<ClientResponse> {
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('La réponse du serveur est invalide.')
  }
  const result = body as Record<string, unknown>
  if (!response.ok) {
    throw new Error(typeof result.error === 'string' ? result.error : 'La liste des clients n’a pas pu être chargée.')
  }
  return result as unknown as ClientResponse
}

function welcomeMessage(name: string) {
  const firstName = name === 'Client sans nom' ? '' : name.trim().split(/\s+/)[0]
  return `Bonjour${firstName ? ` ${firstName}` : ''}, bienvenue chez Jalims ! Nous sommes ravis de vous compter parmi nos clients.`
}

function isNewAccount(createdAt: string) {
  const age = Date.now() - new Date(createdAt).getTime()
  return age >= 0 && age < 24 * 60 * 60 * 1000
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
}

function Skeletons() {
  return <div className="admin-clients-skeletons" aria-label="Chargement des comptes">{Array.from({ length: 6 }, (_, index) => <div className="admin-clients-skeleton" key={index} />)}</div>
}

export default function AdminClientsPage() {
  const [search, setSearch] = useState('')
  const [withoutOrder, setWithoutOrder] = useState(false)
  const [page, setPage] = useState(1)
  const [clients, setClients] = useState<Client[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [welcomeMessages, setWelcomeMessages] = useState<Record<string, string>>({})
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      async function loadClients() {
        setLoading(true)
        setErrorMessage('')
        const { data, error } = await supabase.auth.getSession()
        if (error || !data.session?.access_token) {
          setClients([])
          setErrorMessage('Connectez-vous avec le compte administrateur pour consulter les clients.')
          setLoading(false)
          return
        }

        const params = new URLSearchParams({
          page: String(page),
          search,
          withoutOrder: String(withoutOrder),
        })
        try {
          const response = await fetch(`/api/admin/clients?${params}`, {
            headers: { Authorization: `Bearer ${data.session.access_token}` },
            signal: controller.signal,
          })
          const result = await readResponse(response)
          setClients(result.clients)
          setHasMore(result.hasMore)
        } catch (error) {
          if (controller.signal.aborted) return
          setClients([])
          setHasMore(false)
          setErrorMessage(error instanceof Error ? error.message : 'La liste des clients n’a pas pu être chargée.')
        } finally {
          if (!controller.signal.aborted) setLoading(false)
        }
      }
      void loadClients()
    }, 250)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [page, search, withoutOrder])

  async function exportCsv() {
    setExporting(true)
    setErrorMessage('')
    const { data, error } = await supabase.auth.getSession()
    if (error || !data.session?.access_token) {
      setErrorMessage('Votre session a expiré. Reconnectez-vous puis réessayez.')
      setExporting(false)
      return
    }

    const params = new URLSearchParams({ export: 'csv', search, withoutOrder: String(withoutOrder) })
    try {
      const response = await fetch(`/api/admin/clients?${params}`, {
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      })
      if (!response.ok) {
        const body: unknown = await response.json()
        const result = typeof body === 'object' && body !== null && !Array.isArray(body) ? body as Record<string, unknown> : {}
        throw new Error(typeof result.error === 'string' ? result.error : 'L’export CSV a échoué.')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `jalims-clients-${new Date().toISOString().slice(0, 10)}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'L’export CSV a échoué.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <main className="admin-page">
      <div className="admin-shell">
        <header className="admin-header">
          <div>
            <p className="eyebrow">JALIMS <span className="admin-header-divider">/</span> ESPACE ADMIN</p>
            <h1>Clients</h1>
            <p>Consultez les comptes et accueillez vos nouveaux clients.</p>
          </div>
          <button className="admin-clients-export" type="button" onClick={() => void exportCsv()} disabled={exporting}>
            {exporting ? 'Préparation…' : 'Exporter en CSV'}
          </button>
        </header>
        <nav className="admin-shortcuts" aria-label="Outils d’administration">
          <Link className="admin-nav-item" href="/admin"><span className="admin-nav-icon" aria-hidden="true">▦</span> Produits</Link>
          <Link className="admin-nav-item" href="/admin/commandes"><span className="admin-nav-icon" aria-hidden="true">↗</span> Commandes</Link>
          <Link className="admin-nav-item current" href="/admin/clients"><span className="admin-nav-icon" aria-hidden="true">♙</span> Clients</Link>
          <Link className="admin-nav-item" href="/admin/statistiques"><span className="admin-nav-icon" aria-hidden="true">▤</span> Statistiques</Link>
          <Link className="admin-nav-item" href="/admin/accueil"><span className="admin-nav-icon" aria-hidden="true">T</span> Textes accueil</Link>
        </nav>

        <section className="admin-clients-panel">
          <div className="admin-clients-filters">
            <label className="admin-clients-search">
              <span className="sr-only">Rechercher un client</span>
              <input
                type="search"
                placeholder="Nom, téléphone ou e-mail"
                value={search}
                onChange={(event) => { setSearch(event.target.value); setPage(1) }}
              />
            </label>
            <label className="admin-clients-without-order">
              <input type="checkbox" checked={withoutOrder} onChange={(event) => { setWithoutOrder(event.target.checked); setPage(1) }} />
              <span>Sans commande</span>
            </label>
            <span className="admin-clients-page-label">Page {page}</span>
          </div>

          {errorMessage && <p className="admin-clients-error" role="alert">{errorMessage}</p>}
          {loading ? <Skeletons /> : clients.length === 0 ? (
            <div className="admin-clients-empty">
              <span aria-hidden="true">♙</span>
              <h2>Aucun compte à afficher</h2>
              <p>{search || withoutOrder ? 'Essayez une autre recherche ou désactivez le filtre « Sans commande ».' : 'Les nouveaux comptes apparaîtront ici dès leur inscription.'}</p>
            </div>
          ) : (
            <div className="admin-clients-table-wrap">
              <table className="admin-clients-table">
                <thead><tr><th>Client</th><th>Inscription</th><th>E-mail</th><th>Commandes</th><th>Total dépensé</th><th>Bienvenue sur WhatsApp</th></tr></thead>
                <tbody>
                  {clients.map((client) => {
                    const phone = normalizeSenegalPhone(client.phone)
                    const message = welcomeMessages[client.id] ?? welcomeMessage(client.name)
                    const whatsappUrl = phone ? `https://wa.me/${phone.replace('+', '')}?text=${encodeURIComponent(message)}` : null
                    return (
                      <tr key={client.id}>
                        <th className="admin-clients-identity" scope="row">
                          <strong>{client.name}</strong>
                          {isNewAccount(client.created_at) && <span className="admin-clients-new">Nouveau</span>}
                          <span>{client.phone || 'Téléphone non renseigné'}</span>
                          <span className="admin-clients-mobile-date">{formatDate(client.created_at)}</span>
                        </th>
                        <td data-label="Inscription">{formatDate(client.created_at)}</td>
                        <td data-label="E-mail"><span className={`admin-clients-confirmed ${client.email_confirmed ? 'is-confirmed' : ''}`}>{client.email_confirmed ? 'Confirmé' : 'Non confirmé'}</span><span className="admin-clients-email">{client.email || 'E-mail non renseigné'}</span></td>
                        <td data-label="Commandes">{client.order_count.toLocaleString('fr-FR')}</td>
                        <td data-label="Total dépensé">{`${Number(client.total_spent).toLocaleString('fr-FR')} FCFA`}</td>
                        <td className="admin-clients-whatsapp" data-label="Message de bienvenue WhatsApp">
                          <textarea
                            aria-label={`Message WhatsApp pour ${client.name}`}
                            value={message}
                            onChange={(event) => setWelcomeMessages((current) => ({ ...current, [client.id]: event.target.value }))}
                            rows={2}
                          />
                          {whatsappUrl
                            ? <a href={whatsappUrl} target="_blank" rel="noreferrer">Ouvrir WhatsApp <span aria-hidden="true">↗</span></a>
                            : <span className="admin-clients-phone-hint">Numéro sénégalais à 9 chiffres requis</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <nav className="admin-clients-pagination" aria-label="Pagination des clients">
            <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>← Précédent</button>
            <span>Page {page}</span>
            <button type="button" disabled={!hasMore || loading} onClick={() => setPage((current) => current + 1)}>Suivant →</button>
          </nav>
        </section>
      </div>
    </main>
  )
}
