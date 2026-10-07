'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useState } from 'react'
import { hasJalimsAdminAccess } from '../../../lib/admin-access'
import { logClientError } from '../../../lib/user-facing-errors'
import { defaultHomepageContent, type HomepageContent } from '../../../lib/homepage-content'
import { supabase } from '../../../lib/supabase'

const textFields: { key: keyof HomepageContent; label: string; hint: string; multiline?: boolean }[] = [
  { key: 'utility_primary', label: 'Message de la barre supérieure', hint: 'Ex. Transport et dédouanement simplifiés' },
  { key: 'utility_secondary', label: 'Texte secondaire de la barre', hint: 'Ex. Du marché chinois jusqu’au Sénégal' },
  { key: 'hero_kicker', label: 'Petit titre du bandeau', hint: 'Phrase courte affichée au-dessus du grand titre' },
  { key: 'hero_title', label: 'Grand titre du bandeau', hint: 'Pour passer à la ligne, appuyez sur Entrée', multiline: true },
  { key: 'hero_description', label: 'Description du bandeau', hint: 'Expliquez simplement le service Jalims', multiline: true },
  { key: 'hero_cta', label: 'Texte du bouton principal', hint: 'Ex. Explorer les produits' },
  { key: 'hero_local_note', label: 'Texte de proximité', hint: 'Ex. Pensé pour les commerçants sénégalais' },
  { key: 'benefit_one_title', label: 'Avantage 1 · titre', hint: 'Ex. Un seul parcours' },
  { key: 'benefit_one_description', label: 'Avantage 1 · description', hint: 'Une courte précision' },
  { key: 'benefit_two_title', label: 'Avantage 2 · titre', hint: 'Ex. Dédouanement géré' },
  { key: 'benefit_two_description', label: 'Avantage 2 · description', hint: 'Une courte précision' },
  { key: 'benefit_three_title', label: 'Avantage 3 · titre', hint: 'Ex. Retrait au Sénégal' },
  { key: 'benefit_three_description', label: 'Avantage 3 · description', hint: 'Une courte précision' },
  { key: 'footer_about_title', label: 'Footer · titre à propos', hint: 'Ex. À propos de Jalims' },
  { key: 'footer_about_text', label: 'Footer · présentation', hint: 'Courte présentation de l’entreprise', multiline: true },
  { key: 'footer_contact_title', label: 'Footer · titre contact', hint: 'Ex. Contact' },
  { key: 'footer_contact_email', label: 'Footer · adresse e-mail', hint: 'Ex. contact@jalims.sn' },
  { key: 'footer_contact_phone', label: 'Footer · téléphone / WhatsApp', hint: 'Ex. +221 77 000 00 00' },
  { key: 'footer_tiktok_url', label: 'Footer · lien TikTok', hint: 'https://www.tiktok.com/@votrecompte' },
  { key: 'footer_youtube_url', label: 'Footer · lien YouTube', hint: 'https://www.youtube.com/@votrecompte' },
  { key: 'footer_instagram_url', label: 'Footer · lien Instagram', hint: 'https://www.instagram.com/votrecompte' },
  { key: 'footer_facebook_url', label: 'Footer · lien Facebook', hint: 'https://www.facebook.com/votrepage' },
]

