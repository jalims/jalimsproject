export type HomepageContent = {
  id?: number
  utility_primary: string
  utility_secondary: string
  hero_kicker: string
  hero_title: string
  hero_description: string
  hero_cta: string
  hero_local_note: string
  benefit_one_title: string
  benefit_one_description: string
  benefit_two_title: string
  benefit_two_description: string
  benefit_three_title: string
  benefit_three_description: string
  footer_about_title: string
  footer_about_text: string
  footer_contact_title: string
  footer_contact_email: string
  footer_contact_phone: string
  footer_tiktok_url: string
  footer_youtube_url: string
  footer_instagram_url: string
  footer_facebook_url: string
}

export type HomepageBenefitIcon = 'wallet' | 'truck' | 'support'
export type HomepageStepIcon = 'shopping' | 'package' | 'payment' | 'check'

export type HomepageBenefit = {
  icon: HomepageBenefitIcon
  firstLine: string
  secondLine: string
}

export type HomepageStep = {
  icon: HomepageStepIcon
  title: string
}

export type HomepageDesignContent = {
  announcementText: string
  announcementLinkText: string
  announcementHref: string
  heroKicker: string
  heroTitleLine1: string
  heroTitleHighlight: string
  heroSubtitle: string
  heroButtonText: string
  heroButtonHref: string
  heroAlt: string
  heroDesktopImagePath: string | null
  heroMobileImagePath: string | null
  benefits: [HomepageBenefit, HomepageBenefit, HomepageBenefit]
  featuredTitle: string
  featuredLinkText: string
  featuredHref: string
  featuredEmptyText: string
  processEyebrow: string
  processTitle: string
  processSteps: [HomepageStep, HomepageStep, HomepageStep, HomepageStep]
  processImagePath: string | null
  processImageAlt: string
}

export const homepageBenefitIcons: HomepageBenefitIcon[] = ['wallet', 'truck', 'support']
export const homepageStepIcons: HomepageStepIcon[] = ['shopping', 'package', 'payment', 'check']

export const defaultHomepageDesignContent: HomepageDesignContent = {
  announcementText: 'Transport et dédouanement simplifiés',
  announcementLinkText: 'En savoir plus',
  announcementHref: '#how-it-works',
  heroKicker: 'LA CHINE, PLUS PROCHE DE VOUS',
  heroTitleLine1: 'Ce que tu recherches en Chine.',
  heroTitleHighlight: 'Plus simplement.',
  heroSubtitle: 'Choisis tes produits en Chine, nous organisons leur transport et leur dédouanement jusqu’au Sénégal.',
  heroButtonText: 'Explorer les produits',
  heroButtonHref: '#products',
  heroAlt: 'Une sélection de produits disponibles depuis la Chine',
  heroDesktopImagePath: null,
  heroMobileImagePath: null,
  benefits: [
    { icon: 'wallet', firstLine: 'Comprends ton coût', secondLine: 'avant de commander' },
    { icon: 'truck', firstLine: 'Un transport et', secondLine: 'dédouanement simplifiés' },
    { icon: 'support', firstLine: 'Un accompagnement', secondLine: 'à chaque étape' },
  ],
  featuredTitle: 'Notre sélection de départ',
  featuredLinkText: 'Voir plus',
  featuredHref: '#products',
  featuredEmptyText: 'Les produits vedettes apparaîtront ici.',
  processEyebrow: 'SIMPLE, DE BOUT EN BOUT',
  processTitle: 'Comment ça fonctionne ?',
  processSteps: [
    { icon: 'shopping', title: 'Choisir' },
    { icon: 'package', title: 'Commander' },
    { icon: 'payment', title: 'Payer' },
    { icon: 'check', title: 'Recevoir' },
  ],
  processImagePath: null,
  processImageAlt: 'Livraison de votre commande au Sénégal',
}

export const defaultHomepageContent: HomepageContent = {
  utility_primary: 'Transport et dédouanement simplifiés',
  utility_secondary: 'Du marché chinois jusqu’au Sénégal',
  hero_kicker: 'LA CHINE, PLUS PROCHE DE VOUS',
  hero_title: 'Le monde à portée\nde votre boutique.',
  hero_description: 'Choisissez vos produits. Jalims organise le transport et le dédouanement jusqu’à votre point de retrait au Sénégal.',
  hero_cta: 'Explorer les produits',
  hero_local_note: 'Pensé pour les commerçants sénégalais',
  benefit_one_title: 'Un seul parcours',
  benefit_one_description: 'On organise l’acheminement',
  benefit_two_title: 'Dédouanement géré',
  benefit_two_description: 'Pas de transitaire à chercher',
  benefit_three_title: 'Retrait au Sénégal',
  benefit_three_description: 'Récupérez votre commande localement',
  footer_about_title: 'À propos de Jalims',
  footer_about_text: 'Nous aidons les commerçants sénégalais à commander en Chine simplement, avec transport et dédouanement organisés jusqu’au Sénégal.',
  footer_contact_title: 'Contact',
  footer_contact_email: '',
  footer_contact_phone: '',
  footer_tiktok_url: '',
  footer_youtube_url: '',
  footer_instagram_url: '',
  footer_facebook_url: '',
}

