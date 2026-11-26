'use client'

import { createContext, useContext, type ReactNode } from 'react'

type AdminDashboardContextValue = {
  newRequestCount: number | null
  newRequestError: string | null
}

const AdminDashboardContext = createContext<AdminDashboardContextValue | null>(null)

export function AdminDashboardProvider({
  children,
  newRequestCount,
  newRequestError,
}: AdminDashboardContextValue & { children: ReactNode }) {
  return (
    <AdminDashboardContext.Provider value={{ newRequestCount, newRequestError }}>
      {children}
    </AdminDashboardContext.Provider>
  )
}

export function useAdminDashboard() {
  const context = useContext(AdminDashboardContext)
  if (!context) throw new Error('useAdminDashboard doit être utilisé dans AdminShell.')
  return context
}
