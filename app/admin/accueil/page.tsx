'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ImagePlus, RotateCcw, Save, Trash2 } from 'lucide-react'
import { canAccessAdminPath } from '../../../lib/admin-staff-client'
import { logClientError } from '../../../lib/user-facing-errors'
import {
  defaultHomepageContent,
  defaultHomepageDesignContent,
  homepageBenefitIcons,
  homepageStepIcons,
  type HomepageBenefitIcon,
  type HomepageContent,
  type HomepageDesignContent,
  type HomepageStepIcon,
} from '../../../lib/homepage-content'
import { supabase } from '../../../lib/supabase'
import { HomepageDesignPreview } from '../../ui/homepage-redesign-sections'
import { useAdminSession } from '../admin-session-provider'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
  useToast,
} from '../_components'

const footerFields: { key: keyof HomepageContent; label: string; hint: string; multiline?: boolean }[] = [
  { key: 'footer_about_title', label: 'Pied de page · titre à propos', hint: 'Ex. À propos de Jalims' },
  { key: 'footer_about_text', label: 'Pied de page · présentation', hint: 'Courte présentation de l’entreprise', multiline: true },
  { key: 'footer_contact_title', label: 'Pied de page · titre contact', hint: 'Ex. Contact' },
  { key: 'footer_contact_email', label: 'Pied de page · adresse e-mail', hint: 'Ex. contact@jalims.sn' },
  { key: 'footer_contact_phone', label: 'Pied de page · téléphone / WhatsApp', hint: 'Ex. +221 77 000 00 00' },
  { key: 'footer_tiktok_url', label: 'Pied de page · lien TikTok', hint: 'URL HTTPS' },
  { key: 'footer_youtube_url', label: 'Pied de page · lien YouTube', hint: 'URL HTTPS' },
  { key: 'footer_instagram_url', label: 'Pied de page · lien Instagram', hint: 'URL HTTPS' },
  { key: 'footer_facebook_url', label: 'Pied de page · lien Facebook', hint: 'URL HTTPS' },
]

const maximumImageSize = 2 * 1024 * 1024
const imageResizeWarningSize = 400 * 1024
type ImageField = 'heroDesktopImagePath' | 'heroMobileImagePath' | 'processImagePath'
type ImageSlot = 'hero-desktop' | 'hero-mobile' | 'process'

function getImagePaths(content: HomepageDesignContent) {
  return [content.heroDesktopImagePath, content.heroMobileImagePath, content.processImagePath]
    .filter((path): path is string => Boolean(path))
}

function getErrorMessage(body: unknown, fallback: string) {
  if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') {
    return body.error
  }
  return fallback
}

async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token) {
    throw new Error('Votre session a expiré. Reconnectez-vous puis réessayez.')
  }
  return data.session.access_token
}

