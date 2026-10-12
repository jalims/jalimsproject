'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'
import { hasJalimsAdminAccess } from '../../../lib/admin-access'
import {
  ORDER_MESSAGE_SAMPLE_VARIABLES,
  ORDER_MESSAGE_TEMPLATE_KEYS,
  ORDER_MESSAGE_VARIABLES,
  renderOrderMessage,
  type OrderMessageTemplate,
  type OrderMessageTemplateKey,
} from '../../../lib/order-messages'
import { supabase } from '../../../lib/supabase'

type MessageSettings = {
  pickup_address: string
  pickup_hours: string
  whatsapp_jalims: string
  from_email: string
  reply_to: string
  reporting_delay_hours: number
  refund_delay: string
  delai_estime_par_defaut: string
}

const defaultSettings: MessageSettings = {
  pickup_address: '',
  pickup_hours: '',
  whatsapp_jalims: '',
  from_email: 'Jalims <commandes@jalims.com>',
  reply_to: '',
  reporting_delay_hours: 48,
  refund_delay: '',
  delai_estime_par_defaut: '5 à 12 jours',
}

const templateLabels: Record<OrderMessageTemplateKey, string> = {
  commande_confirmee: 'Commande confirmée',
  en_transit: 'En transit',
  prete_a_retirer: 'Prête à retirer',
  retard: 'Retard',
  remboursement: 'Remboursement',
}

type TemplateEditor = OrderMessageTemplate & { name: string; active: boolean }

async function responseError(response: Response, fallback: string) {
  try {
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') {
      return body.error
    }
  } catch (error) {
    console.error('[Admin messages] Could not parse server response', error)
  }
  return fallback
}

function getPreview(template: TemplateEditor) {
  try {
    return { text: renderOrderMessage(template, ORDER_MESSAGE_SAMPLE_VARIABLES).text, error: '' }
  } catch (error) {
    return {
      text: '',
      error: error instanceof Error ? error.message : 'Le modèle contient une variable invalide.',
    }
  }
}

