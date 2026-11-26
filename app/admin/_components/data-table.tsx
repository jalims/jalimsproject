'use client'

import { ArrowDownWideNarrow, ArrowUpWideNarrow, ArrowUpDown } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Skeleton } from './display'

export type DataTableColumn<Row> = {
  key: string
  label: string
  header?: ReactNode
  render: (row: Row) => ReactNode
  sortValue?: (row: Row) => string | number | Date | null
}

type SortState = { key: string; direction: 'asc' | 'desc' }

function compareValues(left: string | number | Date | null, right: string | number | Date | null) {
  if (left === null) return right === null ? 0 : -1
  if (right === null) return 1
  const leftValue = left instanceof Date ? left.getTime() : left
  const rightValue = right instanceof Date ? right.getTime() : right
  if (typeof leftValue === 'number' && typeof rightValue === 'number') return leftValue - rightValue
  return String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: 'base' })
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  caption,
  loading = false,
  loadingRows = 4,
  emptyState = 'Aucun élément à afficher.',
}: {
  columns: DataTableColumn<Row>[]
  rows: Row[]
  rowKey: (row: Row) => string | number
  caption: string
  loading?: boolean
  loadingRows?: number
  emptyState?: ReactNode
}) {
  const [sort, setSort] = useState<SortState | null>(null)
  const sortedRows = useMemo(() => {
    if (!sort) return rows
    const column = columns.find((item) => item.key === sort.key)
    if (!column?.sortValue) return rows
    const direction = sort.direction === 'asc' ? 1 : -1
    return [...rows].sort((left, right) => (
      compareValues(column.sortValue?.(left) ?? null, column.sortValue?.(right) ?? null) * direction
    ))
  }, [columns, rows, sort])

  function toggleSort(column: DataTableColumn<Row>) {
    if (!column.sortValue) return
    setSort((current) => ({
      key: column.key,
      direction: current?.key === column.key && current.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  return (
    <div className="admin-ui-table-scroll" aria-busy={loading}>
      <table className="admin-ui-table">
        <caption className="admin-ui-visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => {
              const isSorted = sort?.key === column.key
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={isSorted ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {column.sortValue ? (
                    <button
                      type="button"
                      className="admin-ui-sort-button"
                      onClick={() => toggleSort(column)}
                    >
                      {column.header ?? column.label}
                      {isSorted
                        ? sort.direction === 'asc'
                          ? <ArrowUpWideNarrow size={15} aria-hidden="true" />
                          : <ArrowDownWideNarrow size={15} aria-hidden="true" />
                        : <ArrowUpDown size={14} aria-hidden="true" />}
                    </button>
                  ) : column.header ?? column.label}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {loading && Array.from({ length: Math.max(1, loadingRows) }, (_, index) => (
            <tr key={`loading-${index}`} aria-hidden="true">
              {columns.map((column) => (
                <td data-label={column.label} key={column.key}>
                  <Skeleton width="72%" />
                </td>
              ))}
            </tr>
          ))}
          {!loading && sortedRows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td data-label={column.label} key={column.key}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
          {!loading && sortedRows.length === 0 && (
            <tr>
              <td className="admin-ui-table-empty" colSpan={columns.length}>{emptyState}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
