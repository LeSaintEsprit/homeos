import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { dismissToast, toasts } from '../lib/toast';
import { useObservable } from '../lib/store';

const ICONS = { success: CheckCircle2, error: XCircle, warning: AlertTriangle, info: Info };

export function Toasts() {
  const list = useObservable(toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => {
        const I = ICONS[t.kind];
        return (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => !t.action && dismissToast(t.id)}>
            <span className="t-icon"><I size={20} /></span>
            <span>{t.message}</span>
            {t.action && (
              <button
                className="t-action"
                onClick={() => {
                  t.action!.run();
                  dismissToast(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
