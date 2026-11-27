'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { canAccessAdminPath } from '../../../lib/admin-staff-client'
import { LegalPageBody } from '../../../lib/legal-page-body'
import type { LegalPageVersion } from '../../../lib/legal-page-types'
import { supabase } from '../../../lib/supabase'
import { useAdminSession } from '../admin-session-provider'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Input,
  PageHeader,
  Skeleton,
  Textarea,
  useToast,
} from '../_components'

type EditorResponse = {
  draft: LegalPageVersion | null
  history: LegalPageVersion[]
}

async function responseError(response: Response, fallback: string) {
  try {
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') {
      return body.error
    }
  } catch (error) {
    console.error('[Admin legal pages] Réponse serveur illisible.', {
      errorName: error instanceof Error ? error.name : 'unknown',
    })
  }
  return fallback
}

function formatPublicationDate(value: string | null) {
  return value
    ? new Date(value).toLocaleDateString('fr-FR', { dateStyle: 'long' })
    : 'Non publiée'
}

export default function AdminConditionsPage() {
  const { userId, role, loading: sessionLoading } = useAdminSession()
  const { toast } = useToast()
  const [checking, setChecking] = useState(true)
  const hasSession = Boolean(userId)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [draft, setDraft] = useState<LegalPageVersion | null>(null)
  const [history, setHistory] = useState<LegalPageVersion[]>([])
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [confirmPublish, setConfirmPublish] = useState(false)

  useEffect(() => {
    if (sessionLoading) return
    let active = true

    async function load() {
      if (!userId) {
        setChecking(false)
        return
      }
      if (!canAccessAdminPath(role, '/admin/conditions')) {
        setChecking(false)
        return
      }

      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
        if (sessionError) throw sessionError
        if (!sessionData.session?.access_token) {
          throw new Error('Votre session a expiré. Reconnectez-vous puis réessayez.')
        }
        const response = await fetch('/api/admin/conditions', {
          headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
        })
        if (!response.ok) {
          throw new Error(await responseError(response, 'Impossible de charger les conditions.'))
        }
        const data = await response.json() as EditorResponse
        if (!Array.isArray(data.history)) throw new Error('L’historique des conditions reçu est invalide.')
        if (active) {
          const latestPublished = data.history.find((version) => version.status === 'publie')
          setDraft(data.draft)
          setHistory(data.history)
          setTitle(data.draft?.title ?? latestPublished?.title ?? '')
          setBody(data.draft?.body ?? latestPublished?.body ?? '')
          setLoadError('')
        }
      } catch (error) {
        console.error('[Admin legal pages] Chargement impossible.', {
          errorName: error instanceof Error ? error.name : 'unknown',
        })
        if (active) {
          setLoadError(error instanceof Error ? error.message : 'Impossible de charger les conditions.')
        }
      } finally {
        if (active) setChecking(false)
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [loadAttempt, role, sessionLoading, userId])

  async function submit(action: 'save' | 'publish') {
    setSaveError('')
    setSaving(true)

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError
      if (!sessionData.session?.access_token) throw new Error('Votre session a expiré. Reconnectez-vous puis réessayez.')

      const response = await fetch('/api/admin/conditions', {
        method: action === 'save' ? 'PUT' : 'POST',
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title, body }),
      })
      if (!response.ok) throw new Error(await responseError(response, action === 'save'
        ? 'Le brouillon n’a pas pu être enregistré.'
        : 'La nouvelle version n’a pas pu être publiée.'))

      const result = await response.json() as {
        message: string
        draft?: LegalPageVersion
        version?: LegalPageVersion
      }
      if (action === 'save' && result.draft) {
        const savedDraft = result.draft
        setDraft(savedDraft)
        setHistory((current) => [savedDraft, ...current.filter((item) => item.id !== savedDraft.id)])
      } else if (action === 'publish' && result.version) {
        const publishedVersion = result.version
        setDraft(null)
        setHistory((current) => [publishedVersion, ...current.filter((item) => item.id !== publishedVersion.id)])
        setConfirmPublish(false)
      }
      toast({
        title: action === 'save' ? 'Brouillon enregistré' : 'Nouvelle version publiée',
        description: result.message,
        variant: 'success',
      })
    } catch (error) {
      console.error('[Admin legal pages] Enregistrement impossible.', {
        errorName: error instanceof Error ? error.name : 'unknown',
      })
      const message = error instanceof Error
        ? error.message
        : action === 'save'
          ? 'Le brouillon n’a pas pu être enregistré.'
          : 'La nouvelle version n’a pas pu être publiée.'
      setSaveError(message)
      toast({
        title: action === 'save' ? 'Enregistrement impossible' : 'Publication impossible',
        description: message,
        variant: 'danger',
      })
    } finally {
      setSaving(false)
    }
  }

  function retryLoad() {
    setLoadError('')
    setChecking(true)
    setLoadAttempt((attempt) => attempt + 1)
  }

  const latestPublished = history.find((version) => version.status === 'publie')
  const identicalDraft = Boolean(
    draft
    && latestPublished
    && draft.title === latestPublished.title
    && draft.body === latestPublished.body,
  )

  if (sessionLoading || checking) {
    return (
      <main className="admin-page">
        <div className="admin-shell">
          <PageHeader title="Conditions générales" description="Chargement du brouillon et de l’historique…" eyebrow="JALIMS · ADMINISTRATION" />
          <Card title="Éditeur des conditions"><Skeleton variant="rect" width="100%" height={280} /></Card>
          <Card title="Historique"><Skeleton variant="rect" width="100%" height={120} /></Card>
        </div>
      </main>
    )
  }
  if (!hasSession) {
    return (
      <main className="admin-page"><section className="admin-access-state">
        <p className="eyebrow">JALIMS · ADMINISTRATION</p>
        <h1>Accès réservé</h1>
        <p>Connectez-vous avec un compte autorisé pour modifier les conditions.</p>
        <Link className="admin-primary-link" href="/login?next=%2Fadmin%2Fconditions">Se connecter</Link>
      </section></main>
    )
  }
  if (!canAccessAdminPath(role, '/admin/conditions')) {
    return (
      <main className="admin-page"><section className="admin-access-state">
        <p className="eyebrow">JALIMS · ADMINISTRATION</p>
        <h1>Accès refusé</h1>
        <p>Votre rôle ne permet pas d’accéder à cette page.</p>
        {role === 'order_manager' && <Link className="admin-primary-link" href="/admin/commandes">Aller aux commandes</Link>}
      </section></main>
    )
  }

  if (loadError) {
    return (
      <main className="admin-page">
        <div className="admin-shell">
          <PageHeader title="Conditions générales" description="Modifiez le brouillon puis publiez une nouvelle version." eyebrow="JALIMS · ADMINISTRATION" />
          <Card title="Impossible de charger les conditions">
            <EmptyState
              title="Le brouillon et l’historique n’ont pas été chargés"
              description={loadError}
              action={<Button onClick={retryLoad}>Réessayer</Button>}
            />
          </Card>
        </div>
      </main>
    )
  }

  return (
    <main className="admin-page">
      <div className="admin-shell">
        <PageHeader
          eyebrow="JALIMS · ADMINISTRATION"
          title="Conditions générales"
          description="Modifiez le brouillon puis publiez une nouvelle version."
          actions={<Link className="admin-catalog-link" href="/conditions">Voir la page publique →</Link>}
        />
        {saveError && (
          <Card title="Action impossible">
            <p role="alert">{saveError}</p>
          </Card>
        )}
        <form onSubmit={(event) => {
          event.preventDefault()
          void submit('save')
        }}>
          <Card
            title={draft ? `Brouillon · version ${draft.version}` : 'Nouveau brouillon'}
            description="Le brouillon n’est pas visible publiquement tant qu’il n’est pas publié."
            actions={draft && <Badge variant="warning">Brouillon</Badge>}
          >
            {identicalDraft && (
              <Card title="Brouillon identique à la version publiée">
                <p role="status">Le brouillon est identique à la dernière version publiée.</p>
              </Card>
            )}
            <Input
              label="Titre de la page"
              maxLength={160}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              hint={`${title.length.toLocaleString('fr-FR')} / 160 caractères`}
              disabled={saving}
            />
            <Textarea
              label="Texte des conditions"
              rows={18}
              maxLength={50_000}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              hint={(
                <>
                  Format simple : <code>## titre</code>, <code>- élément</code> et <code>**texte en gras**</code>. Le HTML brut n’est pas interprété.
                  {' '}{body.length.toLocaleString('fr-FR')} / 50 000 caractères.
                </>
              )}
              disabled={saving}
            />
            <Button type="submit" loading={saving}>Enregistrer le brouillon</Button>
            <Button
              type="button"
              variant="danger"
              disabled={saving}
              onClick={() => setConfirmPublish(true)}
            >
              Publier une nouvelle version
            </Button>
          </Card>
          <Card title="Aperçu direct" description="Rendu du texte tel qu’il apparaîtra sur la page publique.">
            <h2>{title || 'Titre de la page'}</h2>
            {body
              ? <LegalPageBody body={body} />
              : <EmptyState title="Aucun texte à afficher" description="L’aperçu apparaîtra dès que le corps des conditions sera renseigné." />}
          </Card>
        </form>

        <Card title="Historique des versions">
          {history.length === 0 ? (
            <EmptyState title="Aucune version enregistrée" description="Les brouillons et versions publiées apparaîtront ici." />
          ) : (
            history.map((version) => (
              <Card
                key={version.id}
                title={`Version ${version.version}`}
                description={formatPublicationDate(version.published_at)}
                actions={<Badge variant={version.status === 'publie' ? 'success' : 'warning'}>{version.status === 'publie' ? 'Publiée' : 'Brouillon'}</Badge>}
              >
                <details>
                  <summary>Ouvrir cette version</summary>
                  <h3>{version.title}</h3>
                  <LegalPageBody body={version.body} />
                </details>
              </Card>
            ))
          )}
        </Card>
        <ConfirmDialog
          open={confirmPublish}
          onClose={() => {
            if (!saving) setConfirmPublish(false)
          }}
          onConfirm={() => void submit('publish')}
          title="Publier une nouvelle version ?"
          description="Cette action publiera le texte actuel. Il sera visible publiquement sur la page des conditions."
          confirmLabel="Publier la nouvelle version"
          loading={saving}
        />
      </div>
    </main>
  )
}
