'use client'

import Link from 'next/link'
import { ChangeEvent, DragEvent, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { hasJalimsAdminAccess } from '../../../lib/admin-access'
import { logClientError } from '../../../lib/user-facing-errors'

const MAX_IMAGE_SIZE = 6 * 1024 * 1024
const imageTypes = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
} as const

type ImportRow = {
  sku: string
  supplierUrl: string
  sourceName: string
  purchasePriceCny: number
  chinaShippingCny: number
  weightKg: number
  colors: string[]
  sizes: string[]
  marginPercent: number
  moq: number
  deliveryEstimate: string
  category: string
}

type ParsedRow = {
  number: number
  sku: string
  row: ImportRow | null
  errors: string[]
}

type PhotoGroup = {
  files: File[]
  errors: string[]
}

type ReportRow = {
  line: number | ''
  sku: string
  action: 'Créé' | 'Mis à jour' | 'Photos' | 'Échec'
  published: boolean
  price: string
  reason: string
}

type ImportResponse = {
  productId?: string
  created?: boolean
  salePriceFcfa?: number
  published?: boolean
  photoCount?: number
  error?: string
}

type AccessState = 'checking' | 'signed-out' | 'not-admin' | 'ready' | 'error'

const requiredHeaders = [
  'sku',
  'lien_fournisseur',
  'nom_source',
  'prix_achat_cny',
  'poids_kg',
  'couleurs',
  'tailles',
  'marge_pourcent',
  'moq',
  'delivery_estimate',
  'category',
]

function normalizeHeader(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('fr-FR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_')
}

function parseCsv(text: string): unknown[][] {
  const source = text.replace(/^\uFEFF/, '')
  const firstLine = source.split(/\r?\n/, 1)[0] ?? ''
  let commas = 0
  let semicolons = 0
  let quoted = false
  for (let index = 0; index < firstLine.length; index += 1) {
    if (firstLine[index] === '"') {
      if (quoted && firstLine[index + 1] === '"') index += 1
      else quoted = !quoted
    } else if (!quoted && firstLine[index] === ',') commas += 1
    else if (!quoted && firstLine[index] === ';') semicolons += 1
  }
  const delimiter = semicolons > commas ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  quoted = false

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        cell += character
      }
    } else if (character === '"') {
      quoted = true
    } else if (character === delimiter) {
      row.push(cell)
      cell = ''
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1
      row.push(cell)
      if (row.some((value) => value.trim() !== '')) rows.push(row)
      row = []
      cell = ''
    } else {
      cell += character
    }
  }

  row.push(cell)
  if (row.some((value) => value.trim() !== '')) rows.push(row)
  if (quoted) throw new Error('Le fichier CSV contient un guillemet qui n’est pas refermé.')
  return rows
}

function cellText(value: unknown) {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  return String(value).trim()
}

function parseNumber(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN
  const normalized = cellText(value).replace(/[\s\u00a0\u202f]/g, '').replace(',', '.')
  if (!normalized) return Number.NaN
  return Number(normalized)
}

