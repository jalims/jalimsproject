'use client'

import {
  Archive,
  ArrowUpRight,
  Bell,
  CircleHelp,
  Package,
  Plus,
  Trash2,
  Users,
} from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { useAdminSession } from '../../admin-session-provider'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Skeleton,
  StatCard,
  Switch,
  Tabs,
  Textarea,
  useToast,
  type DataTableColumn,
} from '../../_components'

type DemoItem = {
  id: string
  name: string
  category: string
  status: string
  quantity: number
}

const demoRows: DemoItem[] = [
  { id: 'JL-104', name: 'Sac de voyage', category: 'Accessoires', status: 'En stock', quantity: 18 },
  { id: 'JL-103', name: 'Lampe de bureau', category: 'Maison', status: 'Stock bas', quantity: 3 },
  { id: 'JL-102', name: 'Bouteille isotherme', category: 'Maison', status: 'En stock', quantity: 42 },
]

const demoColumns: DataTableColumn<DemoItem>[] = [
  { key: 'name', label: 'Produit', render: (row) => <strong>{row.name}</strong>, sortValue: (row) => row.name },
  { key: 'category', label: 'Catégorie', render: (row) => row.category, sortValue: (row) => row.category },
  {
    key: 'status',
    label: 'Statut',
    render: (row) => <Badge variant={row.quantity <= 3 ? 'warning' : 'success'}>{row.status}</Badge>,
    sortValue: (row) => row.status,
  },
  { key: 'quantity', label: 'Stock', render: (row) => row.quantity, sortValue: (row) => row.quantity },
]

const demoTabs = [
  { id: 'all', label: 'Tout', count: 18 },
  { id: 'active', label: 'Actifs', count: 14 },
  { id: 'draft', label: 'Brouillons', count: 4 },
]

