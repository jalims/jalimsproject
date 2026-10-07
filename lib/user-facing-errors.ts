export function logClientError(context: string, error: unknown) {
  console.error(`[${context}]`, error)
}

export function getAuthErrorMessage(error: unknown) {
  logClientError('Account authentication', error)

  const details = typeof error === 'object' && error !== null
    ? error as { code?: unknown; message?: unknown }
    : {}
  const code = typeof details.code === 'string' ? details.code.toLowerCase() : ''
  const message = typeof details.message === 'string' ? details.message.toLowerCase() : ''
  const text = `${code} ${message}`

  if (text.includes('rate limit') || text.includes('rate_limit') || text.includes('too many requests')) {
    return 'Trop de demandes ont été effectuées. Veuillez patienter avant de réessayer.'
  }
  if (
    text.includes('already registered')
    || text.includes('user already exists')
    || text.includes('user_already_exists')
    || text.includes('email_exists')
  ) {
    return 'Cette adresse e-mail est déjà associée à un compte. Connectez-vous ou choisissez une autre adresse.'
  }
  if (text.includes('email not confirmed') || text.includes('email_not_confirmed')) {
    return 'Votre adresse e-mail n’est pas encore confirmée. Consultez votre boîte de réception.'
  }
  if (text.includes('invalid login credentials') || text.includes('invalid_credentials')) {
    return 'Adresse e-mail ou mot de passe incorrect.'
  }
  if (text.includes('weak_password') || text.includes('password should be at least') || text.includes('password is too short')) {
    return 'Le mot de passe doit contenir au moins 8 caractères.'
  }

  return 'Une erreur est survenue. Veuillez réessayer.'
}
