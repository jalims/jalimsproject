'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { hasJalimsAdminAccess } from '../../../lib/admin-access'
import { isOrderMessageTemplateKey, ORDER_MESSAGE_TEMPLATE_KEYS, type OrderMessageTemplateKey } from '../../../lib/order-messages'
import { logClientError } from '../../../lib/user-facing-errors'
import { supabase } from '../../../lib/supabase'

type AdminOrder = {
  id: string
  product_id: string
  pickup_point_id: string | null
  jalims_code: string
  quantity: number
  total_price: number
  variant_id: string | null
  variant_values: Record<string, string>
  variant_stock_committed: boolean
  variant_lines: { id: string; attribute_values: Record<string, string>; quantity: number; unit_price: number; line_total: number }[]
  status: string
  created_at: string
  products: { name: string; image_url: string | null } | null
  pickup_points: { name: string; address: string; city: string } | null
}

type MessageLog = {
  id: string
  order_id: string
  template_key: string
  channel: 'email' | 'whatsapp'
  source: 'automatic' | 'manual'
  status: 'en_cours' | 'envoye' | 'echec' | 'prepare'
  created_at: string
  sent_at: string | null
  error: string | null
}

type MessagePreview = { subject: string; text: string; warnings: string[] }
type PendingStatus = { orderId: string; status: string; sendMessage: boolean; dateEstimate: string }

const statuses = [
  ['pending_payment', 'En attente de paiement'],
  ['payé', 'Payé'],
  ['commandé_fournisseur', 'Commandé au fournisseur'],
  ['chez_transitaire', 'Chez le transitaire'],
  ['en_transit', 'En transit'],
  ['arrivé', 'Arrivé au Sénégal'],
  ['prête_a_retirer', 'Prête à retirer'],
  ['récupéré', 'Récupéré'],
  ['cancelled', 'Annulé'],
]

const templateLabels: Record<OrderMessageTemplateKey, string> = {
  commande_confirmee: 'Commande confirmée',
  en_transit: 'En transit',
  prete_a_retirer: 'Prête à retirer',
  retard: 'Retard',
  remboursement: 'Remboursement',
}

const messageFields: Partial<Record<OrderMessageTemplateKey, { key: string; label: string; optional?: boolean }[]>> = {
  en_transit: [{ key: 'date_estimee', label: 'Date estimée d’arrivée' }],
  retard: [
    { key: 'motif', label: 'Motif du retard' },
    { key: 'date_estimee', label: 'Nouvelle date estimée' },
  ],
  remboursement: [
    { key: 'motif', label: 'Motif' },
    { key: 'montant_rembourse', label: 'Montant remboursé (FCFA)' },
    { key: 'moyen_remboursement', label: 'Moyen de remboursement' },
    { key: 'delai_remboursement', label: 'Délai de remboursement', optional: true },
  ],
}

const attributeLabels: Record<string, string> = {
  color: 'Couleur',
  size: 'Taille',
  capacity: 'Capacité / volume',
  dimensions: 'Dimensions',
  model: 'Modèle',
  weight: 'Poids',
}

const messageStatusLabels: Record<MessageLog['status'], string> = {
  en_cours: 'En cours',
  envoye: 'Envoyé',
  echec: 'Échec',
  prepare: 'Préparé',
}

async function readApiBody(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('La réponse du serveur est invalide.')
  }
  return body as Record<string, unknown>
}

async function apiMessageRequest(payload: Record<string, unknown>) {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token) {
    throw new Error('Votre session a expiré. Reconnectez-vous puis réessayez.')
  }

  const response = await fetch('/api/admin/order-messages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const body = await readApiBody(response)
  if (!response.ok) {
    throw new Error(typeof body.error === 'string' ? body.error : 'La demande de message a échoué.')
  }
  return body
}

function isPaidOrder(order: AdminOrder) {
  return !['pending_payment', 'cancelled'].includes(order.status)
}