function parseSpreadsheetRows(rows: unknown[][]): ParsedRow[] {
  if (rows.length < 2) throw new Error('Le fichier ne contient aucune ligne de produit.')
  const headers = rows[0].map(normalizeHeader)
  const indexes = new Map(headers.map((header, index) => [header, index]))
  const missingHeaders = requiredHeaders.filter((header) => !indexes.has(header))
  if (missingHeaders.length) {
    throw new Error(`Colonnes manquantes : ${missingHeaders.join(', ')}.`)
  }

  const seenSkus = new Set<string>()
  return rows.slice(1).flatMap((values, index) => {
    if (!values.some((value) => cellText(value) !== '')) return []
    const get = (key: string) => {
      const column = indexes.get(key)
      return column === undefined ? undefined : values[column]
    }
    const sku = cellText(get('sku')).toUpperCase()
    const sourceName = cellText(get('nom_source'))
    const supplierUrl = cellText(get('lien_fournisseur'))
    const purchasePriceCny = parseNumber(get('prix_achat_cny'))
    const shippingCell = cellText(get('frais_livraison_chine_cny'))
    const chinaShippingCny = shippingCell ? parseNumber(shippingCell) : 0
    const weightKg = parseNumber(get('poids_kg'))
    const marginPercent = parseNumber(get('marge_pourcent'))
    const moq = parseNumber(get('moq'))
    const deliveryEstimate = cellText(get('delivery_estimate'))
    const category = cellText(get('category'))
    const colors = cellText(get('couleurs')).split('|').map((value) => value.trim()).filter(Boolean)
    const sizes = cellText(get('tailles')).split('|').map((value) => value.trim()).filter(Boolean)
    const errors: string[] = []

    if (!/^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(sku) || sku.includes('..')) {
      errors.push('Le SKU est obligatoire et ne doit contenir que des lettres, des chiffres, des points, tirets ou tirets bas.')
    }
    if (!supplierUrl) {
      errors.push('Le lien fournisseur est obligatoire.')
    } else {
      try {
        const url = new URL(supplierUrl)
        if (!['http:', 'https:'].includes(url.protocol)) errors.push('Le lien fournisseur doit commencer par http:// ou https://.')
      } catch {
        errors.push('Le lien fournisseur n’est pas une adresse valide.')
      }
    }
    if (!sourceName) errors.push('Le nom source est obligatoire.')
    if (!Number.isFinite(purchasePriceCny) || purchasePriceCny <= 0) errors.push('Le prix d’achat CNY doit être supérieur à zéro.')
    if (!Number.isFinite(chinaShippingCny) || chinaShippingCny < 0) errors.push('Les frais de livraison Chine doivent être positifs ou nuls.')
    if (!Number.isFinite(weightKg) || weightKg <= 0) errors.push('Le poids en kg doit être supérieur à zéro.')
    if (!Number.isFinite(marginPercent) || marginPercent < 0) errors.push('La marge doit être positive ou nulle.')
    if (!Number.isInteger(moq) || moq < 1) errors.push('Le MOQ doit être un nombre entier supérieur ou égal à 1.')
    if (!deliveryEstimate) errors.push('Le délai de livraison estimé est obligatoire.')
    if (!category) errors.push('La catégorie est obligatoire.')
    if (Math.max(colors.length, 1) * Math.max(sizes.length, 1) > 250) errors.push('Cette ligne crée plus de 250 variantes. Réduisez le nombre de couleurs ou de tailles.')
    if (sku && /^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(sku) && !sku.includes('..')) {
      if (seenSkus.has(sku)) errors.push('Ce SKU apparaît plusieurs fois dans le fichier. Chaque SKU doit avoir une seule ligne.')
      else if (errors.length === 0) seenSkus.add(sku)
    }

    return [{
      number: index + 2,
      sku,
      errors,
      row: errors.length ? null : {
        sku,
        supplierUrl,
        sourceName,
        purchasePriceCny,
        chinaShippingCny,
        weightKg,
        colors,
        sizes,
        marginPercent,
        moq,
        deliveryEstimate,
        category,
      },
    }]
  })
}

function getFileExtension(filename: string) {
  return filename.split('.').pop()?.toLowerCase() ?? ''
}

function imageMimeType(filename: string) {
  const extension = getFileExtension(filename)
  return Object.prototype.hasOwnProperty.call(imageTypes, extension)
    ? imageTypes[extension as keyof typeof imageTypes]
    : null
}

