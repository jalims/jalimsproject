export const ORDER_MESSAGE_TEMPLATE_KEYS = [
  'commande_confirmee',
  'en_transit',
  'prete_a_retirer',
  'retard',
  'remboursement',
] as const

export type OrderMessageTemplateKey = (typeof ORDER_MESSAGE_TEMPLATE_KEYS)[number]

export const ORDER_MESSAGE_VARIABLES: Readonly<Record<OrderMessageTemplateKey, readonly string[]>> = {
  commande_confirmee: [
    'prenom',
    'montant',
    'numero_commande',
    'liste_produits',
    'delai_estime',
    'lien_commande',
    'whatsapp_jalims',
  ],
  en_transit: ['prenom', 'numero_commande', 'date_estimee'],
  prete_a_retirer: [
    'prenom',
    'numero_commande',
    'point_retrait',
    'horaires',
    'code_retrait',
    'delai_signalement',
  ],
  retard: ['prenom', 'numero_commande', 'motif', 'date_estimee', 'whatsapp_jalims'],
  remboursement: [
    'prenom',
    'motif',
    'montant_rembourse',
    'moyen_remboursement',
    'delai_remboursement',
  ],
}

export const ORDER_MESSAGE_SAMPLE_VARIABLES: Readonly<Record<string, string>> = {
  prenom: 'Aminata',
  montant: '25 000',
  numero_commande: 'JAL-TEST-0001',
  liste_produits: 'Sac en toile\n- Couleur : Bleu — 2 unités',
  delai_estime: '5 à 12 jours',
  lien_commande: 'https://jalims.com/orders',
  whatsapp_jalims: '+221 77 000 00 00',
  date_estimee: '15 novembre 2026',
  point_retrait: 'Dakar, Plateau',
  horaires: 'Du lundi au samedi, de 9 h à 18 h',
  code_retrait: 'JAL-TEST-0001',
  delai_signalement: '48 heures',
  motif: 'un incident pendant le transport',
  montant_rembourse: '25 000',
  moyen_remboursement: 'Wave',
  delai_remboursement: '5 à 7 jours ouvrés',
}

export type OrderMessageTemplate = {
  template_key: OrderMessageTemplateKey
  subject: string
  body: string
}

export type OrderMessageVariables = Readonly<Record<string, string>>

export type OrderMessageVariantLine = {
  attribute_values: Readonly<Record<string, string>>
  quantity: number
}

export type RenderedOrderMessage = {
  subject: string
  text: string
  html: string
}

const placeholderPattern = /\{([^{}]+)\}/g
const attributeLabels: Readonly<Record<string, string>> = {
  color: 'Couleur',
  size: 'Taille',
  capacity: 'Capacité / volume',
  dimensions: 'Dimensions',
  model: 'Modèle',
  weight: 'Poids',
}

export function isOrderMessageTemplateKey(value: unknown): value is OrderMessageTemplateKey {
  return typeof value === 'string'
    && ORDER_MESSAGE_TEMPLATE_KEYS.some((templateKey) => templateKey === value)
}

function getPlaceholders(templatePart: string, templateKey: OrderMessageTemplateKey) {
  const placeholders = [...templatePart.matchAll(placeholderPattern)]
  const remainder = templatePart.replace(placeholderPattern, '')
  if (remainder.includes('{') || remainder.includes('}')) {
    throw new Error('Une variable du modèle est mal formée. Utilisez la syntaxe {variable}.')
  }

  const allowed = new Set(ORDER_MESSAGE_VARIABLES[templateKey])
  const unknown = [...new Set(placeholders.map((placeholder) => placeholder[1]))]
    .filter((placeholder) => !allowed.has(placeholder))
  if (unknown.length > 0) {
    throw new Error(`Variable(s) inconnue(s) pour le modèle « ${templateKey} » : ${unknown.map((name) => `{${name}}`).join(', ')}.`)
  }

  return placeholders.map((placeholder) => placeholder[1])
}