export default function AdminHomepageSettingsPage() {
  const [checking, setChecking] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [content, setContent] = useState<HomepageContent>(defaultHomepageContent)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

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
      const { data, error } = await supabase
        .from('homepage_content')
        .select('*')
        .eq('id', 1)
        .maybeSingle()

      if (!active) return
      if (error) {
        logClientError('Homepage settings load failed', error)
        setFeedback({ kind: 'error', text: 'Impossible de charger les textes de l’accueil pour le moment.' })
      } else if (data) {
        setContent({ ...defaultHomepageContent, ...data })
      }
      setChecking(false)
    }

    void loadSettings()
    return () => {
      active = false
    }
  }, [])

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFeedback(null)
    setSaving(true)

    const { data: authData, error: authError } = await supabase.auth.refreshSession()
    if (authError || !hasJalimsAdminAccess(authData.session?.user)) {
      setSaving(false)
      setFeedback({ kind: 'error', text: 'Accès refusé. Reconnectez-vous avec jalimsofficiel@gmail.com après vérification du rôle admin.' })
      return
    }

    const { error } = await supabase
      .from('homepage_content')
      .upsert({ ...content, id: 1, updated_at: new Date().toISOString() }, { onConflict: 'id' })
    setSaving(false)

    if (error) {
      logClientError('Homepage settings save failed', error)
      setFeedback({ kind: 'error', text: 'Les textes de l’accueil n’ont pas pu être enregistrés.' })
      return
    }

    setFeedback({ kind: 'success', text: 'Les textes de l’accueil ont été mis à jour.' })
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
      <div className="admin-shell">
        <header className="admin-header">
          <div><p className="eyebrow">JALIMS <span className="admin-header-divider">/</span> ESPACE ADMIN</p><h1>Textes de l’accueil</h1><p>Modifiez les messages présentés aux visiteurs de la boutique.</p></div>
          <Link className="admin-catalog-link" href="/">Voir la boutique <span aria-hidden="true">↗</span></Link>
        </header>
        <nav className="admin-shortcuts" aria-label="Outils d’administration">
          <Link className="admin-nav-item" href="/admin"><span className="admin-nav-icon" aria-hidden="true">▦</span> Produits</Link>
          <Link className="admin-nav-item" href="/admin/commandes"><span className="admin-nav-icon" aria-hidden="true">↗</span> Commandes</Link>
          <Link className="admin-nav-item" href="/admin/retraits"><span className="admin-nav-icon" aria-hidden="true">⌖</span> Points de retrait</Link>
          <Link className="admin-nav-item current" href="/admin/accueil"><span className="admin-nav-icon" aria-hidden="true">T</span> Textes accueil</Link>
        </nav>

        <div className="homepage-settings-layout">
          <section className="admin-form-panel">
            <div className="admin-section-heading"><div><p className="eyebrow">CONTENU DE LA BOUTIQUE</p><h2>Messages affichés sur l’accueil</h2></div></div>
            <form className="homepage-settings-form" onSubmit={saveSettings}>
              {textFields.map((field) => (
                <label className={field.multiline ? 'wide' : ''} key={field.key}>
                  <span>{field.label}</span>
                  {field.multiline ? (
                    <textarea rows={field.key === 'hero_title' ? 3 : 4} maxLength={field.key === 'hero_title' ? 100 : 500} value={String(content[field.key] ?? '')} onChange={(event) => setContent({ ...content, [field.key]: event.target.value })} placeholder={field.hint} />
                  ) : field.key.startsWith('footer_') && field.key.endsWith('_url') ? (
                    <input type="url" maxLength={300} value={String(content[field.key] ?? '')} onChange={(event) => setContent({ ...content, [field.key]: event.target.value })} placeholder={field.hint} />
                  ) : field.key === 'footer_contact_email' ? (
                    <input type="email" maxLength={160} value={String(content[field.key] ?? '')} onChange={(event) => setContent({ ...content, [field.key]: event.target.value })} placeholder={field.hint} />
                  ) : (
                    <input maxLength={120} value={String(content[field.key] ?? '')} onChange={(event) => setContent({ ...content, [field.key]: event.target.value })} placeholder={field.hint} />
                  )}
                  <small>{field.hint}</small>
                </label>
              ))}
              {feedback && <p className={`admin-feedback ${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.text}</p>}
              <button className="admin-submit homepage-settings-submit" type="submit" disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer les textes'} <span aria-hidden="true">→</span></button>
            </form>
          </section>

          <aside className="homepage-preview-panel">
            <p className="eyebrow">APERÇU</p>
            <span className="homepage-preview-kicker">{content.hero_kicker || 'Votre titre court'}</span>
            <h2>{content.hero_title.split('\n').map((line, index) => <span key={`${line}-${index}`}>{line}</span>)}</h2>
            <p>{content.hero_description}</p>
            <span className="homepage-preview-button">{content.hero_cta}</span>
            <div className="homepage-preview-benefits">
              <strong>{content.benefit_one_title}</strong><span>{content.benefit_one_description}</span>
              <strong>{content.benefit_two_title}</strong><span>{content.benefit_two_description}</span>
              <strong>{content.benefit_three_title}</strong><span>{content.benefit_three_description}</span>
            </div>
          </aside>
        </div>
      </div>
    </main>
  )
}
