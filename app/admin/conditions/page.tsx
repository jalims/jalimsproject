'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { hasJalimsAdminAccess } from '../../../lib/admin-access'
import { LegalPageBody } from '../../../lib/legal-page-body'
import type { LegalPageVersion } from '../../../lib/legal-page-types'
import { supabase } from '../../../lib/supabase'

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
  const [checking, setChecking] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [draft, setDraft] = useState<LegalPageVersion | null>(null)
  const [history, setHistory] = useState<LegalPageVersion[]>([])
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let active = true

    async function load() {
      const { data: userData, error: authError } = await supabase.auth.getUser()
      if (!active) return
      if (authError || !hasJalimsAdminAccess(userData.user)) {
        setChecking(false)
        return
      }
      setAuthorized(true)

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !sessionData.session?.access_token) {
        setFeedback({ kind: 'error', text: 'Votre session a expiré. Reconnectez-vous puis réessayez.' })
        setChecking(false)
        return
      }

      try {
        const response = await fetch('/api/admin/conditions', {
          headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
        })
        if (!response.ok) {
          setFeedback({ kind: 'error', text: await responseError(response, 'Impossible de charger les conditions.') })
        } else {
          const data = await response.json() as EditorResponse
          if (active) {
            const latestPublished = data.history.find((version) => version.status === 'publie')
            setDraft(data.draft)
            setHistory(data.history)
            setTitle(data.draft?.title ?? latestPublished?.title ?? '')
            setBody(data.draft?.body ?? latestPublished?.body ?? '')
          }
        }
      } catch (error) {
        console.error('[Admin legal pages] Chargement impossible.', {
          errorName: error instanceof Error ? error.name : 'unknown',
        })
        if (active) setFeedback({ kind: 'error', text: 'Impossible de joindre le serveur pour charger les conditions.' })
      }
      if (active) setChecking(false)
    }

    void load()
    return () => {
      active = false
    }
  }, [])

  async function submit(action: 'save' | 'publish') {
    setFeedback(null)
    setSaving(true)

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !sessionData.session?.access_token) {
        setFeedback({ kind: 'error', text: 'Votre session a expiré. Reconnectez-vous puis réessayez.' })
        return
      }

      const response = await fetch('/api/admin/conditions', {
        method: action === 'save' ? 'PUT' : 'POST',
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title, body }),
      })
      if (!response.ok) {
        setFeedback({
          kind: 'error',
          text: await responseError(response, action === 'save'
            ? 'Le brouillon n’a pas pu être enregistré.'
            : 'La nouvelle version n’a pas pu être publiée.'),
        })
        return
      }

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
      }
      setFeedback({ kind: 'success', text: result.message })
    } catch (error) {
      console.error('[Admin legal pages] Enregistrement impossible.', {
        errorName: error instanceof Error ? error.name : 'unknown',
      })
      setFeedback({ kind: 'error', text: 'Impossible de joindre le serveur pour enregistrer les conditions.' })
    } finally {
      setSaving(false)
    }
  }

  const latestPublished = history.find((version) => version.status === 'publie')
  const identicalDraft = Boolean(
    draft
    && latestPublished
    && draft.title === latestPublished.title
    && draft.body === latestPublished.body,
  )

  if (checking) return <main className="admin-page"><div className="admin-state">Vérification de l’accès...</div></main>
  if (!authorized) {
    return (
      <main className="admin-page"><section className="admin-access-state">
        <p className="eyebrow">JALIMS · ADMINISTRATION</p>
        <h1>Accès réservé</h1>
        <p>Connectez-vous avec le compte administrateur Jalims pour modifier les conditions.</p>
        <Link className="admin-primary-link" href="/login?next=%2Fadmin%2Fconditions">Se connecter</Link>
      </section></main>
    )
  }

  return (
    <main className="admin-page">
      <div className="admin-shell legal-admin-shell">
        <header className="admin-header">
          <div><p className="eyebrow">JALIMS · ADMINISTRATION</p><h1>Conditions générales</h1><p>Modifiez le brouillon puis publiez une nouvelle version.</p></div>
          <Link className="admin-catalog-link" href="/conditions">Voir la page publique →</Link>
        </header>
        <nav className="admin-shortcuts" aria-label="Outils d’administration">
          <Link className="admin-nav-item" href="/admin">Produits</Link>
          <Link className="admin-nav-item" href="/admin/commandes">Commandes</Link>
          <Link className="admin-nav-item" href="/admin/messages">Messages</Link>
          <Link className="admin-nav-item" href="/admin/retraits">Points de retrait</Link>
          <Link className="admin-nav-item" href="/admin/accueil">Textes accueil</Link>
          <Link className="admin-nav-item current" href="/admin/conditions">Conditions</Link>
        </nav>

        {feedback && <p className={`admin-feedback ${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.text}</p>}
        <form className="legal-admin-layout" onSubmit={(event) => {
          event.preventDefault()
          void submit('save')
        }}>
          <section className="admin-form-panel legal-editor-panel">
            <div className="admin-section-heading">
              <div><p className="eyebrow">ÉDITION</p><h2>{draft ? `Brouillon · version ${draft.version}` : 'Nouveau brouillon'}</h2></div>
            </div>
            {identicalDraft && (
              <p className="legal-admin-warning" role="status">Le brouillon est identique à la dernière version publiée.</p>
            )}
            <label className="legal-admin-field">
              <span>Titre de la page</span>
              <input maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="legal-admin-field">
              <span>Texte des conditions</span>
              <small>Format simple : ## titre, - élément de liste et **texte en gras**. Le HTML brut n’est pas interprété.</small>
              <textarea rows={18} maxLength={50_000} value={body} onChange={(event) => setBody(event.target.value)} />
              <small>{body.length.toLocaleString('fr-FR')} / 50 000 caractères</small>
            </label>
            <div className="legal-admin-actions">
              <button className="admin-submit" type="submit" disabled={saving}>
                {saving ? 'Enregistrement...' : 'Enregistrer le brouillon'}
              </button>
              <button className="legal-admin-publish" type="button" disabled={saving} onClick={() => void submit('publish')}>
                {saving ? 'Publication...' : 'Publier une nouvelle version'}
              </button>
            </div>
          </section>

          <section className="admin-form-panel legal-preview-panel">
            <div className="admin-section-heading"><div><p className="eyebrow">APERÇU EN DIRECT</p><h2>{title || 'Titre de la page'}</h2></div></div>
            {body ? <LegalPageBody body={body} /> : <p className="legal-admin-placeholder">L’aperçu du texte apparaîtra ici.</p>}
          </section>
        </form>

        <section className="admin-form-panel legal-history-panel">
          <div className="admin-section-heading"><div><p className="eyebrow">VERSIONS</p><h2>Historique</h2></div></div>
          {history.length === 0 ? (
            <p className="legal-admin-placeholder">Aucune version enregistrée.</p>
          ) : (
            <div className="legal-admin-history">
              {history.map((version) => (
                <details className="legal-admin-version" key={version.id}>
                  <summary>
                    <strong>Version {version.version}</strong>
                    <span className={version.status === 'publie' ? 'is-published' : 'is-draft'}>{version.status === 'publie' ? 'Publiée' : 'Brouillon'}</span>
                    <time>{formatPublicationDate(version.published_at)}</time>
                  </summary>
                  <h3>{version.title}</h3>
                  <LegalPageBody body={version.body} />
                </details>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
