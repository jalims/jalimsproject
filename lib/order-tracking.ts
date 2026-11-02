export const importOrderStatusOptions = [
  ['pending_payment', 'En attente de paiement'],
  ['payé', 'Payé'],
  ['commandé_fournisseur', 'Commandé au fournisseur'],
  ['chez_transitaire', 'Chez le transitaire'],
  ['en_transit', 'En transit'],
  ['arrivé', 'Arrivé au Sénégal'],
  ['prête_a_retirer', 'Prête à retirer'],
  ['récupéré', 'Récupéré'],
  ['cancelled', 'Annulé'],
] as const

export const localOrderStatusOptions = [
  ['pending_payment', 'En attente de paiement'],
  ['payé', 'Commande reçue'],
  ['commandé_fournisseur', 'Stock confirmé'],
  ['chez_transitaire', 'En préparation'],
  ['en_transit', 'En livraison'],
  ['récupéré', 'Livré'],
  ['cancelled', 'Annulé'],
] as const

export const importTrackingSteps = ['Payée', 'Commandée', 'En transit', 'Prête à retirer', 'Retirée']
export const localTrackingSteps = ['Commande reçue', 'Stock confirmé', 'En préparation', 'En livraison', 'Livré']

export function getOrderStatusLabel(status: string, origin: string) {
  const options = origin === 'local' ? localOrderStatusOptions : importOrderStatusOptions
  return options.find(([value]) => value === status)?.[1] ?? status
}

export function getOrderTrackingStep(status: string, origin: string) {
  if (origin === 'local') {
    if (status === 'payé') return 0
    if (status === 'commandé_fournisseur') return 1
    if (status === 'chez_transitaire') return 2
    if (status === 'en_transit') return 3
    if (status === 'récupéré') return 4
    return -1
  }

  if (status === 'payé') return 0
  if (status === 'commandé_fournisseur') return 1
  if (['chez_transitaire', 'en_transit', 'arrivé'].includes(status)) return 2
  if (status === 'prête_a_retirer') return 3
  if (status === 'récupéré') return 4
  return -1
}

export function getOrderTrackingSteps(origin: string) {
  return origin === 'local' ? localTrackingSteps : importTrackingSteps
}