async function compressImage(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Choisissez une image JPG, PNG ou WebP.')
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('Cette image ne peut pas être compressée dans le navigateur.')
  }

  try {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('La compression d’image n’est pas disponible sur cet appareil.')

    let scale = Math.min(1, 1600 / bitmap.width)
    for (let attempt = 0; attempt < 12; attempt += 1) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

      for (const quality of [0.86, 0.76, 0.66, 0.56]) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
        if (blob && blob.size <= maximumImageSize) {
          return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.webp`, { type: 'image/webp' })
        }
      }
      scale *= 0.78
    }

    throw new Error('Cette image reste trop volumineuse après compression. Choisissez une image plus petite.')
  } finally {
    bitmap.close()
  }
}

export default function AdminHomepageSettingsPage() {
  const { userId, role, loading: sessionLoading } = useAdminSession()
  const { toast } = useToast()
  const [checking, setChecking] = useState(true)
  const hasSession = Boolean(userId)
  const [content, setContent] = useState<HomepageContent>(defaultHomepageContent)
  const [savedContent, setSavedContent] = useState<HomepageContent>(defaultHomepageContent)
  const [designContent, setDesignContent] = useState<HomepageDesignContent>(defaultHomepageDesignContent)
  const [savedDesignContent, setSavedDesignContent] = useState<HomepageDesignContent>(defaultHomepageDesignContent)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<ImageField | null>(null)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [confirmRestoreDefaults, setConfirmRestoreDefaults] = useState(false)
  const initialDesignRef = useRef<HomepageDesignContent>(defaultHomepageDesignContent)
  const uploadedPathsRef = useRef<string[]>([])
  const pendingRemovalsRef = useRef<string[]>([])
  const hasUnsavedDesignChanges = JSON.stringify(designContent) !== JSON.stringify(savedDesignContent)
  const hasUnsavedChanges = hasUnsavedDesignChanges || JSON.stringify(content) !== JSON.stringify(savedContent)

  useEffect(() => {
    if (sessionLoading) return
    let active = true

    async function loadSettings() {
      if (!userId) {
        setChecking(false)
        return
      }

      if (!canAccessAdminPath(role, '/admin/accueil')) {
        setChecking(false)
        return
      }

      try {
        const accessToken = await getAccessToken()
        const response = await fetch('/api/admin/homepage-content', {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        const body: unknown = await response.json()
        if (!response.ok) throw new Error(getErrorMessage(body, 'Impossible de charger les réglages de l’accueil.'))
        if (!active || typeof body !== 'object' || body === null) return

        const settings = body as { content?: HomepageContent; designContent?: HomepageDesignContent }
        const nextContent = { ...defaultHomepageContent, ...settings.content }
        const nextDesign = { ...defaultHomepageDesignContent, ...settings.designContent }
        setContent(nextContent)
        setSavedContent(nextContent)
        setDesignContent(nextDesign)
        setSavedDesignContent(nextDesign)
        initialDesignRef.current = nextDesign
      } catch (error) {
        if (active) {
          logClientError('Homepage settings load failed', error)
          setFeedback({ kind: 'error', text: error instanceof Error ? error.message : 'Impossible de charger les réglages de l’accueil.' })
        }
      } finally {
        if (active) setChecking(false)
      }
    }

    void loadSettings()
    return () => {
      active = false
    }
  }, [role, sessionLoading, userId])

  function updateDesign<K extends keyof HomepageDesignContent>(key: K, value: HomepageDesignContent[K]) {
    setDesignContent((current) => ({ ...current, [key]: value }))
  }

  async function uploadImage(field: ImageField, slot: ImageSlot, selectedFile: File | undefined) {
    if (!selectedFile) return
    setFeedback(null)
    setUploading(field)
    try {
      const file = await compressImage(selectedFile)
      const accessToken = await getAccessToken()
      const formData = new FormData()
      formData.set('file', file)
      formData.set('slot', slot)
      const response = await fetch('/api/admin/homepage-assets', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
      })
      const body: unknown = await response.json()
      if (!response.ok) throw new Error(getErrorMessage(body, 'L’image n’a pas pu être téléversée.'))
      if (typeof body !== 'object' || body === null || !('path' in body) || typeof body.path !== 'string') {
        throw new Error('La réponse du serveur pour cette image est invalide.')
      }
      uploadedPathsRef.current.push(body.path)
      updateDesign(field, body.path)
      toast({ title: 'Image téléversée', description: 'Enregistrez les réglages pour la publier.', variant: 'success' })
    } catch (error) {
      logClientError('Homepage image upload failed', error)
      const message = error instanceof Error ? error.message : 'L’image n’a pas pu être téléversée.'
      setFeedback({ kind: 'error', text: message })
    } finally {
      setUploading(null)
    }
  }

  async function removeUnusedImages(paths: string[]) {
    if (paths.length === 0) return true
    try {
      const accessToken = await getAccessToken()
      const response = await fetch('/api/admin/homepage-assets', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      })
      const body: unknown = await response.json()
      if (!response.ok) throw new Error(getErrorMessage(body, 'Une ancienne image n’a pas pu être supprimée.'))
      return true
    } catch (error) {
      logClientError('Homepage old image cleanup failed', error)
      return false
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFeedback(null)
    setSaving(true)

    try {
      const accessToken = await getAccessToken()
      const response = await fetch('/api/admin/homepage-content', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, designContent }),
      })
      const body: unknown = await response.json()
      if (!response.ok) throw new Error(getErrorMessage(body, 'Les réglages de l’accueil n’ont pas pu être enregistrés.'))

      const retainedPaths = new Set(getImagePaths(designContent))
      const oldPaths = getImagePaths(initialDesignRef.current).filter((path) => !retainedPaths.has(path))
      const unusedUploads = uploadedPathsRef.current.filter((path) => !retainedPaths.has(path))
      initialDesignRef.current = designContent
      setSavedContent(content)
      setSavedDesignContent(designContent)
      uploadedPathsRef.current = uploadedPathsRef.current.filter((path) => retainedPaths.has(path))

      pendingRemovalsRef.current = [...new Set([...pendingRemovalsRef.current, ...oldPaths, ...unusedUploads])]
      const cleanupSucceeded = await removeUnusedImages(pendingRemovalsRef.current)
      if (cleanupSucceeded) pendingRemovalsRef.current = []
      if (cleanupSucceeded) {
        toast({ title: 'Accueil enregistré', description: 'Les réglages de l’accueil ont été enregistrés.', variant: 'success' })
      } else {
        setFeedback({
          kind: 'error',
          text: 'Les réglages sont bien enregistrés, mais une ancienne image n’a pas pu être supprimée. Réessayez ou contactez le support.',
        })
      }
    } catch (error) {
      logClientError('Homepage settings save failed', error)
      const message = error instanceof Error ? error.message : 'Les réglages de l’accueil n’ont pas pu être enregistrés.'
      setFeedback({ kind: 'error', text: message })
    } finally {
      setSaving(false)
    }
  }

  function restoreDefaults() {
    setDesignContent(defaultHomepageDesignContent)
    setFeedback(null)
    setConfirmRestoreDefaults(false)
    toast({
      title: 'Valeurs par défaut rétablies',
      description: 'Elles ne seront publiées qu’après l’enregistrement.',
      variant: 'success',
    })
  }

  if (sessionLoading || checking) {
    return (
      <main className="admin-page">
        <div className="admin-shell">
          <PageHeader title="Accueil de la boutique" description="Chargement des réglages…" eyebrow="JALIMS · ESPACE ADMIN" />
          <Card title="Éditeur de l’accueil"><Skeleton variant="rect" width="100%" height={280} /></Card>
        </div>
      </main>
    )
  }
  if (!hasSession) {
    return (
      <main className="admin-page"><section className="admin-access-state">
        <p className="eyebrow">JALIMS · ADMINISTRATION</p>
        <h1>Accès réservé</h1>
        <p>Connectez-vous avec un compte autorisé pour modifier l’accueil.</p>
        <Link className="admin-primary-link" href="/login?next=%2Fadmin%2Faccueil">Se connecter</Link>
      </section></main>
    )
  }
  if (!canAccessAdminPath(role, '/admin/accueil')) {
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
          eyebrow="JALIMS · ESPACE ADMIN"
          title="Accueil de la boutique"
          description="Modifiez chaque section, vérifiez l’aperçu, puis enregistrez."
          actions={(
            <>
              {hasUnsavedChanges && <Badge variant="warning">Modifications non enregistrées</Badge>}
              <Link className="admin-catalog-link" href="/">Voir la boutique <span aria-hidden="true">↗</span></Link>
            </>
          )}
        />
        {feedback && (
          <Card title={feedback.kind === 'error' ? 'Action impossible' : 'Information'}>
            <p role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.text}</p>
          </Card>
        )}
        <div className="home-redesign-admin-layout">
          <form className="home-redesign-editor" onSubmit={saveSettings}>
            <Card title="Bandeau supérieur" description="Message et lien affichés au-dessus de la page.">
              <Input label="Texte" maxLength={120} value={designContent.announcementText} onChange={(event) => updateDesign('announcementText', event.target.value)} disabled={saving} />
              <Input label="Texte du lien" maxLength={48} value={designContent.announcementLinkText} onChange={(event) => updateDesign('announcementLinkText', event.target.value)} disabled={saving} />
              <Input label="Lien (chemin interne ou HTTPS)" maxLength={300} value={designContent.announcementHref} onChange={(event) => updateDesign('announcementHref', event.target.value)} disabled={saving} />
            </Card>

            <Card title="Bandeau principal" description="Étiquette, contenu du hero et visuels desktop/mobile.">
              <Input label="Étiquette" maxLength={80} value={designContent.heroKicker} onChange={(event) => updateDesign('heroKicker', event.target.value)} disabled={saving} />
              <Input label="Première ligne du titre" maxLength={100} value={designContent.heroTitleLine1} onChange={(event) => updateDesign('heroTitleLine1', event.target.value)} disabled={saving} />
              <Input label="Fin du titre (en jaune)" maxLength={70} value={designContent.heroTitleHighlight} onChange={(event) => updateDesign('heroTitleHighlight', event.target.value)} disabled={saving} />
              <Textarea label="Sous-titre" rows={3} maxLength={260} value={designContent.heroSubtitle} onChange={(event) => updateDesign('heroSubtitle', event.target.value)} disabled={saving} />
              <Input label="Texte du bouton" maxLength={48} value={designContent.heroButtonText} onChange={(event) => updateDesign('heroButtonText', event.target.value)} disabled={saving} />
              <Input label="Lien du bouton (chemin interne ou HTTPS)" maxLength={300} value={designContent.heroButtonHref} onChange={(event) => updateDesign('heroButtonHref', event.target.value)} disabled={saving} />
              <Input label="Texte alternatif de l’image" maxLength={180} value={designContent.heroAlt} onChange={(event) => updateDesign('heroAlt', event.target.value)} disabled={saving} />
              <ImageUpload
                label="Image de fond desktop"
                path={designContent.heroDesktopImagePath}
                slot="hero-desktop"
                uploading={uploading !== null}
                onUpload={(file) => uploadImage('heroDesktopImagePath', 'hero-desktop', file)}
                onRemove={() => updateDesign('heroDesktopImagePath', null)}
              />
              <ImageUpload
                label="Image de fond mobile (facultative)"
                path={designContent.heroMobileImagePath}
                slot="hero-mobile"
                uploading={uploading !== null}
                onUpload={(file) => uploadImage('heroMobileImagePath', 'hero-mobile', file)}
                onRemove={() => updateDesign('heroMobileImagePath', null)}
              />
            </Card>

            <Card title="Les trois arguments">
              {designContent.benefits.map((benefit, index) => (
                <Card key={index} title={`Avantage ${index + 1}`}>
                  <Select
                    label="Icône"
                    value={benefit.icon}
                    disabled={saving}
                    onChange={(event) => {
                      const benefits = [...designContent.benefits]
                      benefits[index] = { ...benefit, icon: event.target.value as HomepageBenefitIcon }
                      updateDesign('benefits', benefits as HomepageDesignContent['benefits'])
                    }}
                  >
                      {homepageBenefitIcons.map((icon) => <option value={icon} key={icon}>{icon === 'wallet' ? 'Coût / portefeuille' : icon === 'truck' ? 'Transport' : 'Accompagnement'}</option>)}
                  </Select>
                  <Input label="Première ligne" maxLength={70} value={benefit.firstLine} disabled={saving} onChange={(event) => {
                    const benefits = [...designContent.benefits]
                    benefits[index] = { ...benefit, firstLine: event.target.value }
                    updateDesign('benefits', benefits as HomepageDesignContent['benefits'])
                  }} />
                  <Input label="Deuxième ligne" maxLength={70} value={benefit.secondLine} disabled={saving} onChange={(event) => {
                    const benefits = [...designContent.benefits]
                    benefits[index] = { ...benefit, secondLine: event.target.value }
                    updateDesign('benefits', benefits as HomepageDesignContent['benefits'])
                  }} />
                </Card>
              ))}
            </Card>

            <Card title="Produits vedettes" description="Les produits marqués « vedette » dans le catalogue apparaissent automatiquement dans cette rangée.">
              <Input label="Titre" maxLength={100} value={designContent.featuredTitle} onChange={(event) => updateDesign('featuredTitle', event.target.value)} disabled={saving} />
              <Input label="Texte du lien" maxLength={48} value={designContent.featuredLinkText} onChange={(event) => updateDesign('featuredLinkText', event.target.value)} disabled={saving} />
              <Input label="Destination du lien (chemin interne ou HTTPS)" maxLength={300} value={designContent.featuredHref} onChange={(event) => updateDesign('featuredHref', event.target.value)} disabled={saving} />
              <Input label="Message si aucun produit vedette" maxLength={120} value={designContent.featuredEmptyText} onChange={(event) => updateDesign('featuredEmptyText', event.target.value)} disabled={saving} />
            </Card>

            <Card title="Étapes" description="Expliquez comment fonctionne la commande.">
              <Input label="Texte d’introduction" maxLength={80} value={designContent.processEyebrow} onChange={(event) => updateDesign('processEyebrow', event.target.value)} disabled={saving} />
              <Input label="Titre de la section" maxLength={100} value={designContent.processTitle} onChange={(event) => updateDesign('processTitle', event.target.value)} disabled={saving} />
              {designContent.processSteps.map((step, index) => (
                <Card key={index} title={`Étape ${index + 1}`}>
                  <Select
                    label="Icône"
                    value={step.icon}
                    disabled={saving}
                    onChange={(event) => {
                      const processSteps = [...designContent.processSteps]
                      processSteps[index] = { ...step, icon: event.target.value as HomepageStepIcon }
                      updateDesign('processSteps', processSteps as HomepageDesignContent['processSteps'])
                    }}
                  >
                      {homepageStepIcons.map((icon) => <option value={icon} key={icon}>{icon === 'shopping' ? 'Choisir' : icon === 'package' ? 'Commander' : icon === 'payment' ? 'Payer' : 'Recevoir'}</option>)}
                  </Select>
                  <Input label="Texte" maxLength={50} value={step.title} disabled={saving} onChange={(event) => {
                    const processSteps = [...designContent.processSteps]
                    processSteps[index] = { ...step, title: event.target.value }
                    updateDesign('processSteps', processSteps as HomepageDesignContent['processSteps'])
                  }} />
                </Card>
              ))}
              <Input label="Texte alternatif de l’illustration" maxLength={180} value={designContent.processImageAlt} onChange={(event) => updateDesign('processImageAlt', event.target.value)} disabled={saving} />
              <ImageUpload
                label="Illustration facultative"
                path={designContent.processImagePath}
                slot="process"
                uploading={uploading !== null}
                onUpload={(file) => uploadImage('processImagePath', 'process', file)}
                onRemove={() => updateDesign('processImagePath', null)}
              />
            </Card>

            <Card title="Pied de page" description="Coordonnées et réseaux affichés sur la boutique.">
              {footerFields.map((field) => (
                <div key={field.key}>
                  {field.multiline ? (
                    <Textarea
                      label={field.label}
                      rows={3}
                      maxLength={1000}
                      value={String(content[field.key])}
                      onChange={(event) => setContent((current) => ({ ...current, [field.key]: event.target.value }))}
                      hint={field.hint}
                      disabled={saving}
                    />
                  ) : (
                    <Input
                      label={field.label}
                      type={field.key === 'footer_contact_email' ? 'email' : field.key.endsWith('_url') ? 'url' : 'text'}
                      maxLength={300}
                      value={String(content[field.key])}
                      onChange={(event) => setContent((current) => ({ ...current, [field.key]: event.target.value }))}
                      placeholder={field.hint}
                      hint={field.hint}
                      disabled={saving}
                    />
                  )}
                </div>
              ))}
            </Card>

            <div className="home-redesign-admin-actions">
              <Button type="submit" loading={saving} disabled={uploading !== null} leadingIcon={<Save size={17} aria-hidden="true" />}>
                Enregistrer les modifications
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={saving || uploading !== null}
                leadingIcon={<RotateCcw size={16} aria-hidden="true" />}
                onClick={() => {
                  if (hasUnsavedDesignChanges) setConfirmRestoreDefaults(true)
                  else restoreDefaults()
                }}
              >
                Rétablir les valeurs par défaut
              </Button>
            </div>
          </form>

          <Card
            title="Aperçu en direct"
            description="Les changements ne sont pas publiés avant l’enregistrement."
            className="home-redesign-preview-panel"
          >
            <HomepageDesignPreview design={designContent} />
          </Card>
        </div>
        <ConfirmDialog
          open={confirmRestoreDefaults}
          onClose={() => {
            if (!saving && uploading === null) setConfirmRestoreDefaults(false)
          }}
          onConfirm={restoreDefaults}
          title="Rétablir les valeurs par défaut ?"
          description="Cette action remplacera les saisies non enregistrées de la présentation de l’accueil. Les valeurs par défaut ne seront publiées qu’après l’enregistrement."
          confirmLabel="Rétablir les valeurs"
          confirmVariant="danger"
          loading={saving || uploading !== null}
        />
      </div>
    </main>
  )
}

function ImageUpload({
  label,
  path,
  slot,
  uploading,
  onUpload,
  onRemove,
}: {
  label: string
  path: string | null
  slot: ImageSlot
  uploading: boolean
  onUpload: (file: File | undefined) => void
  onRemove: () => void
}) {
  const inputId = `homepage-image-${slot}`
  const [pendingResize, setPendingResize] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="home-redesign-upload">
      <span>{label}</span>
      <small>JPG, PNG ou WebP · 2 Mo maximum. Au-delà de 400 Ko, une option de redimensionnement s’affiche.</small>
      <div className="home-redesign-upload-actions">
        <Button
          type="button"
          size="sm"
          variant="outline"
          leadingIcon={<ImagePlus size={17} aria-hidden="true" />}
          loading={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? 'Compression et envoi…' : path ? 'Remplacer l’image' : 'Choisir une image'}
        </Button>
        <input
          ref={fileInputRef}
          id={inputId}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={uploading}
          aria-label={label}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file && file.size > imageResizeWarningSize) {
              setPendingResize(file)
            } else {
              setPendingResize(null)
              onUpload(file)
            }
            event.currentTarget.value = ''
          }}
        />
        {path && (
          <Button
            type="button"
            size="sm"
            variant="danger"
            leadingIcon={<Trash2 size={16} aria-hidden="true" />}
            onClick={onRemove}
          >
            Retirer
          </Button>
        )}
      </div>
      {pendingResize && (
        <Card title="Image volumineuse" description="Cette image est lourde, elle ralentira le site sur mobile.">
          <div className="home-redesign-upload-actions">
            <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={uploading}
              onClick={() => {
                const file = pendingResize
                setPendingResize(null)
                onUpload(file)
              }}
            >
              Redimensionner à 1600 px maximum en WebP et envoyer
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={uploading} onClick={() => setPendingResize(null)}>Annuler</Button>
          </div>
        </Card>
      )}
      {path && <span className="home-redesign-upload-filename">Image sélectionnée pour l’enregistrement</span>}
    </div>
  )
}
