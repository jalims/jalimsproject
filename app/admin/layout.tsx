import type { ReactNode } from 'react'
import AdminShell from './admin-shell'
import { AdminSessionProvider } from './admin-session-provider'
import './admin.css'
import './_components/components.css'

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminSessionProvider>
      <AdminShell>{children}</AdminShell>
    </AdminSessionProvider>
  )
}
