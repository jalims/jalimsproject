'use client'

import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

type Props = {
  initialSearchQuery?: string
  onSuccess?: () => void
  onClose?: () => void
  compact?: boolean
  showCloseButton?: boolean
}

type FieldErrors = {
  whatsapp?: string
  photoOrLink?: string
  submit?: string
}

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024
const MAX_IMAGE_WIDTH = 1600
const JPEG_QUALITY = 0.8

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('image_load_failed'))
    }
    image.src = objectUrl
  })
}

async function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('blob_failed'))
        return
      }
      resolve(blob)
    }, 'image/jpeg', quality)
  })
}

async function compressImage(file: File): Promise<File> {
  let image: HTMLImageElement
  try {
    image = await loadImageFromFile(file)
  } catch {
    throw new Error('Impossible de lire cette photo. Essaie avec une autre photo.')
  }

  const sourceWidth = image.naturalWidth || image.width
  const sourceHeight = image.naturalHeight || image.height
  if (!sourceWidth || !sourceHeight) {
    throw new Error('Impossible de lire cette photo. Essaie avec une autre photo.')
  }

  const scale = sourceWidth > MAX_IMAGE_WIDTH ? MAX_IMAGE_WIDTH / sourceWidth : 1
  const targetWidth = Math.max(1, Math.round(sourceWidth * scale))
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Impossible de préparer la photo. Essaie avec une autre photo.')
  }

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, targetWidth, targetHeight)
  context.drawImage(image, 0, 0, targetWidth, targetHeight)

  const qualities = [JPEG_QUALITY, 0.72, 0.64, 0.56, 0.48]
  let blob: Blob | null = null
  for (const quality of qualities) {
    blob = await canvasToJpegBlob(canvas, quality)
    if (blob.size < MAX_UPLOAD_BYTES) break
  }

  if (!blob || blob.size >= MAX_UPLOAD_BYTES) {
    throw new Error('La photo est trop lourde. Choisis une autre photo.')
  }

  const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo-produit'
  return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() })
}

