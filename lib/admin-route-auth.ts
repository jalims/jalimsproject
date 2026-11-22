import { ALL_STAFF_ROLES, requireRole } from './admin-staff'

export async function authorizeJalimsAdminRequest(request: Request, serviceName: string) {
  const authorization = await requireRole(request, ALL_STAFF_ROLES, serviceName)
  if ('response' in authorization) {
    return { response: authorization.response }
  }

  return { user: authorization.user }
}