function renderPart(
  templatePart: string,
  templateKey: OrderMessageTemplateKey,
  variables: OrderMessageVariables,
) {
  const placeholders = getPlaceholders(templatePart, templateKey)
  for (const name of placeholders) {
    if (!Object.prototype.hasOwnProperty.call(variables, name)) {
      throw new Error(`La variable {${name}} n’a pas été fournie pour le modèle « ${templateKey} ».`)
    }
  }

  return templatePart.replace(placeholderPattern, (_placeholder, name: string) => variables[name])
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function omitEmptyWhatsAppClauses(body: string) {
  const sentences = body.match(/[^.!?]*[.!?]+(?:\s+|$)|[^.!?]+$/g) ?? [body]
  return sentences.map((sentence) => {
    if (!sentence.includes('{whatsapp_jalims}') || !/\bWhatsApp\b/i.test(sentence)) return sentence

    const semicolonIndex = sentence.lastIndexOf(';')
    if (semicolonIndex < 0) return ''

    const prefix = sentence.slice(0, semicolonIndex).trimEnd().replace(/[;,:]+$/, '')
    const ending = sentence.match(/[.!?]+(?=\s*$)/)?.[0] ?? '.'
    const trailingWhitespace = sentence.match(/\s*$/)?.[0] ?? ''
    return `${prefix}${ending}${trailingWhitespace}`
  }).join('').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([.!?])/g, '$1')
}

export function renderOrderMessage(
  template: OrderMessageTemplate,
  variables: OrderMessageVariables,
): RenderedOrderMessage {
  const subject = renderPart(template.subject, template.template_key, variables)
  if (/[\r\n]/.test(subject)) {
    throw new Error('L’objet du modèle ne peut pas contenir de retour à la ligne.')
  }
  const body = variables.whatsapp_jalims?.trim()
    ? template.body
    : omitEmptyWhatsAppClauses(template.body)
  const text = renderPart(body, template.template_key, variables)
  const html = `<div>${escapeHtml(text).replace(/\r\n|\r|\n/g, '<br>')}</div>`

  return { subject, text, html }
}

export function formatOrderProductList(
  productName: string,
  orderQuantity: number,
  variantLines: readonly OrderMessageVariantLine[],
) {
  if (variantLines.length === 0) {
    return `${productName}\n- ${orderQuantity} unité${orderQuantity === 1 ? '' : 's'}`
  }

  const lines = variantLines.map((line) => {
    const attributes = Object.entries(line.attribute_values)
      .map(([key, value]) => `${attributeLabels[key] ?? key.replaceAll('_', ' ')} : ${value}`)
      .join(' · ')
    const description = attributes ? `${attributes} — ` : ''
    return `- ${description}${line.quantity} unité${line.quantity === 1 ? '' : 's'}`
  })

  return `${productName}\n${lines.join('\n')}`
}

export function normalizeSenegalPhone(phone: string) {
  let compact = phone.trim().replace(/[\s().-]/g, '')

  if (compact.startsWith('00221')) {
    compact = `+${compact.slice(2)}`
  } else if (/^221\d{9}$/.test(compact)) {
    compact = `+${compact}`
  } else if (/^\d{9}$/.test(compact)) {
    compact = `+221${compact}`
  }

  return /^\+221\d{9}$/.test(compact) ? compact : null
}

export function isAllowedOrderMessageSender(sender: string) {
  if (/[\r\n]/.test(sender)) return false

  const value = sender.trim()
  const formattedAddress = value.match(/^[^<>]*<([^<>\s@]+@[^<>\s@]+)>$/)
  const bareAddress = value.match(/^([^<>\s@]+@[^<>\s@]+)$/)
  const address = formattedAddress?.[1] ?? bareAddress?.[1]

  return address?.toLowerCase().endsWith('@jalims.com') ?? false
}

export function isValidOrderMessageReplyTo(replyTo: string) {
  return !/[\r\n]/.test(replyTo)
    && /^[^<>\s@]+@[a-z\d.-]+\.[a-z]{2,}$/i.test(replyTo.trim())
}