export default function ProductRequestForm({ initialSearchQuery = '', onSuccess, onClose }: Props) {
  const idPrefix = useId().replace(/:/g, '')
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const previewUrlRef = useRef<string | null>(null)

  const [whatsapp, setWhatsapp] = useState('')
  const [link, setLink] = useState('')
  const [description, setDescription] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [preparingImage, setPreparingImage] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})

  const loading = submitting || preparingImage
  const trimmedSearch = initialSearchQuery.trim()

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    }
  }, [])

  function setPreview(file: File | null) {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
    if (!file) {
      setImagePreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    previewUrlRef.current = url
    setImagePreview(url)
  }

  async function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setErrors((current) => ({ ...current, photoOrLink: undefined, submit: undefined }))
    setPreparingImage(true)
    try {
      const compressed = await compressImage(file)
      setImageFile(compressed)
      setPreview(compressed)
    } catch (error) {
      setImageFile(null)
      setPreview(null)
      setErrors((current) => ({
        ...current,
        photoOrLink: error instanceof Error ? error.message : 'Impossible de lire cette photo.',
      }))
      if (fileInputRef.current) fileInputRef.current.value = ''
    } finally {
      setPreparingImage(false)
    }
  }

  function clearImage() {
    setImageFile(null)
    setPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleClose() {
    if (onClose) {
      onClose()
      return
    }
    router.push('/')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (loading) return

    const form = event.currentTarget
    const honeypot = (new FormData(form).get('company_website') as string | null) ?? ''
    const trimmedWhatsapp = whatsapp.trim()
    const trimmedLink = link.trim()
    const trimmedDescription = description.trim()

    const nextErrors: FieldErrors = {}
    if (!trimmedWhatsapp) nextErrors.whatsapp = 'Entre un numéro WhatsApp valide'
    if (!imageFile && !trimmedLink) nextErrors.photoOrLink = 'Ajoute une photo ou un lien'
    if (nextErrors.whatsapp || nextErrors.photoOrLink) {
      setErrors(nextErrors)
      return
    }

    setErrors({})
    setSubmitting(true)
    try {
      const body = new FormData()
      body.set('whatsapp', trimmedWhatsapp)
      body.set('search_query', trimmedSearch)
      body.set('link', trimmedLink)
      body.set('description', trimmedDescription)
      body.set('company_website', honeypot)
      if (imageFile) body.set('image', imageFile, imageFile.name)

      const headers: Record<string, string> = {}
      try {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        if (token) headers.Authorization = `Bearer ${token}`
      } catch {
        // Envoi possible sans session.
      }

      const response = await fetch('/api/product-requests', {
        method: 'POST',
        headers,
        body,
      })

      const payload = await response.json().catch(() => null) as { error?: string; ok?: boolean } | null
      if (!response.ok) {
        const message = payload?.error || 'Impossible d’envoyer la demande. Réessaie.'
        if (message.toLowerCase().includes('whatsapp')) {
          setErrors({ whatsapp: 'Entre un numéro WhatsApp valide' })
        } else if (message.toLowerCase().includes('photo') || message.toLowerCase().includes('lien')) {
          setErrors({ photoOrLink: 'Ajoute une photo ou un lien' })
        } else {
          setErrors({ submit: message })
        }
        return
      }

      setSuccess(true)
      onSuccess?.()
    } catch {
      setErrors({ submit: 'Impossible d’envoyer la demande. Réessaie.' })
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="product-request-form" role="status" aria-live="polite">
        <div className="product-request-header">
          <h2 className="product-request-title">Je ne trouve pas mon produit</h2>
          <button type="button" className="product-request-close" onClick={handleClose} aria-label="Fermer">
            ×
          </button>
        </div>
        <p className="product-request-subtitle">On te répond sur WhatsApp sous 24h.</p>
        <div className="product-request-success-card">
          <div className="product-request-success-icon" aria-hidden="true">✓</div>
          <p className="product-request-success-title">Demande reçue ! On te répond sur WhatsApp sous 24h.</p>
          <div className="product-request-actions product-request-actions-single">
            <button type="button" className="product-request-submit" onClick={handleClose}>
              Fermer
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <form className="product-request-form" onSubmit={handleSubmit} noValidate>
      <div className="product-request-header">
        <h2 className="product-request-title">Je ne trouve pas mon produit</h2>
        <button type="button" className="product-request-close" onClick={handleClose} aria-label="Fermer">
          ×
        </button>
      </div>
      <p className="product-request-subtitle">On te répond sur WhatsApp sous 24h.</p>

      <div className="product-request-grid">
        <div className="product-request-field">
          <label className="product-request-label" htmlFor={`${idPrefix}-whatsapp`}>
            Ton numéro WhatsApp
          </label>
          <input
            id={`${idPrefix}-whatsapp`}
            name="whatsapp"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="77 123 45 67"
            value={whatsapp}
            onChange={(event) => {
              setWhatsapp(event.target.value)
              if (errors.whatsapp) setErrors((current) => ({ ...current, whatsapp: undefined }))
            }}
            disabled={loading}
            aria-invalid={errors.whatsapp ? 'true' : 'false'}
          />
          {errors.whatsapp && <p className="product-request-field-error">{errors.whatsapp}</p>}
        </div>

        <div className="product-request-field">
          <span className="product-request-label">Photo du produit</span>

          <input
            ref={fileInputRef}
            id={`${idPrefix}-image`}
            name="image"
            type="file"
            accept="image/*"
            className="product-request-file-input"
            onChange={handleImageChange}
            disabled={loading}
          />

          {!imagePreview ? (
            <button
              type="button"
              className="product-request-photo-button"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
            >
              <span className="product-request-photo-icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.086a1 1 0 0 0 .707-.293l.914-.914A2 2 0 0 1 10.621 4h2.758a2 2 0 0 1 1.414.586l.914.914a1 1 0 0 0 .707.293H17.5A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z" stroke="currentColor" strokeWidth="1.8"/>
                  <circle cx="12" cy="12.5" r="3.25" stroke="currentColor" strokeWidth="1.8"/>
                </svg>
              </span>
              <span>{preparingImage ? 'Préparation…' : 'Ajouter une photo'}</span>
            </button>
          ) : (
            <div className="product-request-photo-preview">
              <img src={imagePreview} alt="Aperçu du produit" className="product-request-photo-thumb" />
              <div className="product-request-photo-actions">
                <button
                  type="button"
                  className="product-request-photo-small"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                >
                  Changer
                </button>
                <button
                  type="button"
                  className="product-request-photo-small product-request-photo-remove"
                  onClick={clearImage}
                  disabled={loading}
                  aria-label="Retirer la photo"
                >
                  Retirer
                </button>
              </div>
            </div>
          )}
          {errors.photoOrLink && <p className="product-request-field-error">{errors.photoOrLink}</p>}
        </div>

        <div className="product-request-or" aria-hidden="true"><span>ou</span></div>

        <div className="product-request-field">
          <label className="product-request-label" htmlFor={`${idPrefix}-link`}>
            Lien du produit
          </label>
          <input
            id={`${idPrefix}-link`}
            name="link"
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="Colle le lien ici"
            value={link}
            onChange={(event) => {
              setLink(event.target.value)
              if (errors.photoOrLink) setErrors((current) => ({ ...current, photoOrLink: undefined }))
            }}
            disabled={loading}
          />
        </div>

        <div className="product-request-field">
          <label className="product-request-label" htmlFor={`${idPrefix}-description`}>
            Quantité ou détails (optionnel)
          </label>
          <input
            id={`${idPrefix}-description`}
            name="description"
            type="text"
            autoComplete="off"
            placeholder="Ex. 10 pièces, couleur noire"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={loading}
          />
        </div>

        <input type="hidden" name="search_query" value={trimmedSearch} />

        <div className="product-request-honeypot" aria-hidden="true">
          <input
            id={`${idPrefix}-company-website`}
            name="company_website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            defaultValue=""
          />
        </div>
      </div>

      {errors.submit && <p className="product-request-field-error product-request-field-error-submit">{errors.submit}</p>}

      <div className="product-request-actions product-request-actions-single">
        <button type="submit" className="product-request-submit" disabled={loading}>
          {submitting ? 'Envoi…' : preparingImage ? 'Préparation…' : 'Envoyer la demande'}
        </button>
      </div>
    </form>
  )
}
