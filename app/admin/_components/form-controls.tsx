'use client'

import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'

type FieldProps = {
  label: string
  hint?: ReactNode
  error?: string
}

type InputProps = FieldProps & InputHTMLAttributes<HTMLInputElement>
type SelectProps = FieldProps & SelectHTMLAttributes<HTMLSelectElement>
type TextareaProps = FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>

function FieldMessages({ id, hint, error }: { id: string; hint?: ReactNode; error?: string }) {
  return (
    <>
      {hint && <span className="admin-ui-field-hint" id={`${id}-hint`}>{hint}</span>}
      {error && <span className="admin-ui-field-error" id={`${id}-error`} role="alert">{error}</span>}
    </>
  )
}

function getDescriptionIds(id: string, hint: ReactNode, error?: string, existing?: string) {
  return [
    existing,
    hint ? `${id}-hint` : '',
    error ? `${id}-error` : '',
  ].filter(Boolean).join(' ') || undefined
}

function FieldLabel({ htmlFor, label, required }: { htmlFor: string; label: string; required?: boolean }) {
  return (
    <label className="admin-ui-field-label" htmlFor={htmlFor}>
      {label}
      {required && <span className="admin-ui-required" aria-hidden="true"> *</span>}
    </label>
  )
}

export function Input({ label, hint, error, id, required, className = '', ...props }: InputProps) {
  const generatedId = useId()
  const controlId = id ?? generatedId
  return (
    <div className="admin-ui-field">
      <FieldLabel htmlFor={controlId} label={label} required={required} />
      <input
        {...props}
        id={controlId}
        className={`admin-ui-control${error ? ' is-invalid' : ''}${className ? ` ${className}` : ''}`}
        required={required}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={getDescriptionIds(controlId, hint, error, props['aria-describedby'])}
      />
      <FieldMessages id={controlId} hint={hint} error={error} />
    </div>
  )
}

export function Select({ label, hint, error, id, required, className = '', children, ...props }: SelectProps) {
  const generatedId = useId()
  const controlId = id ?? generatedId
  return (
    <div className="admin-ui-field">
      <FieldLabel htmlFor={controlId} label={label} required={required} />
      <select
        {...props}
        id={controlId}
        className={`admin-ui-control admin-ui-select${error ? ' is-invalid' : ''}${className ? ` ${className}` : ''}`}
        required={required}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={getDescriptionIds(controlId, hint, error, props['aria-describedby'])}
      >
        {children}
      </select>
      <FieldMessages id={controlId} hint={hint} error={error} />
    </div>
  )
}

export function Textarea({ label, hint, error, id, required, className = '', ...props }: TextareaProps) {
  const generatedId = useId()
  const controlId = id ?? generatedId
  return (
    <div className="admin-ui-field">
      <FieldLabel htmlFor={controlId} label={label} required={required} />
      <textarea
        {...props}
        id={controlId}
        className={`admin-ui-control admin-ui-textarea${error ? ' is-invalid' : ''}${className ? ` ${className}` : ''}`}
        required={required}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={getDescriptionIds(controlId, hint, error, props['aria-describedby'])}
      />
      <FieldMessages id={controlId} hint={hint} error={error} />
    </div>
  )
}

export type SwitchProps = {
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  hint?: ReactNode
  disabled?: boolean
  id?: string
  name?: string
}

export function Switch({ label, checked, onCheckedChange, hint, disabled, id, name }: SwitchProps) {
  const generatedId = useId()
  const controlId = id ?? generatedId
  const hintId = hint ? `${controlId}-hint` : undefined
  return (
    <div className={`admin-ui-field admin-ui-switch-field${disabled ? ' is-disabled' : ''}`}>
      <div className="admin-ui-switch-copy">
        <label className="admin-ui-field-label" htmlFor={controlId}>{label}</label>
        {hint && <span className="admin-ui-field-hint" id={hintId}>{hint}</span>}
      </div>
      <input
        id={controlId}
        className="admin-ui-switch"
        type="checkbox"
        role="switch"
        name={name}
        checked={checked}
        disabled={disabled}
        aria-checked={checked}
        aria-describedby={hintId}
        onChange={(event) => onCheckedChange(event.currentTarget.checked)}
      />
    </div>
  )
}
