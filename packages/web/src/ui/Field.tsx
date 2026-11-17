import { cloneElement, isValidElement, useId, type InputHTMLAttributes, type ReactElement, type ReactNode } from 'react';

const CONTROLS = new Set(['input', 'select', 'textarea']);

/**
 * Champ avec libellé. Le libellé est automatiquement associé au contrôle (accessibilité :
 * lecteurs d'écran, clic sur le libellé) lorsqu'il s'agit d'un champ unique.
 */
export function Field({ label, hint, error, children, htmlFor }: { label?: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string }) {
  const autoId = useId();
  let content = children;
  let forId = htmlFor;
  if (!forId && isValidElement(children)) {
    const el = children as ReactElement<{ id?: string }>;
    // Contrôles natifs, ou composants marqués `fieldControl` (le nom de fonction ne survit pas à la minification).
    const isControl = typeof el.type === 'string' ? CONTROLS.has(el.type) : !!(el.type as { fieldControl?: boolean }).fieldControl;
    if (isControl) {
      forId = el.props.id ?? autoId;
      if (!el.props.id) content = cloneElement(el, { id: forId });
    }
  }
  return (
    <div className="field">
      {label && <label htmlFor={forId}>{label}</label>}
      {content}
      {error ? <div className="error-text" role="alert">{error}</div> : hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function TextField({ label, hint, error, ...props }: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; hint?: ReactNode; error?: string | null }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} htmlFor={props.id ?? id}>
      <input id={props.id ?? id} className="input" aria-invalid={!!error} {...props} />
    </Field>
  );
}
