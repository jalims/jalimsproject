'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'
import { canAccessAdminPath } from '../../../lib/admin-staff-client'
import {
  ORDER_MESSAGE_SAMPLE_VARIABLES,
  ORDER_MESSAGE_TEMPLATE_KEYS,
  ORDER_MESSAGE_VARIABLES,
  renderOrderMessage,
  type OrderMessageTemplate,
  type OrderMessageTemplateKey,
} from '../../../lib/order-messages'
import { supabase } from '../../../lib/supabase'
import { useAdminSession } from '../admin-session-provider'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Skeleton,
  Switch,
  Tabs,
  Textarea,
  useToast,
} from '../_components'

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
  const { userId, role, loading: sessionLoading } = useAdminSession()
  const { toast } = useToast()
  const [checking, setChecking] = useState(true)
  const hasSession = Boolean(userId)
  const [templates, setTemplates] = useState<TemplateEditor[]>([])
  const [settings, setSettings] = useState<MessageSettings>(defaultSettings)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [activeTemplateKey, setActiveTemplateKey] = useState<OrderMessageTemplateKey>('commande_confirmee')
  const [savedSnapshot, setSavedSnapshot] = useState('')
  const currentSnapshot = JSON.stringify({ templates, settings })
  const hasUnsavedChanges = savedSnapshot !== '' && currentSnapshot !== savedSnapshot

  useEffect(() => {
    if (sessionLoading) return
    let active = true
    async function load() {
      if (!userId || !canAccessAdminPath(role, '/admin/messages')) {
        setChecking(false)
        return
      }

      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
        if (sessionError) throw sessionError
        if (!sessionData.session?.access_token) {
          throw new Error('Votre session n’a pas pu être vérifiée. Reconnectez-vous puis réessayez.')
        }
        const response = await fetch('/api/admin/order-messages', {
          headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
        })
        if (!response.ok) {
          throw new Error(await responseError(response, 'Impossible de charger les réglages des messages.'))
        }
        const data: unknown = await response.json()
        if (typeof data !== 'object' || data === null || Array.isArray(data)) {
          throw new Error('La réponse des réglages des messages est invalide.')
        }
        const result = data as { templates?: unknown; settings?: unknown }
        if (!Array.isArray(result.templates) || typeof result.settings !== 'object' || result.settings === null || Array.isArray(result.settings)) {
          throw new Error('Les modèles ou les réglages des messages sont incomplets.')
        }
        if (active) {
          const loadedTemplates = result.templates as TemplateEditor[]
          const loadedSettings = result.settings as MessageSettings
          setTemplates(loadedTemplates)
          setSettings(loadedSettings)
          setSavedSnapshot(JSON.stringify({ templates: loadedTemplates, settings: loadedSettings }))
          setLoadError('')
        }
      } catch (error) {
        console.error('[Admin messages] Configuration load failed', error)
        if (active) {
          setLoadError(error instanceof Error ? error.message : 'Impossible de charger les réglages des messages.')
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

  useEffect(() => {
    if (!hasUnsavedChanges) return
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [hasUnsavedChanges])

  function updateTemplate(templateKey: OrderMessageTemplateKey, patch: Partial<TemplateEditor>) {
    setTemplates((current) => current.map((template) => template.template_key === templateKey
      ? { ...template, ...patch }
      : template))
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaveError('')
    for (const template of templates) {
      const preview = getPreview(template)
      if (preview.error) {
        const message = `${templateLabels[template.template_key]} : ${preview.error}`
        setActiveTemplateKey(template.template_key)
        setSaveError(message)
        toast({ title: 'Modèle invalide', description: message, variant: 'danger' })
        return
      }
    }

    setSaving(true)
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError
      if (!sessionData.session?.access_token) throw new Error('Votre session a expiré. Reconnectez-vous puis réessayez.')
      const response = await fetch('/api/admin/order-messages', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ templates, settings }),
      })
      if (!response.ok) throw new Error(await responseError(response, 'Les modèles et réglages n’ont pas pu être enregistrés.'))
      const result = await response.json() as { message?: unknown }
      setSavedSnapshot(JSON.stringify({ templates, settings }))
      const message = typeof result.message === 'string' ? result.message : 'Les modèles et réglages ont été enregistrés.'
      toast({ title: 'Messages enregistrés', description: message, variant: 'success' })
    } catch (error) {
      console.error('[Admin messages] Configuration save failed', error)
      const message = error instanceof Error ? error.message : 'Impossible de joindre le serveur pour enregistrer les messages.'
      setSaveError(message)
      toast({ title: 'Enregistrement impossible', description: message, variant: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  function retryLoad() {
    setLoadError('')
    setChecking(true)
    setLoadAttempt((attempt) => attempt + 1)
  }

  if (sessionLoading || checking) {
    return (
      <main className="admin-page">
        <div className="admin-shell">
          <PageHeader title="Messages clients" description="Chargement des réglages…" eyebrow="JALIMS · ADMINISTRATION" />
          <Card title="Réglages et modèles"><Skeleton variant="rect" width="100%" height={280} /></Card>
        </div>
      </main>
    )
  }
  if (!hasSession) {
    return (
      <main className="admin-page"><section className="admin-access-state">
        <p className="eyebrow">JALIMS · ADMINISTRATION</p><h1>Accès réservé</h1>
        <p>Connectez-vous avec un compte autorisé pour gérer les messages.</p>
        <Link className="admin-primary-link" href="/login?next=%2Fadmin%2Fmessages">Se connecter</Link>
      </section></main>
    )
  }
  if (!canAccessAdminPath(role, '/admin/messages')) {
    return (
      <main className="admin-page"><section className="admin-access-state">
        <p className="eyebrow">JALIMS · ADMINISTRATION</p><h1>Accès refusé</h1>
        <p>Votre rôle ne permet pas d’accéder à cette page.</p>
        {role === 'order_manager' && <Link className="admin-primary-link" href="/admin/commandes">Aller aux commandes</Link>}
      </section></main>
    )
  }

  if (loadError) {
    return (
      <main className="admin-page">
        <div className="admin-shell">
          <PageHeader title="Messages clients" description="Modèles e-mail et réglages de suivi des commandes." eyebrow="JALIMS · ADMINISTRATION" />
          <Card title="Impossible de charger les messages">
            <EmptyState
              title="Les réglages et modèles n’ont pas été chargés"
              description={loadError}
              action={<Button onClick={retryLoad}>Réessayer</Button>}
            />
          </Card>
        </div>
      </main>
    )
  }

  const activeTemplate = templates.find((template) => template.template_key === activeTemplateKey)
  const activePreview = activeTemplate ? getPreview(activeTemplate) : null

  return (
    <main className="admin-page">
      <div className="admin-shell">
        <PageHeader
          eyebrow="JALIMS · ADMINISTRATION"
          title="Messages clients"
          description="Modèles e-mail et coordonnées utilisées pour le suivi des commandes."
          actions={(
            <>
              {hasUnsavedChanges && <Badge variant="warning">Modifications non enregistrées</Badge>}
              <Link className="admin-catalog-link" href="/admin/produits">Gestion des produits →</Link>
            </>
          )}
        />
        <form onSubmit={save}>
          <Card title="Réglages des messages" description="Coordonnées et délais utilisés pour le suivi des commandes.">
            <Textarea
              label="Adresse du point de retrait"
              maxLength={500}
              rows={2}
              value={settings.pickup_address}
              onChange={(event) => setSettings((current) => ({ ...current, pickup_address: event.target.value }))}
              disabled={saving}
            />
            <Textarea
              label="Horaires du point de retrait"
              maxLength={500}
              rows={2}
              value={settings.pickup_hours}
              onChange={(event) => setSettings((current) => ({ ...current, pickup_hours: event.target.value }))}
              disabled={saving}
            />
            <Input
              label="WhatsApp Jalims"
              type="tel"
              value={settings.whatsapp_jalims}
              onChange={(event) => setSettings((current) => ({ ...current, whatsapp_jalims: event.target.value }))}
              placeholder="+221 77 000 00 00"
              disabled={saving}
            />
            <Input
              label="Expéditeur (adresse @jalims.com obligatoire)"
              maxLength={200}
              value={settings.from_email}
              onChange={(event) => setSettings((current) => ({ ...current, from_email: event.target.value }))}
              hint="Utilisez une adresse valide se terminant par @jalims.com."
              placeholder="Jalims <commandes@jalims.com>"
              disabled={saving}
            />
            <Input
              label="Reply-To (facultatif)"
              type="email"
              maxLength={200}
              value={settings.reply_to}
              onChange={(event) => setSettings((current) => ({ ...current, reply_to: event.target.value }))}
              placeholder="contact@jalims.com"
              disabled={saving}
            />
            <Input
              label="Délai de signalement (heures)"
              type="number"
              min={1}
              max={720}
              value={settings.reporting_delay_hours}
              onChange={(event) => setSettings((current) => ({ ...current, reporting_delay_hours: Number(event.target.value) }))}
              disabled={saving}
            />
            <Input
              label="Délai de remboursement"
              maxLength={200}
              value={settings.refund_delay}
              onChange={(event) => setSettings((current) => ({ ...current, refund_delay: event.target.value }))}
              placeholder="5 à 7 jours ouvrés"
              disabled={saving}
            />
            <Input
              label="Délai estimé par défaut"
              maxLength={120}
              value={settings.delai_estime_par_defaut}
              onChange={(event) => setSettings((current) => ({ ...current, delai_estime_par_defaut: event.target.value }))}
              disabled={saving}
            />
          </Card>
          <Card title="Modèles de messages">
            <Tabs
              id="message-template-tabs"
              panelId="message-template-panel"
              items={ORDER_MESSAGE_TEMPLATE_KEYS.map((templateKey) => ({
                id: templateKey,
                label: templateLabels[templateKey],
              }))}
              value={activeTemplateKey}
              onChange={(value) => setActiveTemplateKey(value as OrderMessageTemplateKey)}
              label="Modèles de messages"
            />
            <div
              id="message-template-panel"
              role="tabpanel"
              aria-labelledby={`message-template-tabs-tab-${ORDER_MESSAGE_TEMPLATE_KEYS.indexOf(activeTemplateKey)}`}
              tabIndex={0}
            >
              {activeTemplate ? (
                <>
                  <Switch
                    label="Actif"
                    checked={activeTemplate.active}
                    onCheckedChange={(active) => updateTemplate(activeTemplate.template_key, { active })}
                    disabled={saving}
                  />
                  <Input
                    label="Objet"
                    maxLength={200}
                    value={activeTemplate.subject}
                    onChange={(event) => updateTemplate(activeTemplate.template_key, { subject: event.target.value })}
                    disabled={saving}
                  />
                  <Textarea
                    label="Corps du message"
                    rows={6}
                    maxLength={10000}
                    value={activeTemplate.body}
                    onChange={(event) => updateTemplate(activeTemplate.template_key, { body: event.target.value })}
                    disabled={saving}
                  />
                  <Card title="Variables autorisées">
                    <p>{ORDER_MESSAGE_VARIABLES[activeTemplate.template_key].map((variable) => <code key={variable}>{`{${variable}}`}</code>)}</p>
                  </Card>
                  <Card title="Aperçu avec des données d’exemple">
                    {activePreview?.error
                      ? <p role="alert">{activePreview.error}</p>
                      : <pre>{activePreview?.text}</pre>}
                  </Card>
                </>
              ) : (
                <EmptyState title="Modèle introuvable" description="Le modèle sélectionné n’est pas présent dans la configuration chargée." />
              )}
            </div>
          </Card>
          {saveError && (
            <Card title="Enregistrement impossible">
              <p role="alert">{saveError}</p>
            </Card>
          )}
          <Button
            type="submit"
            loading={saving}
            disabled={saving || templates.length !== ORDER_MESSAGE_TEMPLATE_KEYS.length}
          >
            Enregistrer les modèles et réglages
          </Button>
        </form>
      </div>
    </main>
  )
}
