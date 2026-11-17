import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/** Feuille glissante (téléphone) / boîte de dialogue (ordinateur). */
export function Sheet({ open, onClose, title, children, footer, labelledBy }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    setTimeout(() => ref.current?.querySelector<HTMLElement>('input, textarea, select, button:not([data-close])')?.focus(), 60);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} aria-labelledby={labelledBy} ref={ref}>
        <div className="sheet-grip" />
        {title !== undefined && (
          <div className="sheet-head">
            <h2>{title}</h2>
            <button className="btn ghost icon sm" onClick={onClose} aria-label="Fermer" data-close>
              <X size={20} />
            </button>
          </div>
        )}
        <div className="stack" style={{ ['--gap' as string]: '16px' }}>
          {children}
        </div>
        {footer && <div className="row" style={{ marginTop: 20, justifyContent: 'flex-end', flexWrap: 'wrap' }}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