const homepageTextLimits: Record<Exclude<keyof HomepageDesignContent, 'benefits' | 'processSteps' | 'heroDesktopImagePath' | 'heroMobileImagePath' | 'processImagePath'>, number> = {
  announcementText: 120,
  announcementLinkText: 48,
  announcementHref: 300,
  heroKicker: 80,
  heroTitleLine1: 100,
  heroTitleHighlight: 70,
  heroSubtitle: 260,
  heroButtonText: 48,
  heroButtonHref: 300,
  heroAlt: 180,
  featuredTitle: 100,
  featuredLinkText: 48,
  featuredHref: 300,
  featuredEmptyText: 120,
  processEyebrow: 80,
  processTitle: 100,
  processImageAlt: 180,
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSafeHomepageLink(value: string) {
  if (value.startsWith('/') && !value.startsWith('//') && !/[\\\u0000-\u001f]/.test(value)) return true
  if (/^#[A-Za-z][A-Za-z0-9_-]*$/.test(value)) return true
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function containsHtml(value: string) {
  return /<\/?\s*[a-z][^>]*>/i.test(value)
}

export function validateHomepageContent(value: unknown): HomepageContent | null {
  if (!isPlainObject(value)) return null
  const keys = Object.keys(defaultHomepageContent) as Exclude<keyof HomepageContent, 'id'>[]
  const result = {} as HomepageContent

  for (const key of keys) {
    const text = value[key]
    if (typeof text !== 'string' || text.length > (key === 'footer_about_text' ? 1000 : 300) || containsHtml(text)) {
      return null
    }
    if (key.endsWith('_url') && text && !isSafeHomepageLink(text)) return null
    if (key === 'footer_contact_email' && text && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return null
    result[key] = text
  }

  return result
}

export function validateHomepageDesignContent(value: unknown): HomepageDesignContent | null {
  if (!isPlainObject(value)) return null
  const validatedText: Partial<Record<keyof typeof homepageTextLimits, string>> = {}

  for (const [key, maximum] of Object.entries(homepageTextLimits)) {
    const text = value[key]
    if (typeof text !== 'string' || text.length > maximum || containsHtml(text)) return null
    if (key.endsWith('Href') && !isSafeHomepageLink(text)) return null
    validatedText[key as keyof typeof homepageTextLimits] = text
  }

  const result: HomepageDesignContent = { ...defaultHomepageDesignContent, ...validatedText }
  const benefits = value.benefits
  if (!Array.isArray(benefits) || benefits.length !== 3) return null
  const validatedBenefits: HomepageBenefit[] = []
  for (const benefit of benefits) {
    if (!isPlainObject(benefit)
      || typeof benefit.icon !== 'string'
      || !homepageBenefitIcons.includes(benefit.icon as HomepageBenefitIcon)
      || typeof benefit.firstLine !== 'string'
      || benefit.firstLine.length > 70
      || containsHtml(benefit.firstLine)
      || typeof benefit.secondLine !== 'string'
      || benefit.secondLine.length > 70
      || containsHtml(benefit.secondLine)) return null
    validatedBenefits.push({
      icon: benefit.icon as HomepageBenefitIcon,
      firstLine: benefit.firstLine,
      secondLine: benefit.secondLine,
    })
  }
  result.benefits = validatedBenefits as HomepageDesignContent['benefits']

  const processSteps = value.processSteps
  if (!Array.isArray(processSteps) || processSteps.length !== 4) return null
  const validatedSteps: HomepageStep[] = []
  for (const step of processSteps) {
    if (!isPlainObject(step)
      || typeof step.icon !== 'string'
      || !homepageStepIcons.includes(step.icon as HomepageStepIcon)
      || typeof step.title !== 'string'
      || step.title.length > 50
      || containsHtml(step.title)) return null
    validatedSteps.push({ icon: step.icon as HomepageStepIcon, title: step.title })
  }
  result.processSteps = validatedSteps as HomepageDesignContent['processSteps']

  for (const key of ['heroDesktopImagePath', 'heroMobileImagePath', 'processImagePath'] as const) {
    const slot = key === 'heroDesktopImagePath' ? 'hero-desktop' : key === 'heroMobileImagePath' ? 'hero-mobile' : 'process'
    const path = value[key]
    if (path !== null && (typeof path !== 'string'
      || !new RegExp(`^home/${slot}/[A-Za-z0-9-]+\\.(?:jpg|png|webp)$`).test(path))) {
      return null
    }
    result[key] = path as string | null
  }

  return result
}

export function getHomepageDesignContent(value: unknown): HomepageDesignContent {
  if (!isPlainObject(value)) return defaultHomepageDesignContent
  const normalized = {
    ...defaultHomepageDesignContent,
    ...value,
    benefits: Array.isArray(value.benefits) && value.benefits.length === 3
      ? value.benefits
      : defaultHomepageDesignContent.benefits,
    processSteps: Array.isArray(value.processSteps) && value.processSteps.length === 4
      ? value.processSteps
      : defaultHomepageDesignContent.processSteps,
  }
  return validateHomepageDesignContent(normalized) ?? defaultHomepageDesignContent
}

export function homepageAssetUrl(path: string | null) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!path || !supabaseUrl) return null
  const encodedPath = path.split('/').map((part) => encodeURIComponent(part)).join('/')
  return `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/site-assets/${encodedPath}`
}