export default function AdminOrdersPage() {
  const [checking, setChecking] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [messageLogs, setMessageLogs] = useState<MessageLog[]>([])
  const [errorMessage, setErrorMessage] = useState('')
  const [savingId, setSavingId] = useState('')
  const [pendingStatus, setPendingStatus] = useState<PendingStatus | null>(null)
  const [composerOrderId, setComposerOrderId] = useState('')
  const [templateKey, setTemplateKey] = useState<OrderMessageTemplateKey>('commande_confirmee')
  const [extraVariables, setExtraVariables] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<MessagePreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [messageBusy, setMessageBusy] = useState(false)
  const [messageFeedback, setMessageFeedback] = useState<{ orderId: string; text: string; error: boolean } | null>(null)
  const [whatsAppUrl, setWhatsAppUrl] = useState('')
  const [now, setNow] = useState(0)

  useEffect(() => {
    const initialUpdate = window.setTimeout(() => setNow(Date.now()), 0)
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => {
      window.clearTimeout(initialUpdate)
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    let active = true
    async function load() {
      const { data: userData, error: authError } = await supabase.auth.getUser()
      if (!active) return
      if (authError || !hasJalimsAdminAccess(userData.user)) {
        setChecking(false)
        return
      }

      const { data, error } = await supabase
        .from('orders')
        .select('id, product_id, pickup_point_id, jalims_code, quantity, total_price, variant_id, variant_values, variant_stock_committed, status, created_at')
        .order('created_at', { ascending: false })
      if (!active) return
      if (error) {
        logClientError('Admin order list load failed', error)
        setErrorMessage('Impossible de charger les commandes. Vérifiez votre accès administrateur et réessayez.')
        setAuthorized(true)
        setChecking(false)
        return
      }

      const orderRows = data ?? []
      const orderIds = orderRows.map((order) => order.id)
      const productIds = [...new Set(orderRows.map((order) => order.product_id))]
      const pickupPointIds = [...new Set(orderRows.map((order) => order.pickup_point_id).filter((id): id is string => Boolean(id)))]
      const [{ data: products, error: productsError }, { data: pickupPoints, error: pickupError }, { data: variantLines, error: variantLinesError }, { data: logs, error: logsError }] = await Promise.all([
        productIds.length
          ? supabase.from('products').select('id, name, image_url').in('id', productIds)
          : Promise.resolve({ data: [], error: null }),
        pickupPointIds.length
          ? supabase.from('pickup_points').select('id, name, address, city').in('id', pickupPointIds)
          : Promise.resolve({ data: [], error: null }),
        orderIds.length
          ? supabase.from('order_variant_lines').select('id, order_id, attribute_values, quantity, unit_price, line_total').in('order_id', orderIds)
          : Promise.resolve({ data: [], error: null }),
        orderIds.length
          ? supabase.from('order_messages').select('id, order_id, template_key, channel, source, status, created_at, sent_at, error').in('order_id', orderIds).order('created_at', { ascending: false })
          : Promise.resolve({ data: [], error: null }),
      ])
      if (!active) return

      const detailError = productsError ?? pickupError ?? variantLinesError ?? logsError
      if (detailError) {
        logClientError('Admin order details load failed', detailError)
        setErrorMessage('Les commandes sont chargées, mais certains détails ou messages sont indisponibles.')
      } else {
        const productById = new Map((products ?? []).map((product) => [product.id, product]))
        const pickupPointById = new Map((pickupPoints ?? []).map((point) => [point.id, point]))
        const linesByOrderId = new Map<string, AdminOrder['variant_lines']>()
        for (const line of variantLines ?? []) {
          const lines = linesByOrderId.get(line.order_id) ?? []
          lines.push(line as AdminOrder['variant_lines'][number])
          linesByOrderId.set(line.order_id, lines)
        }
        setOrders(orderRows.map((order) => ({
          ...order,
          variant_lines: linesByOrderId.get(order.id) ?? [],
          products: productById.get(order.product_id) ?? null,
          pickup_points: order.pickup_point_id ? pickupPointById.get(order.pickup_point_id) ?? null : null,
        })) as AdminOrder[])
        setMessageLogs((logs ?? []) as MessageLog[])
      }
      setAuthorized(true)
      setChecking(false)
    }
    void load()
    return () => {
      active = false
    }
  }, [])

  async function refreshMessageLogs(orderId: string) {
    const { data, error } = await supabase
      .from('order_messages')
      .select('id, order_id, template_key, channel, source, status, created_at, sent_at, error')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false })
    if (error) {
      logClientError('Admin order message history refresh failed', error)
      setErrorMessage('Le message a été traité, mais son historique n’a pas pu être actualisé.')
      return
    }
    setMessageLogs((current) => [
      ...current.filter((log) => log.order_id !== orderId),
      ...((data ?? []) as MessageLog[]),
    ])
  }

  async function updateStatus(orderId: string, status: string) {
    setSavingId(orderId)
    setErrorMessage('')
    const { error } = await supabase.from('orders').update({ status }).eq('id', orderId)
    setSavingId('')
    if (error) {
      logClientError('Admin order status update failed', error)
      setErrorMessage('Le statut de la commande n’a pas pu être modifié. Vérifiez votre accès administrateur.')
      return false
    }
    setOrders((current) => current.map((order) => order.id === orderId ? { ...order, status } : order))
    return true
  }

  function chooseStatus(order: AdminOrder, status: string) {
    if (status === order.status) return
    if (isPaidOrder(order) && ['en_transit', 'prête_a_retirer'].includes(status)) {
      setPendingStatus({ orderId: order.id, status, sendMessage: true, dateEstimate: '' })
      setErrorMessage('')
      return
    }
    void updateStatus(order.id, status)
  }

  async function confirmStatusChange() {
    if (!pendingStatus) return
    const current = pendingStatus
    if (current.sendMessage && current.status === 'en_transit' && !current.dateEstimate.trim()) {
      setErrorMessage('Saisissez la date estimée d’arrivée ou décochez l’envoi du message.')
      return
    }

    setErrorMessage('')
    const updated = await updateStatus(current.orderId, current.status)
    if (!updated) return
    setPendingStatus(null)
    if (!current.sendMessage) return

    const automaticTemplate: OrderMessageTemplateKey = current.status === 'en_transit' ? 'en_transit' : 'prete_a_retirer'
    try {
      const body = await apiMessageRequest({
        action: 'send',
        orderId: current.orderId,
        templateKey: automaticTemplate,
        variables: current.status === 'en_transit' ? { date_estimee: current.dateEstimate.trim() } : {},
      })
      const warnings = Array.isArray(body.warnings) ? body.warnings.filter((item): item is string => typeof item === 'string') : []
      setMessageFeedback({
        orderId: current.orderId,
        text: [typeof body.message === 'string' ? body.message : 'Message traité.', ...warnings].join(' '),
        error: false,
      })
    } catch (error) {
      setMessageFeedback({
        orderId: current.orderId,
        text: error instanceof Error ? error.message : 'Le statut est enregistré, mais le message n’a pas pu être envoyé.',
        error: true,
      })
    }
    await refreshMessageLogs(current.orderId)
  }

  function openComposer(orderId: string, suggestedTemplate?: OrderMessageTemplateKey) {
    setComposerOrderId(orderId)
    setTemplateKey(suggestedTemplate ?? 'commande_confirmee')
    setExtraVariables({})
    setPreview(null)
    setMessageFeedback(null)
    setWhatsAppUrl('')
  }

  async function previewMessage() {
    if (!composerOrderId) return
    setPreviewing(true)
    setPreview(null)
    setMessageFeedback(null)
    try {
      const body = await apiMessageRequest({
        action: 'preview',
        orderId: composerOrderId,
        templateKey,
        variables: extraVariables,
      })
      if (typeof body.subject !== 'string' || typeof body.text !== 'string') {
        throw new Error('Le serveur n’a pas retourné un aperçu valide.')
      }
      const warnings = Array.isArray(body.warnings) ? body.warnings.filter((item): item is string => typeof item === 'string') : []
      setPreview({ subject: body.subject, text: body.text, warnings })
    } catch (error) {
      setMessageFeedback({
        orderId: composerOrderId,
        text: error instanceof Error ? error.message : 'L’aperçu n’a pas pu être préparé.',
        error: true,
      })
    } finally {
      setPreviewing(false)
    }
  }

  async function sendEmail() {
    if (!composerOrderId || !preview) return
    setMessageBusy(true)
    setMessageFeedback(null)
    try {
      const body = await apiMessageRequest({
        action: 'send',
        orderId: composerOrderId,
        templateKey,
        variables: extraVariables,
      })
      const warnings = Array.isArray(body.warnings) ? body.warnings.filter((item): item is string => typeof item === 'string') : []
      setMessageFeedback({
        orderId: composerOrderId,
        text: [typeof body.message === 'string' ? body.message : 'Le courriel a été traité.', ...warnings].join(' '),
        error: false,
      })
      await refreshMessageLogs(composerOrderId)
    } catch (error) {
      setMessageFeedback({
        orderId: composerOrderId,
        text: error instanceof Error ? error.message : 'Le courriel n’a pas pu être envoyé.',
        error: true,
      })
      await refreshMessageLogs(composerOrderId)
    } finally {
      setMessageBusy(false)
    }
  }

  async function prepareWhatsApp() {
    if (!composerOrderId || !preview) return
    const popup = window.open('about:blank', '_blank')
    if (popup) popup.opener = null
    setMessageBusy(true)
    setMessageFeedback(null)
    setWhatsAppUrl('')
    try {
      const body = await apiMessageRequest({
        action: 'prepare-whatsapp',
        orderId: composerOrderId,
        templateKey,
        variables: extraVariables,
      })
      if (typeof body.url !== 'string' || !body.url.startsWith('https://wa.me/')) {
        throw new Error('Le lien WhatsApp préparé est invalide.')
      }
      setWhatsAppUrl(body.url)
      if (popup) popup.location.href = body.url
      const warnings = Array.isArray(body.warnings) ? body.warnings.filter((item): item is string => typeof item === 'string') : []
      setMessageFeedback({
        orderId: composerOrderId,
        text: ['Message WhatsApp préparé. Il ne sera marqué comme envoyé que si vous l’envoyez dans WhatsApp.', ...warnings].join(' '),
        error: false,
      })
      await refreshMessageLogs(composerOrderId)
    } catch (error) {
      popup?.close()
      setMessageFeedback({
        orderId: composerOrderId,
        text: error instanceof Error ? error.message : 'Le message WhatsApp n’a pas pu être préparé.',
        error: true,
      })
    } finally {
      setMessageBusy(false)
    }
  }

  async function resendConfirmation(orderId: string) {
    setMessageFeedback(null)
    setMessageBusy(true)
    try {
      const body = await apiMessageRequest({
        action: 'send',
        orderId,
        templateKey: 'commande_confirmee',
        variables: {},
      })
      const warnings = Array.isArray(body.warnings) ? body.warnings.filter((item): item is string => typeof item === 'string') : []
      setMessageFeedback({
        orderId,
        text: [typeof body.message === 'string' ? body.message : 'Le courriel a été traité.', ...warnings].join(' '),
        error: false,
      })
    } catch (error) {
      setMessageFeedback({
        orderId,
        text: error instanceof Error ? error.message : 'Le courriel n’a pas pu être renvoyé.',
        error: true,
      })
    } finally {
      setMessageBusy(false)
      await refreshMessageLogs(orderId)
    }
  }

  if (checking) return <main className="admin-page"><div className="admin-state">Vérification de l’accès...</div></main>
  if (!authorized) {
    return (
      <main className="admin-page"><section className="admin-access-state">
        <p className="eyebrow">JALIMS · ADMINISTRATION</p><h1>Accès réservé</h1>
        <p>Connectez-vous avec un compte administrateur pour gérer les commandes.</p>
        <Link className="admin-primary-link" href="/login?next=%2Fadmin%2Fcommandes">Se connecter</Link>
      </section></main>
    )
  }

  return (
    <main className="admin-page">
      <div className="admin-shell">
        <header className="admin-header">
          <div><p className="eyebrow">JALIMS · ADMINISTRATION</p><h1>Commandes</h1><p>Actualisez le statut après chaque étape du parcours.</p></div>
          <Link className="admin-catalog-link" href="/admin">Gestion des produits →</Link>
        </header>
        <nav className="admin-shortcuts" aria-label="Outils d’administration">
          <Link className="admin-nav-item" href="/admin">Produits</Link>
          <Link className="admin-nav-item current" href="/admin/commandes">Commandes</Link>
          <Link className="admin-nav-item" href="/admin/messages">Messages</Link>
          <Link className="admin-nav-item" href="/admin/retraits">Points de retrait</Link>
        </nav>
        {errorMessage && <p className="admin-feedback error" role="alert">{errorMessage}</p>}
        {orders.length === 0 ? (
          <div className="orders-state">Aucune commande enregistrée pour le moment.</div>
        ) : (
          <div className="admin-orders-list">
            {orders.map((order) => {
              const orderLogs = messageLogs.filter((log) => log.order_id === order.id)
              const stalledThreshold = now - 5 * 60 * 1000
              const confirmationAlerts = orderLogs.filter((log) =>
                log.template_key === 'commande_confirmee'
                && log.channel === 'email'
                && log.source === 'automatic'
                && (log.status === 'echec' || (log.status === 'en_cours' && new Date(log.created_at).getTime() < stalledThreshold)),
              )
              const pending = pendingStatus?.orderId === order.id ? pendingStatus : null
              const composing = composerOrderId === order.id
              return (
                <article className="admin-order-row admin-order-message-row" key={order.id}>
                  <div className="order-product-thumb">{order.products?.image_url && <Image src={order.products.image_url} alt="" fill sizes="58px" unoptimized />}</div>
                  <div className="admin-order-main">
                    <strong>{order.products?.name ?? 'Produit Jalims'}</strong>
                    <span>{order.jalims_code} · {order.quantity} unité{order.quantity === 1 ? '' : 's'}</span>
                    {order.variant_lines.length > 0 ? order.variant_lines.map((line) => (
                      <span key={line.id}>
                        {Object.entries(line.attribute_values).map(([key, value]) => `${attributeLabels[key] ?? key.replaceAll('_', ' ')} : ${value}`).join(' · ')} · {line.quantity} × {Number(line.unit_price).toLocaleString('fr-FR')} FCFA
                      </span>
                    )) : Object.entries(order.variant_values ?? {}).map(([key, value]) => <span key={key}>{attributeLabels[key] ?? key.replaceAll('_', ' ')} : {value}</span>)}
                    {(order.variant_id || order.variant_lines.length > 0) && isPaidOrder(order) && !order.variant_stock_committed && <span className="variant-stock-warning">Paiement tardif : vérifier le stock des variantes de cette commande.</span>}
                    <span>{order.pickup_points ? `${order.pickup_points.name}, ${order.pickup_points.city}` : 'Point de retrait à confirmer'}</span>
                  </div>
                  <b className="admin-order-total">{Number(order.total_price).toLocaleString('fr-FR')} FCFA</b>
                  <label className="admin-order-status">
                    <span>Statut</span>
                    <select value={pending?.status ?? order.status} disabled={savingId === order.id || Boolean(pending)} onChange={(event) => chooseStatus(order, event.target.value)}>
                      {statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>

                  {confirmationAlerts.length > 0 && (
                    <div className="order-message-alert">
                      <span className="order-message-alert-badge">E-mail de confirmation en échec ou interrompu</span>
                      <button type="button" disabled={messageBusy} onClick={() => void resendConfirmation(order.id)}>Renvoyer</button>
                    </div>
                  )}

                  {pending && (
                    <div className="order-status-message-prompt">
                      <label><input type="checkbox" checked={pending.sendMessage} onChange={(event) => setPendingStatus({ ...pending, sendMessage: event.target.checked })} /> Envoyer le message « {pending.status === 'en_transit' ? 'En transit' : 'Prête à retirer'} » par e-mail</label>
                      {pending.status === 'en_transit' && pending.sendMessage && (
                        <label className="order-message-field"><span>Date estimée d’arrivée</span><input value={pending.dateEstimate} onChange={(event) => setPendingStatus({ ...pending, dateEstimate: event.target.value })} placeholder="Ex. 15 novembre 2026" /></label>
                      )}
                      {pending.status === 'prête_a_retirer' && <p>Le message ne sera envoyé que si l’adresse et les horaires du point de retrait sont renseignés.</p>}
                      <div><button type="button" onClick={() => void confirmStatusChange()}>Enregistrer le statut</button><button type="button" className="secondary" onClick={() => setPendingStatus(null)}>Annuler</button></div>
                    </div>
                  )}

                  <div className="order-message-actions">
                    <button type="button" onClick={() => composing ? setComposerOrderId('') : openComposer(order.id)}>Envoyer un message</button>
                  </div>

                  {messageFeedback?.orderId === order.id && <p className={`admin-feedback ${messageFeedback.error ? 'error' : 'success'} order-message-feedback`} role={messageFeedback.error ? 'alert' : 'status'}>{messageFeedback.text}</p>}

                  {composing && (
                    <section className="order-message-composer">
                      <div className="order-message-composer-heading"><h3>Envoyer un message</h3><button type="button" className="secondary" onClick={() => setComposerOrderId('')}>Fermer</button></div>
                      <label className="order-message-field"><span>Modèle</span>
                        <select value={templateKey} onChange={(event) => {
                          if (!isOrderMessageTemplateKey(event.target.value)) return
                          setTemplateKey(event.target.value)
                          setExtraVariables({})
                          setPreview(null)
                          setWhatsAppUrl('')
                        }}>
                          {ORDER_MESSAGE_TEMPLATE_KEYS.map((key) => <option key={key} value={key}>{templateLabels[key]}</option>)}
                        </select>
                      </label>
                      {(messageFields[templateKey] ?? []).map((field) => (
                        <label className="order-message-field" key={field.key}>
                          <span>{field.label}{field.optional ? ' (facultatif)' : ''}</span>
                          <input
                            value={extraVariables[field.key] ?? ''}
                            onChange={(event) => {
                              setExtraVariables({ ...extraVariables, [field.key]: event.target.value })
                              setPreview(null)
                              setWhatsAppUrl('')
                            }}
                            placeholder={field.optional ? 'Utiliser le délai des réglages si laissé vide' : ''}
                            required={!field.optional}
                          />
                        </label>
                      ))}
                      <button type="button" disabled={previewing} onClick={() => void previewMessage()}>{previewing ? 'Préparation de l’aperçu...' : 'Afficher l’aperçu'}</button>
                      {preview && (
                        <div className="order-message-preview">
                          <strong>Objet : {preview.subject}</strong>
                          <pre>{preview.text}</pre>
                          {preview.warnings.map((warning) => <p className="order-message-warning" key={warning}>{warning}</p>)}
                          <div className="order-message-send-actions">
                            <button type="button" disabled={messageBusy} onClick={() => void sendEmail()}>{messageBusy ? 'Traitement...' : 'Envoyer par e-mail'}</button>
                            <button type="button" className="secondary" disabled={messageBusy} onClick={() => void prepareWhatsApp()}>{messageBusy ? 'Traitement...' : 'Préparer WhatsApp'}</button>
                          </div>
                          {whatsAppUrl && <a className="order-message-whatsapp-link" href={whatsAppUrl} target="_blank" rel="noopener noreferrer">Ouvrir WhatsApp</a>}
                        </div>
                      )}
                    </section>
                  )}

                  {orderLogs.length > 0 && (
                    <details className="order-message-history">
                      <summary>Historique des messages ({orderLogs.length})</summary>
                      <ul>
                        {orderLogs.map((log) => (
                          <li key={log.id}>
                            <div><strong>{isOrderMessageTemplateKey(log.template_key) ? templateLabels[log.template_key] : log.template_key}</strong><span>{log.channel === 'email' ? 'E-mail' : 'WhatsApp'} · {messageStatusLabels[log.status]}</span></div>
                            <time dateTime={log.sent_at ?? log.created_at}>{new Date(log.sent_at ?? log.created_at).toLocaleString('fr-FR')}</time>
                            {log.error && <p>{log.error}</p>}
                            {log.source === 'automatic' && log.template_key === 'commande_confirmee' && log.status === 'echec' && <small>E-mail automatique — tentative initiale</small>}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
