'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ImagePlus, RotateCcw, Save, Trash2 } from 'lucide-react'
import { hasJalimsAdminAccess } from '../../../lib/admin-access'
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
  const [checking, setChecking] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [content, setContent] = useState<HomepageContent>(defaultHomepageContent)
  const [designContent, setDesignContent] = useState<HomepageDesignContent>(defaultHomepageDesignContent)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<ImageField | null>(null)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const initialDesignRef = useRef<HomepageDesignContent>(defaultHomepageDesignContent)
  const uploadedPathsRef = useRef<string[]>([])
  const pendingRemovalsRef = useRef<string[]>([])

  useEffect(() => {
    let active = true

    async function loadSettings() {
      const { data: userData, error: authError } = await supabase.auth.getUser()
      if (!active) return
      if (authError || !hasJalimsAdminAccess(userData.user)) {
        setChecking(false)
        return
      }

      setAuthorized(true)
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
        setDesignContent(nextDesign)
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
  }, [])

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
      setFeedback({ kind: 'success', text: 'Image téléversée. Enregistrez les réglages pour la publier.' })
    } catch (error) {
      logClientError('Homepage image upload failed', error)
      setFeedback({ kind: 'error', text: error instanceof Error ? error.message : 'L’image n’a pas pu être téléversée.' })
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
      uploadedPathsRef.current = uploadedPathsRef.current.filter((path) => retainedPaths.has(path))

      pendingRemovalsRef.current = [...new Set([...pendingRemovalsRef.current, ...oldPaths, ...unusedUploads])]
      const cleanupSucceeded = await removeUnusedImages(pendingRemovalsRef.current)
      if (cleanupSucceeded) pendingRemovalsRef.current = []
      setFeedback({
        kind: cleanupSucceeded ? 'success' : 'error',
        text: cleanupSucceeded
          ? 'Les réglages de l’accueil ont été enregistrés.'
          : 'Les réglages sont enregistrés, mais une ancienne image n’a pas pu être supprimée. Réessayez ou contactez le support.',
      })
    } catch (error) {
      logClientError('Homepage settings save failed', error)
      setFeedback({ kind: 'error', text: error instanceof Error ? error.message : 'Les réglages de l’accueil n’ont pas pu être enregistrés.' })
    } finally {
      setSaving(false)
    }
  }

  function restoreDefaults() {
    setDesignContent(defaultHomepageDesignContent)
    setFeedback({ kind: 'success', text: 'Valeurs par défaut rétablies dans l’aperçu. Enregistrez pour les appliquer.' })
  }

  if (checking) return <main className="admin-page"><div className="admin-state">Vérification de l’accès...</div></main>
  if (!authorized) {
    return (
      <main className="admin-page"><section className="admin-access-state">
        <p className="eyebrow">JALIMS · ADMINISTRATION</p>
        <h1>Accès réservé</h1>
        <p>Seul le compte administrateur Jalims peut modifier les textes de la boutique.</p>
        <Link className="admin-primary-link" href="/login?next=%2Fadmin%2Faccueil">Se connecter</Link>
      </section></main>
    )
  }

  return (
    <main className="admin-page">
      <div className="admin-shell home-redesign-admin">
        <header className="admin-header">
          <div><p className="eyebrow">JALIMS <span className="admin-header-divider">/</span> ESPACE ADMIN</p><h1>Accueil de la boutique</h1><p>Modifiez chaque section, vérifiez l’aperçu, puis enregistrez.</p></div>
          <Link className="admin-catalog-link" href="/">Voir la boutique <span aria-hidden="true">↗</span></Link>
        </header>
        <nav className="admin-shortcuts" aria-label="Outils d’administration">
          <Link className="admin-nav-item" href="/admin"><span className="admin-nav-icon" aria-hidden="true">▦</span> Produits</Link>
          <Link className="admin-nav-item" href="/admin/commandes"><span className="admin-nav-icon" aria-hidden="true">↗</span> Commandes</Link>
          <Link className="admin-nav-item" href="/admin/clients"><span className="admin-nav-icon" aria-hidden="true">♙</span> Clients</Link>
          <Link className="admin-nav-item" href="/admin/statistiques"><span className="admin-nav-icon" aria-hidden="true">▤</span> Statistiques</Link>
          <Link className="admin-nav-item" href="/admin/messages"><span className="admin-nav-icon" aria-hidden="true">✉</span> Messages</Link>
          <Link className="admin-nav-item" href="/admin/retraits"><span className="admin-nav-icon" aria-hidden="true">⌖</span> Points de retrait</Link>
          <Link className="admin-nav-item current" href="/admin/accueil"><span className="admin-nav-icon" aria-hidden="true">T</span> Accueil</Link>
          <Link className="admin-nav-item" href="/admin/conditions"><span className="admin-nav-icon" aria-hidden="true">§</span> Conditions</Link>
        </nav>

        <div className="home-redesign-admin-layout">
          <form className="home-redesign-editor" onSubmit={saveSettings}>
            <section className="home-redesign-editor-section">
              <p className="eyebrow">A · BANDEAU SUPÉRIEUR</p>
              <h2>Message et lien</h2>
              <label>Texte<input maxLength={120} value={designContent.announcementText} onChange={(event) => updateDesign('announcementText', event.target.value)} /></label>
              <label>Texte du lien<input maxLength={48} value={designContent.announcementLinkText} onChange={(event) => updateDesign('announcementLinkText', event.target.value)} /></label>
              <label>Lien (chemin interne ou HTTPS)<input maxLength={300} value={designContent.announcementHref} onChange={(event) => updateDesign('announcementHref', event.target.value)} /></label>
            </section>

            <section className="home-redesign-editor-section">
              <p className="eyebrow">B · HERO</p>
              <h2>Bandeau principal</h2>
              <label>Étiquette<input maxLength={80} value={designContent.heroKicker} onChange={(event) => updateDesign('heroKicker', event.target.value)} /></label>
              <label>Première ligne du titre<input maxLength={100} value={designContent.heroTitleLine1} onChange={(event) => updateDesign('heroTitleLine1', event.target.value)} /></label>
              <label>Fin du titre (en jaune)<input maxLength={70} value={designContent.heroTitleHighlight} onChange={(event) => updateDesign('heroTitleHighlight', event.target.value)} /></label>
              <label>Sous-titre<textarea rows={3} maxLength={260} value={designContent.heroSubtitle} onChange={(event) => updateDesign('heroSubtitle', event.target.value)} /></label>
              <label>Texte du bouton<input maxLength={48} value={designContent.heroButtonText} onChange={(event) => updateDesign('heroButtonText', event.target.value)} /></label>
              <label>Lien du bouton (chemin interne ou HTTPS)<input maxLength={300} value={designContent.heroButtonHref} onChange={(event) => updateDesign('heroButtonHref', event.target.value)} /></label>
              <label>Texte alternatif de l’image<input maxLength={180} value={designContent.heroAlt} onChange={(event) => updateDesign('heroAlt', event.target.value)} /></label>
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
            </section>

            <section className="home-redesign-editor-section">
              <p className="eyebrow">C · AVANTAGES</p>
              <h2>Les trois arguments</h2>
              {designContent.benefits.map((benefit, index) => (
                <fieldset className="home-redesign-editor-item" key={index}>
                  <legend>Avantage {index + 1}</legend>
                  <label>Icône
                    <select
                      value={benefit.icon}
                      onChange={(event) => {
                        const benefits = [...designContent.benefits]
                        benefits[index] = { ...benefit, icon: event.target.value as HomepageBenefitIcon }
                        updateDesign('benefits', benefits as HomepageDesignContent['benefits'])
                      }}
                    >
                      {homepageBenefitIcons.map((icon) => <option value={icon} key={icon}>{icon === 'wallet' ? 'Coût / portefeuille' : icon === 'truck' ? 'Transport' : 'Accompagnement'}</option>)}
                    </select>
                  </label>
                  <label>Première ligne<input maxLength={70} value={benefit.firstLine} onChange={(event) => {
                    const benefits = [...designContent.benefits]
                    benefits[index] = { ...benefit, firstLine: event.target.value }
                    updateDesign('benefits', benefits as HomepageDesignContent['benefits'])
                  }} /></label>
                  <label>Deuxième ligne<input maxLength={70} value={benefit.secondLine} onChange={(event) => {
                    const benefits = [...designContent.benefits]
                    benefits[index] = { ...benefit, secondLine: event.target.value }
                    updateDesign('benefits', benefits as HomepageDesignContent['benefits'])
                  }} /></label>
                </fieldset>
              ))}
            </section>

            <section className="home-redesign-editor-section">
              <p className="eyebrow">D · PRODUITS VEDETTES</p>
              <h2>Notre sélection de départ</h2>
              <p className="home-redesign-editor-help">Les produits marqués « vedette » dans le catalogue apparaissent automatiquement dans cette rangée.</p>
              <label>Titre<input maxLength={100} value={designContent.featuredTitle} onChange={(event) => updateDesign('featuredTitle', event.target.value)} /></label>
              <label>Texte du lien<input maxLength={48} value={designContent.featuredLinkText} onChange={(event) => updateDesign('featuredLinkText', event.target.value)} /></label>
              <label>Destination du lien (chemin interne ou HTTPS)<input maxLength={300} value={designContent.featuredHref} onChange={(event) => updateDesign('featuredHref', event.target.value)} /></label>
              <label>Message si aucun produit vedette<input maxLength={120} value={designContent.featuredEmptyText} onChange={(event) => updateDesign('featuredEmptyText', event.target.value)} /></label>
            </section>

            <section className="home-redesign-editor-section">
              <p className="eyebrow">E · ÉTAPES</p>
              <h2>Comment ça fonctionne ?</h2>
              <label>Texte d’introduction<input maxLength={80} value={designContent.processEyebrow} onChange={(event) => updateDesign('processEyebrow', event.target.value)} /></label>
              <label>Titre de la section<input maxLength={100} value={designContent.processTitle} onChange={(event) => updateDesign('processTitle', event.target.value)} /></label>
              {designContent.processSteps.map((step, index) => (
                <fieldset className="home-redesign-editor-item" key={index}>
                  <legend>Étape {index + 1}</legend>
                  <label>Icône
                    <select
                      value={step.icon}
                      onChange={(event) => {
                        const processSteps = [...designContent.processSteps]
                        processSteps[index] = { ...step, icon: event.target.value as HomepageStepIcon }
                        updateDesign('processSteps', processSteps as HomepageDesignContent['processSteps'])
                      }}
                    >
                      {homepageStepIcons.map((icon) => <option value={icon} key={icon}>{icon === 'shopping' ? 'Choisir' : icon === 'package' ? 'Commander' : icon === 'payment' ? 'Payer' : 'Recevoir'}</option>)}
                    </select>
                  </label>
                  <label>Texte<input maxLength={50} value={step.title} onChange={(event) => {
                    const processSteps = [...designContent.processSteps]
                    processSteps[index] = { ...step, title: event.target.value }
                    updateDesign('processSteps', processSteps as HomepageDesignContent['processSteps'])
                  }} /></label>
                </fieldset>
              ))}
              <label>Texte alternatif de l’illustration<input maxLength={180} value={designContent.processImageAlt} onChange={(event) => updateDesign('processImageAlt', event.target.value)} /></label>
              <ImageUpload
                label="Illustration facultative"
                path={designContent.processImagePath}
                slot="process"
                uploading={uploading !== null}
                onUpload={(file) => uploadImage('processImagePath', 'process', file)}
                onRemove={() => updateDesign('processImagePath', null)}
              />
            </section>

            <section className="home-redesign-editor-section">
              <p className="eyebrow">PIED DE PAGE</p>
              <h2>Contact et réseaux</h2>
              {footerFields.map((field) => (
                <label key={field.key}>
                  {field.label}
                  {field.multiline ? (
                    <textarea rows={3} maxLength={1000} value={String(content[field.key])} onChange={(event) => setContent({ ...content, [field.key]: event.target.value })} />
                  ) : (
                    <input
                      type={field.key === 'footer_contact_email' ? 'email' : field.key.endsWith('_url') ? 'url' : 'text'}
                      maxLength={300}
                      value={String(content[field.key])}
                      onChange={(event) => setContent({ ...content, [field.key]: event.target.value })}
                      placeholder={field.hint}
                    />
                  )}
                  <small>{field.hint}</small>
                </label>
              ))}
            </section>

            {feedback && <p className={`admin-feedback ${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.text}</p>}
            <div className="home-redesign-admin-actions">
              <button className="admin-submit" type="submit" disabled={saving || uploading !== null}>
                <Save aria-hidden="true" size={17} /> {saving ? 'Enregistrement...' : 'Enregistrer les modifications'}
              </button>
              <button className="home-redesign-reset" type="button" disabled={saving || uploading !== null} onClick={() => void restoreDefaults()}>
                <RotateCcw aria-hidden="true" size={16} /> Rétablir les valeurs par défaut
              </button>
            </div>
          </form>

          <aside className="home-redesign-preview-panel">
            <div className="home-redesign-preview-heading">
              <p className="eyebrow">APERÇU EN DIRECT</p>
              <span>Les changements ne sont pas publiés avant l’enregistrement.</span>
            </div>
            <HomepageDesignPreview design={designContent} />
          </aside>
        </div>
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

  return (
    <div className="home-redesign-upload">
      <span>{label}</span>
      <small>JPG, PNG ou WebP · 2 Mo maximum. Au-delà de 400 Ko, une option de redimensionnement s’affiche.</small>
      <div className="home-redesign-upload-actions">
        <label className="home-redesign-upload-button" htmlFor={inputId}>
          <ImagePlus aria-hidden="true" size={17} /> {uploading ? 'Compression et envoi...' : path ? 'Remplacer l’image' : 'Choisir une image'}
        </label>
        <input
          id={inputId}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={uploading}
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
          <button type="button" className="home-redesign-remove-image" onClick={onRemove}>
            <Trash2 aria-hidden="true" size={16} /> Retirer
          </button>
        )}
      </div>
      {pendingResize && (
        <div className="home-redesign-editor-help" role="alert">
          <p>Cette image est lourde, elle ralentira le site sur mobile.</p>
          <div className="home-redesign-upload-actions">
            <button
              type="button"
              className="home-redesign-upload-button"
              onClick={() => {
                const file = pendingResize
                setPendingResize(null)
                onUpload(file)
              }}
            >
              Redimensionner à 1600 px maximum en WebP et envoyer
            </button>
            <button type="button" className="home-redesign-remove-image" onClick={() => setPendingResize(null)}>
              Annuler
            </button>
          </div>
        </div>
      )}
      {path && <span className="home-redesign-upload-filename">Image sélectionnée pour l’enregistrement</span>}
    </div>
  )
}
