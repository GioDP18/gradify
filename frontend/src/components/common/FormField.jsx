import { forwardRef, useId } from 'react';

/**
 * Label + control + help/error text, wired for accessibility.
 * Works with React Hook Form's register() via ref forwarding.
 */
export const TextField = forwardRef(function TextField(
  { label, error, hint, type = 'text', className = '', required, ...props },
  ref,
) {
  const id = useId();
  const describedBy = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`mb-3 ${className}`}>
      <label htmlFor={id} className="form-label">
        {label}
        {required && <span className="text-danger ms-1" aria-hidden="true">*</span>}
      </label>
      <input
        ref={ref}
        id={id}
        type={type}
        className={`form-control ${error ? 'is-invalid' : ''}`}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        {...props}
      />
      {hint && !error && <div id={`${id}-hint`} className="form-text">{hint}</div>}
      {error && <div id={`${id}-error`} className="invalid-feedback">{error}</div>}
    </div>
  );
});

export const SelectField = forwardRef(function SelectField(
  { label, error, hint, options, className = '', required, placeholder, ...props },
  ref,
) {
  const id = useId();
  const describedBy = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`mb-3 ${className}`}>
      <label htmlFor={id} className="form-label">
        {label}
        {required && <span className="text-danger ms-1" aria-hidden="true">*</span>}
      </label>
      <select
        ref={ref}
        id={id}
        className={`form-select ${error ? 'is-invalid' : ''}`}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        {...props}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      {hint && !error && <div id={`${id}-hint`} className="form-text">{hint}</div>}
      {error && <div id={`${id}-error`} className="invalid-feedback">{error}</div>}
    </div>
  );
});

/** Copies field-level validation errors from a 422 API response into React Hook Form. */
export function applyServerErrors(error, setError, fields) {
  if (error?.code !== 'VALIDATION_ERROR' || !Array.isArray(error.details)) return false;
  let applied = false;
  for (const detail of error.details) {
    if (!fields || fields.includes(detail.field)) {
      setError(detail.field, { type: 'server', message: detail.message });
      applied = true;
    }
  }
  return applied;
}
