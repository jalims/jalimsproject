'use client'

import { createContext, useContext, type ReactNode } from 'react'

type AdminDashboardContextValue = {
  newRequestCount: number | null
  newRequestError: string | null
  updateNewRequestCount: (count: number) => void
}

const AdminDashboardContext = createContext<AdminDashboardContextValue | null>(null)

export function AdminDashboardProvider({
  children,
  newRequestCount,
  newRequestError,
  updateNewRequestCount,
}: AdminDashboardContextValue & { children: ReactNode }) {
  return (
    <AdminDashboardContext.Provider value={{ newRequestCount, newRequestError, updateNewRequestCount }}>
      {children}
    </AdminDashboardContext.Provider>
  )
}

export function useAdminDashboard() {
  const context = useContext(AdminDashboardContext)
  if (!context) throw new Error('useAdminDashboard doit être utilisé dans AdminShell.')
  return context
}
