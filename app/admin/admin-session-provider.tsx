'use client'

import type { Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getStaffRoleForUser, type StaffRole } from '../../lib/admin-staff-client'
import { logClientError } from '../../lib/user-facing-errors'
import { supabase } from '../../lib/supabase'

export type AdminSession = {
  userId: string | null
  email: string
  role: StaffRole | null
  loading: boolean
  error: string | null
}

const emptySession: AdminSession = {
  userId: null,
  email: '',
  role: null,
  loading: true,
  error: null,
}

const AdminSessionContext = createContext<AdminSession | null>(null)

export function AdminSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState(emptySession)
  const generation = useRef(0)

  useEffect(() => {
    let active = true
    let initialSessionLoaded = false

    async function updateSession(nextSession: Session | null, sessionError?: unknown) {
      const currentGeneration = ++generation.current
      if (sessionError) {
        logClientError('Admin session load failed', sessionError)
        if (active && currentGeneration === generation.current) {
          setSession({
            userId: null,
            email: '',
            role: null,
            loading: false,
            error: 'La session administrateur n’a pas pu être vérifiée.',
          })
        }
        return
      }

      const user = nextSession?.user
      if (!user) {
        if (active) setSession({ userId: null, email: '', role: null, loading: false, error: null })
        return
      }

      if (active) {
        setSession({
          userId: user.id,
          email: user.email ?? '',
          role: null,
          loading: true,
          error: null,
        })
      }

      try {
        const role = await getStaffRoleForUser(user)
        if (active && currentGeneration === generation.current) {
          setSession({
            userId: user.id,
            email: user.email ?? '',
            role,
            loading: false,
            error: null,
          })
        }
      } catch (error) {
        logClientError('Admin role load failed', error)
        if (active && currentGeneration === generation.current) {
          setSession({
            userId: user.id,
            email: user.email ?? '',
            role: null,
            loading: false,
            error: 'Le rôle administrateur n’a pas pu être vérifié.',
          })
        }
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (initialSessionLoaded) void updateSession(nextSession)
    })

    void supabase.auth.getSession()
      .then(({ data, error }) => {
        initialSessionLoaded = true
        void updateSession(data.session, error)
      })
      .catch((error: unknown) => {
        initialSessionLoaded = true
        void updateSession(null, error)
      })

    return () => {
      active = false
      generation.current += 1
      subscription.unsubscribe()
    }
  }, [])

  const value = useMemo(() => session, [session])
  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>
}

export function useAdminSession() {
  const session = useContext(AdminSessionContext)
  if (!session) throw new Error('useAdminSession doit être utilisé dans AdminSessionProvider.')
  return session
}
