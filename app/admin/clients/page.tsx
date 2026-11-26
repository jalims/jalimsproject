'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { canAccessAdminPath } from '../../../lib/admin-staff-client'
import { normalizeSenegalPhone } from '../../../lib/order-messages'
import { supabase } from '../../../lib/supabase'
import { useAdminSession } from '../admin-session-provider'
import { Button } from '../_components/button'
import { DataTable, type DataTableColumn } from '../_components/data-table'
import { Badge, Card, EmptyState, PageHeader, Skeleton } from '../_components/display'
import { Pagination, SearchInput, Tabs } from '../_components/navigation'
import { Textarea } from '../_components/form-controls'
import { useToast } from '../_components/overlays'

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

function ClientsLoadingFallback() {
  return (
    <main className="admin-page">
      <div className="admin-shell">
        <PageHeader title="Clients" description="Chargement des comptes clients…" eyebrow="JALIMS · ESPACE ADMIN" />
        <Card><Skeleton variant="rect" width="100%" height={180} /></Card>
      </div>
    </main>
  )
}

function AdminClientsPageContent({ initialSearch }: { initialSearch: string }) {
  const { userId, role, loading: checking } = useAdminSession()
  const { toast } = useToast()
  const hasSession = Boolean(userId)
  const [search, setSearch] = useState(initialSearch)
  const [withoutOrder, setWithoutOrder] = useState(false)
  const [page, setPage] = useState(1)
  const [clients, setClients] = useState<Client[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [welcomeMessages, setWelcomeMessages] = useState<Record<string, string>>({})
  const [exporting, setExporting] = useState(false)

  const allowed = canAccessAdminPath(role, '/admin/clients')

  useEffect(() => {
    if (checking || !allowed) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      async function loadClients() {
        setLoading(true)
        setErrorMessage('')
        const { data, error } = await supabase.auth.getSession()
        if (error || !data.session?.access_token) {
          setClients([])
          setErrorMessage('Votre session a expiré. Reconnectez-vous puis réessayez.')
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
  }, [allowed, checking, page, search, withoutOrder])

  async function exportCsv() {
    setExporting(true)
    try {
      const { data, error } = await supabase.auth.getSession()
      if (error || !data.session?.access_token) {
        throw new Error('Votre session a expiré. Reconnectez-vous puis réessayez.')
      }

      const params = new URLSearchParams({ export: 'csv', search, withoutOrder: String(withoutOrder) })
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
      toast({ title: 'Export prêt', description: 'Le fichier CSV a été téléchargé.', variant: 'success' })
    } catch (error) {
      toast({
        title: 'Échec de l’export',
        description: error instanceof Error ? error.message : 'L’export CSV a échoué.',
        variant: 'danger',
      })
    } finally {
      setExporting(false)
    }
  }

  const columns: DataTableColumn<Client>[] = [
    {
      key: 'client',
      label: 'Client',
      render: (client) => (
        <div>
          <strong>{client.name}</strong>
          {isNewAccount(client.created_at) && <Badge variant="brand">Nouveau</Badge>}
          <div>{client.phone || 'Téléphone non renseigné'}</div>
        </div>
      ),
    },
    {
      key: 'created',
      label: 'Inscription',
      render: (client) => formatDate(client.created_at),
    },
    {
      key: 'email',
      label: 'E-mail',
      render: (client) => (
        <div>
          <Badge variant={client.email_confirmed ? 'success' : 'warning'}>
            {client.email_confirmed ? 'Confirmé' : 'Non confirmé'}
          </Badge>
          <div>{client.email || 'E-mail non renseigné'}</div>
        </div>
      ),
    },
    {
      key: 'orders',
      label: 'Commandes',
      render: (client) => client.order_count.toLocaleString('fr-FR'),
    },
    {
      key: 'spent',
      label: 'Total dépensé',
      render: (client) => `${Number(client.total_spent).toLocaleString('fr-FR')} FCFA`,
    },
    {
      key: 'whatsapp',
      label: 'Bienvenue sur WhatsApp',
      render: (client) => {
        const phone = normalizeSenegalPhone(client.phone)
        const message = welcomeMessages[client.id] ?? welcomeMessage(client.name)
        const whatsappUrl = phone ? `https://wa.me/${phone.replace('+', '')}?text=${encodeURIComponent(message)}` : null
        return (
          <div>
            <Textarea
              label={`Message WhatsApp pour ${client.name}`}
              value={message}
              onChange={(event) => setWelcomeMessages((current) => ({ ...current, [client.id]: event.target.value }))}
              rows={2}
            />
            {whatsappUrl
              ? <a href={whatsappUrl} target="_blank" rel="noreferrer">Ouvrir WhatsApp <span aria-hidden="true">↗</span></a>
              : <span>Numéro sénégalais à 9 chiffres requis</span>}
          </div>
        )
      },
    },
  ]

  if (checking) return <main className="admin-page"><div className="admin-state">Vérification de l’accès...</div></main>
  if (!hasSession) {
    return (
      <main className="admin-page"><section className="admin-access-state">
        <p className="eyebrow">JALIMS · ADMINISTRATION</p>
        <h1>Accès réservé</h1>
        <p>Connectez-vous avec un compte autorisé pour consulter les clients.</p>
        <Link className="admin-primary-link" href="/login?next=%2Fadmin%2Fclients">Se connecter</Link>
      </section></main>
    )
  }
  if (!allowed) {
    return (
      <main className="admin-page"><section className="admin-access-state">
        <p className="eyebrow">JALIMS · ADMINISTRATION</p>
        <h1>Accès refusé</h1>
        <p>Votre rôle ne permet pas d’accéder à cette page.</p>
        {role === 'order_manager' && <Link className="admin-primary-link" href="/admin/commandes">Aller aux commandes</Link>}
      </section></main>
    )
  }

  return (
    <main className="admin-page">
      <div className="admin-shell">
        <PageHeader
          title="Clients"
          description="Consultez les comptes et accueillez vos nouveaux clients."
          eyebrow="JALIMS · ESPACE ADMIN"
          actions={(
            <Button variant="outline" onClick={() => void exportCsv()} loading={exporting}>
              Exporter en CSV
            </Button>
          )}
        />
        <Card title="Répertoire clients">
          <div>
            <SearchInput
              label="Rechercher un client"
              placeholder="Nom, téléphone ou e-mail"
              value={search}
              onChange={(value) => { setSearch(value); setPage(1) }}
            />
            <Tabs
              label="Filtrer les clients"
              value={withoutOrder ? 'without-order' : 'all'}
              onChange={(value) => { setWithoutOrder(value === 'without-order'); setPage(1) }}
              items={[
                { id: 'all', label: 'Tous' },
                { id: 'without-order', label: 'Sans commande' },
              ]}
            />
          </div>
          {errorMessage ? (
            <Card title="Impossible de charger les clients">
              <p role="alert">{errorMessage}</p>
            </Card>
          ) : (
            <DataTable
              columns={columns}
              rows={clients}
              rowKey={(client) => client.id}
              caption="Comptes clients, inscriptions, commandes, dépenses et messages de bienvenue"
              loading={loading}
              loadingRows={5}
              emptyState={(
                <EmptyState
                  title="Aucun compte à afficher"
                  description={search || withoutOrder
                    ? 'Essayez une autre recherche ou désactivez le filtre « Sans commande ».'
                    : 'Les nouveaux comptes apparaîtront ici dès leur inscription.'}
                />
              )}
            />
          )}
          <Pagination
            page={page}
            pageSize={20}
            hasMore={hasMore}
            currentItems={clients.length}
            onPageChange={setPage}
            label="Pagination des clients"
            disabled={loading}
          />
        </Card>
      </div>
    </main>
  )
}

function AdminClientsPageWithQuery() {
  const searchParams = useSearchParams()
  const querySearch = searchParams.get('q') ?? ''
  return <AdminClientsPageContent key={querySearch} initialSearch={querySearch} />
}

export default function AdminClientsPage() {
  return (
    <Suspense fallback={<ClientsLoadingFallback />}>
      <AdminClientsPageWithQuery />
    </Suspense>
  )
}