export default function AdminMessagesPage() {
  const [checking, setChecking] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [templates, setTemplates] = useState<TemplateEditor[]>([])
  const [settings, setSettings] = useState<MessageSettings>(defaultSettings)
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
        setFeedback({ kind: 'error', text: 'Votre session n’a pas pu être vérifiée. Reconnectez-vous puis réessayez.' })
        setChecking(false)
        return
      }

      try {
        const response = await fetch('/api/admin/order-messages', {
          headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
        })
        if (!response.ok) {
          setFeedback({ kind: 'error', text: await responseError(response, 'Impossible de charger les réglages des messages.') })
        } else {
          const data = await response.json() as { templates: TemplateEditor[]; settings: MessageSettings }
          if (active) {
            setTemplates(data.templates)
            setSettings(data.settings)
          }
        }
      } catch (error) {
        console.error('[Admin messages] Configuration load failed', error)
        if (active) setFeedback({ kind: 'error', text: 'Impossible de joindre le serveur pour charger les messages.' })
      }
      if (active) setChecking(false)
    }

    void load()
    return () => {
      active = false
    }
  }, [])

  function updateTemplate(templateKey: OrderMessageTemplateKey, patch: Partial<TemplateEditor>) {
    setTemplates((current) => current.map((template) => template.template_key === templateKey
      ? { ...template, ...patch }
      : template))
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFeedback(null)
    for (const template of templates) {
      const preview = getPreview(template)
      if (preview.error) {
        setFeedback({ kind: 'error', text: `${templateLabels[template.template_key]} : ${preview.error}` })
        return
      }
    }

    setSaving(true)
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !sessionData.session?.access_token) {
        setFeedback({ kind: 'error', text: 'Votre session a expiré. Reconnectez-vous puis réessayez.' })
        return
      }
      const response = await fetch('/api/admin/order-messages', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ templates, settings }),
      })
      if (!response.ok) {
        setFeedback({ kind: 'error', text: await responseError(response, 'Les modèles et réglages n’ont pas pu être enregistrés.') })
        return
      }
      const result = await response.json() as { message: string }
      setFeedback({ kind: 'success', text: result.message })
    } catch (error) {
      console.error('[Admin messages] Configuration save failed', error)
      setFeedback({ kind: 'error', text: 'Impossible de joindre le serveur pour enregistrer les messages.' })
    } finally {
      setSaving(false)
    }
  }

  if (checking) return <main className="admin-page"><div className="admin-state">Vérification de l’accès...</div></main>
  if (!authorized) {
    return (
      <main className="admin-page"><section className="admin-access-state">
        <p className="eyebrow">JALIMS · ADMINISTRATION</p><h1>Accès réservé</h1>
        <p>Connectez-vous avec le compte administrateur Jalims pour gérer les messages.</p>
        <Link className="admin-primary-link" href="/login?next=%2Fadmin%2Fmessages">Se connecter</Link>
      </section></main>
    )
  }

  return (
    <main className="admin-page">
      <div className="admin-shell order-message-settings-page">
        <header className="admin-header">
          <div><p className="eyebrow">JALIMS · ADMINISTRATION</p><h1>Messages clients</h1><p>Modèles e-mail et coordonnées utilisées pour le suivi des commandes.</p></div>
          <Link className="admin-catalog-link" href="/admin">Gestion des produits →</Link>
        </header>
        <nav className="admin-shortcuts" aria-label="Outils d’administration">
          <Link className="admin-nav-item" href="/admin">Produits</Link>
          <Link className="admin-nav-item" href="/admin/commandes">Commandes</Link>
          <Link className="admin-nav-item current" href="/admin/messages">Messages</Link>
          <Link className="admin-nav-item" href="/admin/retraits">Points de retrait</Link>
          <Link className="admin-nav-item" href="/admin/accueil">Textes accueil</Link>
        </nav>

        {feedback && <p className={`admin-feedback ${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.text}</p>}
        <form onSubmit={save}>
          <section className="admin-form-panel order-message-settings-panel">
            <div className="admin-section-heading"><div><p className="eyebrow">COORDONNÉES ET DÉLAIS</p><h2>Réglages des messages</h2></div></div>
            <div className="homepage-settings-form">
              <label className="wide"><span>Adresse du point de retrait</span><textarea maxLength={500} rows={2} value={settings.pickup_address} onChange={(event) => setSettings({ ...settings, pickup_address: event.target.value })} /></label>
              <label className="wide"><span>Horaires du point de retrait</span><textarea maxLength={500} rows={2} value={settings.pickup_hours} onChange={(event) => setSettings({ ...settings, pickup_hours: event.target.value })} /></label>
              <label><span>WhatsApp Jalims</span><input type="tel" value={settings.whatsapp_jalims} onChange={(event) => setSettings({ ...settings, whatsapp_jalims: event.target.value })} placeholder="+221 77 000 00 00" /></label>
              <label><span>Expéditeur (adresse @jalims.com obligatoire)</span><input maxLength={200} value={settings.from_email} onChange={(event) => setSettings({ ...settings, from_email: event.target.value })} placeholder="Jalims <commandes@jalims.com>" /></label>
              <label><span>Reply-To (facultatif)</span><input type="email" maxLength={200} value={settings.reply_to} onChange={(event) => setSettings({ ...settings, reply_to: event.target.value })} placeholder="contact@jalims.com" /></label>
              <label><span>Délai de signalement (heures)</span><input type="number" min={1} max={720} value={settings.reporting_delay_hours} onChange={(event) => setSettings({ ...settings, reporting_delay_hours: Number(event.target.value) })} /></label>
              <label><span>Délai de remboursement</span><input maxLength={200} value={settings.refund_delay} onChange={(event) => setSettings({ ...settings, refund_delay: event.target.value })} placeholder="5 à 7 jours ouvrés" /></label>
              <label><span>Délai estimé par défaut</span><input maxLength={120} value={settings.delai_estime_par_defaut} onChange={(event) => setSettings({ ...settings, delai_estime_par_defaut: event.target.value })} /></label>
            </div>
          </section>

          <div className="order-message-template-list">
            {templates.map((template) => {
              const preview = getPreview(template)
              return (
                <section className="admin-form-panel order-message-template-card" key={template.template_key}>
                  <div className="admin-section-heading">
                    <div><p className="eyebrow">MODÈLE CLIENT</p><h2>{templateLabels[template.template_key]}</h2></div>
                    <label className="order-message-active"><input type="checkbox" checked={template.active} onChange={(event) => updateTemplate(template.template_key, { active: event.target.checked })} /> Actif</label>
                  </div>
                  <div className="homepage-settings-form">
                    <label className="wide"><span>Objet</span><input maxLength={200} value={template.subject} onChange={(event) => updateTemplate(template.template_key, { subject: event.target.value })} /></label>
                    <label className="wide"><span>Corps du message</span><textarea rows={6} maxLength={10000} value={template.body} onChange={(event) => updateTemplate(template.template_key, { body: event.target.value })} /></label>
                    <div className="order-message-variables"><strong>Variables autorisées</strong><p>{ORDER_MESSAGE_VARIABLES[template.template_key].map((variable) => <code key={variable}>{`{${variable}}`}</code>)}</p></div>
                    <div className="order-message-template-preview">
                      <strong>Aperçu avec des données d’exemple</strong>
                      {preview.error
                        ? <p className="admin-feedback error" role="alert">{preview.error}</p>
                        : <pre>{preview.text}</pre>}
                    </div>
                  </div>
                </section>
              )
            })}
          </div>
          <button className="admin-submit order-message-save" type="submit" disabled={saving || templates.length !== ORDER_MESSAGE_TEMPLATE_KEYS.length}>
            {saving ? 'Enregistrement...' : 'Enregistrer les modèles et réglages'} <span aria-hidden="true">→</span>
          </button>
        </form>
      </div>
    </main>
  )
}
