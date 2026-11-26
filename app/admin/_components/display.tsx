'use client'

import type { CSSProperties, ReactNode } from 'react'

export type BadgeVariant = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info'

export function Badge({
  children,
  variant = 'neutral',
  className = '',
}: {
  children: ReactNode
  variant?: BadgeVariant
  className?: string
}) {
  return <span className={`admin-ui-badge is-${variant}${className ? ` ${className}` : ''}`}>{children}</span>
}

export function Card({
  children,
  title,
  description,
  actions,
  className = '',
}: {
  children: ReactNode
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <section className={`admin-ui-card${className ? ` ${className}` : ''}`} aria-label={typeof title === 'string' ? title : undefined}>
      {(title || description || actions) && (
        <header className="admin-ui-card-header">
          <div className="admin-ui-card-heading">
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {actions && <div className="admin-ui-card-actions">{actions}</div>}
        </header>
      )}
      <div className="admin-ui-card-body">{children}</div>
    </section>
  )
}

export function StatCard({
  label,
  value,
  icon,
  trend,
}: {
  label: string
  value: ReactNode
  icon?: ReactNode
  trend?: { label: string; direction?: 'up' | 'down' | 'neutral' }
}) {
  return (
    <article className="admin-ui-stat-card">
      <div className="admin-ui-stat-copy">
        <span className="admin-ui-stat-label">{label}</span>
        <strong className="admin-ui-stat-value">{value}</strong>
        {trend && (
          <span className={`admin-ui-stat-trend is-${trend.direction ?? 'neutral'}`}>
            {trend.label}
          </span>
        )}
      </div>
      {icon && <span className="admin-ui-stat-icon" aria-hidden="true">{icon}</span>}
    </article>
  )
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className = '',
}: {
  title: string
  description?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={`admin-ui-empty-state${className ? ` ${className}` : ''}`} role="status">
      {icon && <div className="admin-ui-empty-icon" aria-hidden="true">{icon}</div>}
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {action && <div className="admin-ui-empty-action">{action}</div>}
    </div>
  )
}

export function Skeleton({
  variant = 'text',
  width,
  height,
  className = '',
}: {
  variant?: 'text' | 'rect' | 'circle'
  width?: CSSProperties['width']
  height?: CSSProperties['height']
  className?: string
}) {
  return (
    <span
      className={`admin-ui-skeleton is-${variant}${className ? ` ${className}` : ''}`}
      style={{ width, height }}
      aria-hidden="true"
    />
  )
}

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  level = 1,
  className = '',
}: {
  title: string
  description?: ReactNode
  eyebrow?: ReactNode
  actions?: ReactNode
  level?: 1 | 2
  className?: string
}) {
  const Heading = level === 1 ? 'h1' : 'h2'
  return (
    <header className={`admin-ui-page-header${className ? ` ${className}` : ''}`}>
      <div className="admin-ui-page-heading">
        {eyebrow && <p className="admin-ui-eyebrow">{eyebrow}</p>}
        <Heading>{title}</Heading>
        {description && <p className="admin-ui-page-description">{description}</p>}
      </div>
      {actions && <div className="admin-ui-page-actions">{actions}</div>}
    </header>
  )
}
