'use client'

type QuantityInputProps = {
  value: string
  minimum: number
  onChange: (value: string) => void
  ariaLabel: string
  required?: boolean
}

export default function QuantityInput({ value, minimum, onChange, ariaLabel, required = false }: QuantityInputProps) {
  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      aria-label={ariaLabel}
      required={required}
      value={value}
      onChange={(event) => onChange(event.target.value.replace(/\D/g, ''))}
      onBlur={() => {
        const parsedValue = Number.parseInt(value, 10)
        onChange(String(Number.isFinite(parsedValue) ? Math.max(minimum, parsedValue) : minimum))
      }}
    />
  )
}