function csvCell(value: string | number) {
  let text = String(value)
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

export default function ProductImportPage() {
  const [access, setAccess] = useState<AccessState>('checking')
  const [adminEmail, setAdminEmail] = useState('')
  const [spreadsheetName, setSpreadsheetName] = useState('')
  const [spreadsheetReady, setSpreadsheetReady] = useState(false)
  const [photoArchiveName, setPhotoArchiveName] = useState('')
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [photoGroups, setPhotoGroups] = useState<Record<string, PhotoGroup>>({})
  const [photoErrors, setPhotoErrors] = useState<string[]>([])
  const [anthropicConfigured, setAnthropicConfigured] = useState<boolean | null>(null)
  const [testMode, setTestMode] = useState(false)
  const [overwriteText, setOverwriteText] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ current: number; total: number; message: string } | null>(null)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [report, setReport] = useState<ReportRow[]>([])

  useEffect(() => {
    let mounted = true

    async function checkAccess() {
      const { data, error } = await supabase.auth.getUser()
      if (!mounted) return
      if (error || !data.user) {
        if (error?.name !== 'AuthSessionMissingError' && error) logClientError('Product import authentication failed', error)
        setAccess(error?.name === 'AuthSessionMissingError' || !data.user ? 'signed-out' : 'error')
        return
      }
      if (!hasJalimsAdminAccess(data.user)) {
        setAccess('not-admin')
        return
      }

      setAdminEmail(data.user.email ?? '')
      setAccess('ready')
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !sessionData.session) {
        if (sessionError) logClientError('Product import session load failed', sessionError)
        if (mounted) setFeedback({ kind: 'error', text: 'La session administrateur a expiré. Reconnectez-vous puis réessayez.' })
        return
      }

      try {
        const response = await fetch('/api/admin/product-import', {
          headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
        })
        const result = await response.json() as { anthropicConfigured?: boolean; error?: string }
        if (!response.ok) throw new Error(result.error ?? 'Impossible de vérifier la configuration IA.')
        if (mounted) setAnthropicConfigured(result.anthropicConfigured === true)
      } catch (error) {
        logClientError('Product import configuration check failed', error)
        if (mounted) setFeedback({ kind: 'error', text: error instanceof Error ? error.message : 'Impossible de vérifier la configuration du service.' })
      }
    }

    void checkAccess()
    return () => { mounted = false }
  }, [])

  const validRows = useMemo(
    () => rows.filter((entry) => entry.row && (!testMode || entry.sku.startsWith('TEST'))),
    [rows, testMode],
  )
  const invalidRows = useMemo(
    () => rows.filter((entry) => !entry.row || (testMode && !entry.sku.startsWith('TEST'))),
    [rows, testMode],
  )
  const reportCounts = useMemo(() => ({
    created: report.filter((entry) => entry.action === 'Créé').length,
    updated: report.filter((entry) => entry.action === 'Mis à jour').length,
    published: report.filter((entry) => entry.published).length,
    incomplete: report.filter((entry) => entry.action !== 'Échec' && !entry.published).length,
    failed: report.filter((entry) => entry.action === 'Échec').length,
  }), [report])

  async function readSpreadsheet(file: File) {
    setFeedback(null)
    setReport([])
    setSpreadsheetName(file.name)
    setSpreadsheetReady(false)
    setRows([])
    try {
      let data: unknown[][]
      if (/\.csv$/i.test(file.name)) {
        data = parseCsv(await file.text())
      } else if (/\.xlsx$/i.test(file.name)) {
        const { readSheet } = await import('read-excel-file/browser')
        data = await readSheet(file)
      } else {
        throw new Error('Choisissez un fichier Excel .xlsx ou un fichier .csv.')
      }
      const parsedRows = parseSpreadsheetRows(data)
      setRows(parsedRows)
      setSpreadsheetReady(true)
      if (parsedRows.length === 0) setFeedback({ kind: 'error', text: 'Le fichier ne contient aucune ligne de produit.' })
    } catch (error) {
      logClientError('Product import spreadsheet read failed', error)
      setRows([])
      setFeedback({ kind: 'error', text: error instanceof Error ? error.message : 'Le fichier Excel/CSV n’a pas pu être lu.' })
    }
  }

  async function readPhotoArchive(file: File) {
    setFeedback(null)
    setReport([])
    setPhotoArchiveName(file.name)
    setPhotoErrors([])
    try {
      const { unzipSync } = await import('fflate')
      const archive = unzipSync(new Uint8Array(await file.arrayBuffer()))
      const groups: Record<string, PhotoGroup> = {}
      const errors: string[] = []
      for (const [path, contents] of Object.entries(archive)) {
        if (path.endsWith('/') || path.startsWith('__MACOSX/')) continue
        const parts = path.replace(/\\/g, '/').split('/')
        if (parts.length !== 2 || !parts[0] || !parts[1] || parts[1] === '.DS_Store') {
          errors.push(`Chemin ignoré : « ${path} ». Chaque photo doit être directement dans un sous-dossier portant son SKU.`)
          continue
        }
        const sku = parts[0].trim().toUpperCase()
        if (!/^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(sku) || sku.includes('..')) {
          errors.push(`Le dossier « ${parts[0]} » ne contient pas un SKU valide.`)
          continue
        }
        const mimeType = imageMimeType(parts[1])
        const group = groups[sku] ?? (groups[sku] = { files: [], errors: [] })
        if (!mimeType) {
          group.errors.push(`« ${parts[1]} » n’est pas accepté : utilisez uniquement JPG, PNG ou WebP.`)
          continue
        }
        const buffer = contents.buffer.slice(contents.byteOffset, contents.byteOffset + contents.byteLength) as ArrayBuffer
        group.files.push(new File([buffer], parts[1], { type: mimeType }))
      }
      setPhotoGroups(groups)
      setPhotoErrors(errors)
      const photoCount = Object.values(groups).reduce((count, group) => count + group.files.length, 0)
      if (photoCount === 0) setFeedback({ kind: 'error', text: 'Aucune photo JPG, PNG ou WebP exploitable n’a été trouvée dans le ZIP.' })
    } catch (error) {
      logClientError('Product import photo archive read failed', error)
      setPhotoGroups({})
      setFeedback({ kind: 'error', text: 'Le ZIP n’a pas pu être lu. Vérifiez que l’archive est valide.' })
    }
  }

  function handleSpreadsheetChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    if (file) void readSpreadsheet(file)
    event.currentTarget.value = ''
  }

  function handleArchiveChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    if (file) void readPhotoArchive(file)
    event.currentTarget.value = ''
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>, kind: 'spreadsheet' | 'archive') {
    event.preventDefault()
    const file = event.dataTransfer.files[0]
    if (!file) return
    if (kind === 'spreadsheet') void readSpreadsheet(file)
    else void readPhotoArchive(file)
  }

  async function apiPost(payload: Record<string, unknown>) {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !sessionData.session) throw new Error('Votre session administrateur a expiré. Reconnectez-vous puis réessayez.')

    const response = await fetch('/api/admin/product-import', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionData.session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    let result: ImportResponse
    try {
      result = await response.json() as ImportResponse
    } catch (error) {
      logClientError('Product import response parsing failed', error)
      throw new Error('Le serveur a retourné une réponse illisible.')
    }
    if (!response.ok) throw new Error(result.error ?? 'Le serveur a refusé cette opération.')
    return result
  }

  async function preparePhoto(file: File) {
    const originalType = imageMimeType(file.name)
    if (!originalType || (file.type && file.type !== originalType)) {
      throw new Error(`« ${file.name} » n’est pas au format JPG, PNG ou WebP.`)
    }
    let bitmap: ImageBitmap
    try {
      bitmap = await createImageBitmap(file)
    } catch (error) {
      logClientError('Product import photo decoding failed', error)
      throw new Error(`« ${file.name} » n’est pas une image valide au format JPG, PNG ou WebP.`)
    }
    if (file.size <= MAX_IMAGE_SIZE) {
      bitmap.close()
      return { file, filename: file.name }
    }

    const outputType = originalType === 'image/jpeg' ? 'image/jpeg' : 'image/webp'
    let filename = file.name
    if (originalType === 'image/png') filename = `${file.name.replace(/\.png$/i, '')}.webp`
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) {
      bitmap.close()
      throw new Error(`La photo « ${file.name} » ne peut pas être compressée sur cet appareil.`)
    }

    try {
      let scale = 1
      let quality = 0.88
      for (let attempt = 0; attempt < 8; attempt += 1) {
        canvas.width = Math.max(1, Math.round(bitmap.width * scale))
        canvas.height = Math.max(1, Math.round(bitmap.height * scale))
        context.clearRect(0, 0, canvas.width, canvas.height)
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outputType, quality))
        if (!blob) throw new Error(`La compression de « ${file.name} » a échoué.`)
        if (blob.size <= MAX_IMAGE_SIZE) {
          return { file: new File([blob], filename, { type: outputType }), filename }
        }
        scale *= 0.8
        quality = Math.max(0.5, quality - 0.06)
      }
    } finally {
      bitmap.close()
      canvas.width = 0
      canvas.height = 0
    }
    throw new Error(`« ${file.name} » reste trop volumineuse après compression (limite : 6 Mo).`)
  }

  async function runImport() {
    if (!spreadsheetName && !photoArchiveName) {
      setFeedback({ kind: 'error', text: 'Choisissez un fichier Excel/CSV, un ZIP de photos, ou les deux.' })
      return
    }
    if (spreadsheetName && !spreadsheetReady) {
      setFeedback({ kind: 'error', text: 'Le fichier Excel/CSV doit être lu sans erreur avant l’envoi des produits ou des photos.' })
      return
    }
    setBusy(true)
    setFeedback(null)
    const nextReport: ReportRow[] = [
      ...invalidRows.map((entry) => ({
        line: entry.number,
        sku: entry.sku,
        action: 'Échec' as const,
        published: false,
        price: '',
        reason: testMode && entry.row && !entry.sku.startsWith('TEST')
          ? 'Mode test : seuls les SKU commençant par « TEST » sont autorisés. Cette ligne n’a pas été envoyée.'
          : testMode && entry.sku && !entry.sku.startsWith('TEST')
            ? `Mode test : seuls les SKU commençant par « TEST » sont autorisés. ${entry.errors.join(' ')}`
            : entry.errors.join(' '),
      })),
      ...photoErrors.map((reason) => ({
        line: '' as const,
        sku: '',
        action: 'Échec' as const,
        published: false,
        price: '',
        reason,
      })),
    ]
    const importedSkus = new Set<string>()
    const importedRows = new Map<string, number>()
    const photoCount = Object.values(photoGroups).reduce((count, group) => count + group.files.length, 0)
    let total = validRows.length + photoCount
    let current = 0

    for (const entry of validRows) {
      current += 1
      setProgress({ current, total, message: `Import du SKU ${entry.sku} (ligne ${entry.number})…` })
      try {
        const result = await apiPost({
          action: 'import',
          row: entry.row,
          overwriteText,
          testMode,
        })
        importedSkus.add(entry.sku)
        const reportIndex = nextReport.length
        importedRows.set(entry.sku, reportIndex)
        nextReport.push({
          line: entry.number,
          sku: entry.sku,
          action: result.created ? 'Créé' : 'Mis à jour',
          published: result.published === true,
          price: result.salePriceFcfa ? `${result.salePriceFcfa} FCFA` : '',
          reason: result.published ? '' : 'À compléter : il faut au moins trois photos valides pour publier ce produit.',
        })
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Une erreur inconnue a interrompu cette ligne.'
        nextReport.push({ line: entry.number, sku: entry.sku, action: 'Échec', published: false, price: '', reason })
      }
      setReport([...nextReport])
    }

    const registrationTasks = Object.entries(photoGroups).filter(([sku, group]) => (
      group.files.length > 0
      && (!testMode || sku.startsWith('TEST'))
      && (rows.length === 0 || importedSkus.has(sku))
    )).length
    total += registrationTasks

    for (const [sku, group] of Object.entries(photoGroups)) {
      if (testMode && !sku.startsWith('TEST')) {
        nextReport.push({
          line: '',
          sku,
          action: 'Échec',
          published: false,
          price: '',
          reason: 'Mode test : seuls les SKU commençant par « TEST » sont autorisés. Ces photos n’ont pas été envoyées.',
        })
        setReport([...nextReport])
        continue
      }
      if (rows.length > 0 && !importedSkus.has(sku)) {
        const reason = group.errors.length
          ? `${group.errors.join(' ')} Photos ignorées : la ligne Excel n’a pas été importée.`
          : 'Photos ignorées : aucune ligne valide de ce SKU n’a été importée pendant cette opération.'
        nextReport.push({ line: '', sku, action: 'Échec', published: false, price: '', reason })
        setReport([...nextReport])
        continue
      }

      if (!group.files.length) {
        nextReport.push({
          line: '',
          sku,
          action: 'Échec',
          published: false,
          price: '',
          reason: group.errors.join(' ') || 'Aucune photo valide dans ce dossier.',
        })
        setReport([...nextReport])
        continue
      }

      const uploadedNames: string[] = []
      const uploadErrors = [...group.errors]
      for (const sourceFile of group.files) {
        current += 1
        setProgress({ current, total, message: `Envoi des photos de ${sku} : ${sourceFile.name}…` })
        try {
          const prepared = await preparePhoto(sourceFile)
          const path = `${sku}/${prepared.filename}`
          const { error } = await supabase.storage.from('products').upload(path, prepared.file, {
            upsert: true,
            contentType: prepared.file.type,
          })
          if (error) {
            logClientError('Product import photo upload failed', error)
            uploadErrors.push(`La photo « ${sourceFile.name} » n’a pas pu être envoyée. Vérifiez l’accès au stockage puis réessayez.`)
          } else {
            uploadedNames.push(prepared.filename)
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : `La photo « ${sourceFile.name} » n’a pas pu être préparée.`
          uploadErrors.push(message)
        }
      }

      if (uploadedNames.length === 0) {
        const previousIndex = importedRows.get(sku)
        const reason = uploadErrors.join(' ') || 'Aucune photo n’a pu être envoyée.'
        if (previousIndex !== undefined) {
          nextReport[previousIndex] = { ...nextReport[previousIndex], reason: `${nextReport[previousIndex].reason} ${reason}`.trim() }
        } else {
          nextReport.push({ line: '', sku, action: 'Échec', published: false, price: '', reason })
        }
        setReport([...nextReport])
        current += 1
        setProgress({ current, total, message: `Photos de ${sku} traitées.` })
        continue
      }

      current += 1
      setProgress({ current, total, message: `Enregistrement des photos de ${sku}…` })
      try {
        const result = await apiPost({
          action: 'register-images',
          sku,
          filenames: [...new Set(uploadedNames)],
          testMode,
        })
        const photoReason = result.published
          ? uploadErrors.join(' ')
          : `À compléter : ${result.photoCount ?? 0} photo(s) enregistrée(s), au moins trois sont nécessaires pour publier.${uploadErrors.length ? ` ${uploadErrors.join(' ')}` : ''}`
        const previousIndex = importedRows.get(sku)
        if (previousIndex !== undefined) {
          nextReport[previousIndex] = {
            ...nextReport[previousIndex],
            published: result.published === true,
            reason: photoReason,
          }
        } else {
          nextReport.push({
            line: '',
            sku,
            action: 'Photos',
            published: result.published === true,
            price: '',
            reason: photoReason,
          })
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Les photos ont été envoyées mais leur enregistrement a échoué.'
        const previousIndex = importedRows.get(sku)
        if (previousIndex !== undefined) {
          nextReport[previousIndex] = {
            ...nextReport[previousIndex],
            reason: `Les fichiers ont été envoyés, mais leur enregistrement dans le catalogue a échoué : ${reason}`,
          }
        } else {
          nextReport.push({ line: '', sku, action: 'Échec', published: false, price: '', reason })
        }
      }
      setReport([...nextReport])
    }

    setProgress(null)
    setBusy(false)
    setReport(nextReport)
    setFeedback(nextReport.some((entry) => entry.action === 'Échec')
      ? { kind: 'error', text: 'L’opération est terminée. Certaines lignes ou photos nécessitent une correction; consultez le rapport.' }
      : { kind: 'success', text: 'L’opération est terminée. Consultez le rapport avant de télécharger le fichier.' })
  }

  function downloadReport() {
    const header = ['ligne', 'sku', 'résultat', 'publié', 'prix_fcfa', 'raison']
    const csv = [
      header.map(csvCell).join(';'),
      ...report.map((entry) => [
        entry.line,
        entry.sku,
        entry.action,
        entry.published ? 'Oui' : 'Non',
        entry.price,
        entry.reason,
      ].map(csvCell).join(';')),
    ].join('\r\n')
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'rapport-import-produits.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  if (access === 'checking') return <main className="product-import-page"><p>Vérification de l’accès administrateur…</p></main>
  if (access !== 'ready') {
    const message = access === 'signed-out'
      ? 'Connectez-vous avec le compte administrateur pour accéder à l’import.'
      : access === 'not-admin'
        ? 'Ce compte ne dispose pas des droits administrateur.'
        : 'Impossible de vérifier votre accès administrateur.'
    return (
      <main className="product-import-page">
        <section className="product-import-card">
          <h1>Importer des produits</h1>
          <p role="alert">{message}</p>
          <Link href="/login?next=%2Fadmin%2Fimporter">Se connecter</Link>
        </section>
      </main>
    )
  }

  const photosTotal = Object.values(photoGroups).reduce((count, group) => count + group.files.length, 0)

  return (
    <main className="product-import-page">
      <div className="product-import-shell">
        <header className="product-import-header">
          <div>
            <p className="product-import-eyebrow">JALIMS / ESPACE ADMIN</p>
            <h1>Importer des produits</h1>
            <p>Importez votre fichier produit et vos photos ensemble ou en deux temps.</p>
          </div>
          <div className="product-import-session">
            <span>{adminEmail}</span>
            <Link href="/admin">Retour aux produits</Link>
          </div>
        </header>

        {feedback && <p className={`product-import-feedback ${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.text}</p>}
        {anthropicConfigured === false && (
          <p className="product-import-notice" role="status">
            La rédaction automatique n’est pas configurée : ANTHROPIC_API_KEY est absente. Aucun appel à l’IA ne sera effectué. Activez le mode test pour continuer.
          </p>
        )}
        {anthropicConfigured === null && <p className="product-import-hint">Vérification de la configuration de rédaction automatique…</p>}

        <div className="product-import-drop-grid">
          <label
            className="product-import-dropzone"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => handleDrop(event, 'spreadsheet')}
          >
            <span className="product-import-step">1</span>
            <strong>Fichier Excel ou CSV</strong>
            <span>Colonnes attendues : sku, lien_fournisseur, nom_source, prix_achat_cny, frais_livraison_chine_cny, poids_kg, couleurs, tailles, marge_pourcent, moq, delivery_estimate, category.</span>
            <span className="product-import-file-name">{spreadsheetName || 'Déposez le fichier ici ou cliquez pour le choisir'}</span>
            <input accept=".xlsx,.csv" disabled={busy} onChange={handleSpreadsheetChange} type="file" />
          </label>
          <label
            className="product-import-dropzone"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => handleDrop(event, 'archive')}
          >
            <span className="product-import-step">2</span>
            <strong>ZIP de photos</strong>
            <span>Un sous-dossier par SKU, par exemple JAL001/1.jpg. Formats JPG, PNG ou WebP uniquement.</span>
            <span className="product-import-file-name">{photoArchiveName || 'Déposez le ZIP ici ou cliquez pour le choisir'}</span>
            <input accept=".zip,application/zip" disabled={busy} onChange={handleArchiveChange} type="file" />
          </label>
        </div>

        <section className="product-import-options">
          <label className="product-import-checkbox">
            <input checked={testMode} disabled={busy} onChange={(event) => setTestMode(event.target.checked)} type="checkbox" />
            <span><strong>Mode test</strong><small>Utilise « [À rédiger] » + nom_source. Il n’appelle jamais l’IA et n’accepte que les SKU commençant par TEST.</small></span>
          </label>
          <p className="product-import-warning"><strong>Attention :</strong> le mode test écrit dans la vraie base de données. Utilisez uniquement des SKU de test commençant par TEST.</p>
          <label className="product-import-checkbox">
            <input checked={overwriteText} disabled={busy} onChange={(event) => setOverwriteText(event.target.checked)} type="checkbox" />
            <span><strong>Écraser les textes</strong><small>Pour un SKU existant, remplace le titre et la description uniquement si cette case est cochée.</small></span>
          </label>
        </section>

        {rows.length > 0 && (
          <section className="product-import-preview">
            <div className="product-import-section-heading">
              <div><h2>Aperçu Excel</h2><p>{validRows.length} ligne(s) valide(s), {invalidRows.length} ligne(s) à corriger.</p></div>
              <span>{rows.length} ligne(s)</span>
            </div>
            <div className="product-import-table-scroll">
              <table className="product-import-table">
                <thead><tr><th>Ligne</th><th>SKU normalisé</th><th>Nom source</th><th>Prix CNY</th><th>Poids kg</th><th>État</th></tr></thead>
                <tbody>
                  {rows.map((entry) => {
                    const rowErrors = [
                      ...entry.errors,
                      ...(testMode && entry.sku && !entry.sku.startsWith('TEST')
                        ? ['Mode test : le SKU doit commencer par TEST. Cette ligne ne sera pas envoyée.']
                        : []),
                    ]
                    return (
                      <tr className={rowErrors.length ? 'invalid' : ''} key={entry.number}>
                        <td>{entry.number}</td><td>{entry.sku || '—'}</td><td>{entry.row?.sourceName ?? '—'}</td>
                        <td>{entry.row?.purchasePriceCny ?? '—'}</td><td>{entry.row?.weightKg ?? '—'}</td>
                        <td>{rowErrors.length ? rowErrors.join(' ') : 'Prête à importer'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {(photoArchiveName || photoErrors.length > 0) && (
          <section className="product-import-preview">
            <div className="product-import-section-heading">
              <div><h2>Aperçu des photos</h2><p>{photosTotal} photo(s) JPG, PNG ou WebP détectée(s).</p></div>
              <span>{Object.keys(photoGroups).length} SKU</span>
            </div>
            {photoErrors.map((message, index) => <p className="product-import-row-error" key={`archive-error-${index}`}>{message}</p>)}
            {Object.entries(photoGroups).map(([sku, group]) => (
              <p className="product-import-photo-group" key={sku}>
                <strong>{sku}</strong> · {group.files.length} photo(s){group.errors.length > 0 && ` · ${group.errors.join(' ')}`}
              </p>
            ))}
          </section>
        )}

        <div className="product-import-actions">
          <button
            className="product-import-submit"
            disabled={busy || (rows.length === 0 && photosTotal === 0 && photoErrors.length === 0)}
            onClick={() => void runImport()}
            type="button"
          >
            {busy ? 'Import en cours…' : rows.length > 0 && photosTotal > 0 ? 'Importer les produits et les photos' : photosTotal > 0 && rows.length === 0 ? 'Envoyer les photos' : 'Importer les lignes valides'}
          </button>
          {progress && (
            <div className="product-import-progress" role="status">
              <progress max={Math.max(progress.total, progress.current, 1)} value={progress.current} />
              <span>{progress.current} / {progress.total} · {progress.message}</span>
            </div>
          )}
        </div>

        {report.length > 0 && (
          <section className="product-import-report">
            <div className="product-import-section-heading">
              <div><h2>Rapport d’import</h2><p>Les produits qui n’ont pas trois photos restent non publiés.</p></div>
              <button className="product-import-download" onClick={downloadReport} type="button">Télécharger le rapport CSV</button>
            </div>
            <div className="product-import-report-counts">
              <span>Créés <strong>{reportCounts.created}</strong></span>
              <span>Mis à jour <strong>{reportCounts.updated}</strong></span>
              <span>Publiés <strong>{reportCounts.published}</strong></span>
              <span>À compléter <strong>{reportCounts.incomplete}</strong></span>
              <span>En échec <strong>{reportCounts.failed}</strong></span>
            </div>
            <div className="product-import-table-scroll">
              <table className="product-import-table">
                <thead><tr><th>Ligne</th><th>SKU</th><th>Résultat</th><th>Publié</th><th>Prix calculé</th><th>Raison</th></tr></thead>
                <tbody>
                  {report.map((entry, index) => (
                    <tr className={entry.action === 'Échec' ? 'invalid' : ''} key={`${entry.sku}-${entry.line}-${index}`}>
                      <td>{entry.line || '—'}</td><td>{entry.sku || '—'}</td><td>{entry.action}</td>
                      <td>{entry.published ? 'Oui' : 'Non'}</td><td>{entry.price || '—'}</td><td>{entry.reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
