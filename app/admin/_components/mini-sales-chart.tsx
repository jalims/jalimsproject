export type MiniSalesPoint = {
  date: string
  revenue: number
}

function formatDay(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

export function MiniSalesChart({ points }: { points: MiniSalesPoint[] }) {
  const width = 720
  const height = 190
  const paddingX = 12
  const paddingY = 16
  const chartWidth = width - paddingX * 2
  const chartHeight = height - paddingY * 2
  const maxRevenue = Math.max(...points.map((point) => Number(point.revenue) || 0), 1)
  const coordinates = points.map((point, index) => {
    const x = paddingX + (points.length <= 1 ? chartWidth / 2 : (index / (points.length - 1)) * chartWidth)
    const y = paddingY + chartHeight - ((Number(point.revenue) || 0) / maxRevenue) * chartHeight
    return { point, x, y }
  })

  return (
    <div className="admin-ui-sales-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Chiffre d’affaires journalier sur les sept derniers jours">
        {[0, 0.5, 1].map((fraction) => {
          const y = paddingY + chartHeight * fraction
          return <line className="admin-ui-sales-gridline" key={fraction} x1={paddingX} y1={y} x2={width - paddingX} y2={y} />
        })}
        {coordinates.length > 1 && (
          <polyline
            className="admin-ui-sales-line"
            points={coordinates.map(({ x, y }) => `${x},${y}`).join(' ')}
          />
        )}
        {coordinates.map(({ point, x, y }) => (
          <circle className="admin-ui-sales-point" key={point.date} cx={x} cy={y} r="4">
            <title>{`${formatDay(point.date)} · ${Number(point.revenue || 0).toLocaleString('fr-FR')} FCFA`}</title>
          </circle>
        ))}
      </svg>
      <div className="admin-ui-sales-dates" aria-hidden="true">
        {points.map((point) => <span key={point.date}>{formatDay(point.date)}</span>)}
      </div>
    </div>
  )
}
