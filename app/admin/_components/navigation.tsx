'use client'

import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import { useEffect, useId, useRef, type KeyboardEvent } from 'react'

export function Pagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  label = 'Pagination',
}: {
  page: number
  pageSize: number
  totalItems: number
  onPageChange: (page: number) => void
  label?: string
}) {
  const safePageSize = Math.max(1, pageSize)
  const safePageCount = Math.max(1, Math.ceil(totalItems / safePageSize))
  const safePage = Math.min(Math.max(1, page), safePageCount)
  const firstItem = totalItems === 0 ? 0 : (safePage - 1) * safePageSize + 1
  const lastItem = Math.min(safePage * safePageSize, totalItems)

  return (
    <nav className="admin-ui-pagination" aria-label={label}>
      <span className="admin-ui-pagination-summary">
        {firstItem}–{lastItem} sur {totalItems}
      </span>
      <div className="admin-ui-pagination-controls">
        <button
          type="button"
          aria-label="Page précédente"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
        >
          <ChevronLeft size={17} aria-hidden="true" />
        </button>
        <span aria-current="page">Page {safePage} sur {safePageCount}</span>
        <button
          type="button"
          aria-label="Page suivante"
          disabled={safePage >= safePageCount}
          onClick={() => onPageChange(safePage + 1)}
        >
          <ChevronRight size={17} aria-hidden="true" />
        </button>
      </div>
    </nav>
  )
}

export function SearchInput({
  value,
  onChange,
  onDebouncedChange,
  placeholder = 'Rechercher…',
  label = 'Rechercher',
  debounceMs = 300,
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  onDebouncedChange?: (value: string) => void
  placeholder?: string
  label?: string
  debounceMs?: number
  className?: string
}) {
  const inputId = useId()
  useEffect(() => {
    if (!onDebouncedChange) return
    const timeout = window.setTimeout(() => onDebouncedChange(value), debounceMs)
    return () => window.clearTimeout(timeout)
  }, [debounceMs, onDebouncedChange, value])

  return (
    <div className={`admin-ui-search${className ? ` ${className}` : ''}`}>
      <Search size={17} aria-hidden="true" />
      <label className="admin-ui-visually-hidden" htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        type="search"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        aria-label={label}
      />
      {value && (
        <button type="button" aria-label="Effacer la recherche" onClick={() => onChange('')}>
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

export type TabItem = { id: string; label: string; count?: number }

export function Tabs({
  items,
  value,
  onChange,
  label = 'Onglets',
  className = '',
}: {
  items: TabItem[]
  value: string
  onChange: (value: string) => void
  label?: string
  className?: string
}) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) {
    if (items.length === 0) return
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % items.length
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + items.length) % items.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = items.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    const nextItem = items[nextIndex]
    onChange(nextItem.id)
    tabRefs.current[nextIndex]?.focus()
  }

  return (
    <div className={`admin-ui-tabs${className ? ` ${className}` : ''}`} role="tablist" aria-label={label}>
      {items.map((item, index) => (
        <button
          key={item.id}
          ref={(element) => { tabRefs.current[index] = element }}
          type="button"
          role="tab"
          aria-selected={value === item.id}
          tabIndex={value === item.id ? 0 : -1}
          onClick={() => onChange(item.id)}
          onKeyDown={(event) => handleKeyDown(event, index)}
        >
          {item.label}
          {item.count !== undefined && <span className="admin-ui-tab-count">{item.count}</span>}
        </button>
      ))}
    </div>
  )
}