export default function AdminComponentsPage() {
  const { userId, email, role, loading, error } = useAdminSession()
  const { toast } = useToast()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [page, setPage] = useState(2)
  const [activeTab, setActiveTab] = useState('all')
  const [enabled, setEnabled] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  if (loading) {
    return <main className="admin-page"><div className="admin-state">Vérification de l’accès…</div></main>
  }
  if (error) {
    return <main className="admin-page"><section className="admin-access-state"><h1>Accès indisponible</h1><p>{error}</p></section></main>
  }
  if (!userId) {
    return (
      <main className="admin-page">
        <section className="admin-access-state">
          <h1>Connexion requise</h1>
          <p>Cette page de développement est réservée au propriétaire.</p>
          <Link className="admin-primary-link" href="/login?next=%2Fadmin%2F_dev%2Fcomposants">Se connecter</Link>
        </section>
      </main>
    )
  }
  if (role !== 'owner') {
    return (
      <main className="admin-page">
        <section className="admin-access-state">
          <h1>Accès réservé au propriétaire</h1>
          <p>Votre rôle ne permet pas de consulter cette page de développement.</p>
          <Link className="admin-primary-link" href="/admin">Retour à l’administration</Link>
        </section>
      </main>
    )
  }

  return (
    <main className="admin-page">
      <div className="admin-shell">
        <PageHeader
          level={2}
          eyebrow="Bibliothèque admin"
          title="Validation des composants"
          description="Page temporaire pour comparer les états, variantes et comportements avant intégration aux écrans."
          actions={(
            <Button variant="outline" leadingIcon={<ArrowUpRight size={16} />} onClick={() => toast({ title: 'Action de démonstration', description: 'Aucun changement métier n’a été effectué.', variant: 'info' })}>
              Tester une action
            </Button>
          )}
        />
        <p className="admin-ui-demo-session">
          Session : {email} <Badge variant="brand">{role}</Badge>
        </p>

        <section className="admin-ui-demo-section" aria-labelledby="demo-buttons">
          <h2 id="demo-buttons">Button</h2>
          <Card title="Variantes et tailles" description="États normal, disabled et loading.">
            <div className="admin-ui-demo-row">
              <Button leadingIcon={<Plus size={16} />}>Primaire</Button>
              <Button variant="secondary">Secondaire</Button>
              <Button variant="outline">Contour</Button>
              <Button variant="ghost">Fantôme</Button>
              <Button variant="danger" leadingIcon={<Trash2 size={16} />}>Destructif</Button>
            </div>
            <div className="admin-ui-demo-row">
              <Button size="sm">Petit</Button>
              <Button size="md">Moyen</Button>
              <Button size="lg">Grand</Button>
              <Button loading>Chargement</Button>
              <Button disabled>Inactif</Button>
            </div>
          </Card>
        </section>

        <section className="admin-ui-demo-section" aria-labelledby="demo-fields">
          <h2 id="demo-fields">Champs de formulaire</h2>
          <Card title="Input, Select, Textarea et Switch">
            <div className="admin-ui-demo-form-grid">
              <Input label="Nom du produit" placeholder="Ex. Sac de voyage" hint="Visible dans le catalogue." />
              <Input label="Adresse e-mail" type="email" defaultValue="invalide" error="Saisissez une adresse e-mail valide." />
              <Select label="Catégorie" defaultValue="maison">
                <option value="maison">Maison</option>
                <option value="accessoires">Accessoires</option>
                <option value="mode">Mode</option>
              </Select>
              <Textarea label="Description" rows={3} placeholder="Décrivez le produit…" hint="Une description courte et précise." />
              <Switch label="Produit visible" checked={enabled} onCheckedChange={setEnabled} hint={enabled ? 'Visible pour les clients.' : 'Masqué de la boutique.'} />
            </div>
          </Card>
        </section>

        <section className="admin-ui-demo-section" aria-labelledby="demo-badges">
          <h2 id="demo-badges">Badge</h2>
          <Card title="États sémantiques">
            <div className="admin-ui-demo-row">
              <Badge>Neutre</Badge>
              <Badge variant="brand">Jalims</Badge>
              <Badge variant="success">Réussi</Badge>
              <Badge variant="warning">À vérifier</Badge>
              <Badge variant="danger">Erreur</Badge>
              <Badge variant="info">Information</Badge>
            </div>
          </Card>
        </section>

        <section className="admin-ui-demo-section" aria-labelledby="demo-cards">
          <h2 id="demo-cards">Card et StatCard</h2>
          <div className="admin-ui-demo-stats">
            <StatCard label="Commandes" value="128" icon={<Package size={19} />} trend={{ label: '+8 % sur la période', direction: 'up' }} />
            <StatCard label="Clients" value="84" icon={<Users size={19} />} trend={{ label: 'Stable', direction: 'neutral' }} />
            <StatCard label="Demandes" value="6" icon={<Bell size={19} />} trend={{ label: '-2 cette semaine', direction: 'down' }} />
          </div>
          <Card title="Carte standard" description="Titre, description et action facultative." actions={<Button size="sm" variant="ghost">Gérer</Button>}>
            <p className="admin-ui-demo-copy">Le contenu d’une carte peut accueillir des formulaires, des listes ou d’autres composants.</p>
          </Card>
        </section>

        <section className="admin-ui-demo-section" aria-labelledby="demo-table">
          <h2 id="demo-table">DataTable et Pagination</h2>
          <Card title="Produits de démonstration" description="En-têtes triables; en mobile, chaque ligne devient une carte.">
            <DataTable columns={demoColumns} rows={demoRows} rowKey={(row) => row.id} caption="Liste de produits de démonstration" />
            <Pagination page={page} pageSize={5} totalItems={18} onPageChange={setPage} label="Pagination des produits de démonstration" />
          </Card>
          <Card title="État de chargement">
            <DataTable columns={demoColumns} rows={[]} rowKey={(row) => row.id} caption="Chargement de démonstration" loading />
          </Card>
          <Card title="État vide">
            <EmptyState icon={<Archive size={20} />} title="Aucun produit trouvé" description="Essayez un autre terme de recherche." />
          </Card>
        </section>

        <section className="admin-ui-demo-section" aria-labelledby="demo-search">
          <h2 id="demo-search">SearchInput et Tabs</h2>
          <Card title="Recherche et filtres">
            <div className="admin-ui-demo-row">
              <SearchInput value={query} onChange={setQuery} onDebouncedChange={setDebouncedQuery} label="Rechercher dans les produits" placeholder="Nom ou référence…" />
              <span className="admin-ui-demo-copy">Terme temporisé : {debouncedQuery || '—'}</span>
            </div>
            <div className="admin-ui-demo-tabs">
              <Tabs items={demoTabs} value={activeTab} onChange={setActiveTab} label="Filtres de démonstration" />
              <p className="admin-ui-demo-copy">Onglet sélectionné : {activeTab}</p>
            </div>
          </Card>
        </section>

        <section className="admin-ui-demo-section" aria-labelledby="demo-overlays">
          <h2 id="demo-overlays">Modal, ConfirmDialog et Toast</h2>
          <Card title="Actions de démonstration" description="Les overlays se ferment avec Échap et restaurent le focus.">
            <div className="admin-ui-demo-row">
              <Button variant="outline" onClick={() => setModalOpen(true)}>Ouvrir une modale</Button>
              <Button variant="danger" onClick={() => setConfirmOpen(true)}>Tester une confirmation</Button>
              <Button leadingIcon={<CircleHelp size={16} />} onClick={() => toast({ title: 'Tout fonctionne', description: 'Notification de succès de démonstration.', variant: 'success' })}>
                Afficher un toast
              </Button>
            </div>
          </Card>
          <Modal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            title="Modale de démonstration"
            description="La modale garde le focus au clavier et se ferme avec Échap ou le clic extérieur."
            footer={<Button onClick={() => setModalOpen(false)}>Terminer</Button>}
          >
            <p>Contenu de la fenêtre modale. Le focus est restauré au bouton qui l’a ouverte après fermeture.</p>
          </Modal>
          <ConfirmDialog
            open={confirmOpen}
            onClose={() => setConfirmOpen(false)}
            onConfirm={() => {
              setConfirmOpen(false)
              toast({ title: 'Confirmation reçue', variant: 'success' })
            }}
            title="Confirmer l’action de démonstration ?"
            description="Cette action n’écrit aucune donnée et sert uniquement à valider l’interface."
            confirmLabel="Confirmer"
          />
        </section>

        <section className="admin-ui-demo-section" aria-labelledby="demo-skeleton">
          <h2 id="demo-skeleton">Skeleton</h2>
          <Card title="Variantes de chargement">
            <div className="admin-ui-demo-skeletons">
              <Skeleton variant="text" width="65%" />
              <Skeleton variant="rect" width="100%" height={56} />
              <Skeleton variant="circle" />
            </div>
          </Card>
        </section>
      </div>
    </main>
  )
}
