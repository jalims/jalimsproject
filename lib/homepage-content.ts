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
