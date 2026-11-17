import { useState, type ReactNode } from 'react';
import { Sheet } from './Sheet';

/** Confirmation explicite avant une action importante. */
export function useConfirm() {
  const [state, setState] = useState<{ title: string; body: ReactNode; confirm: string; danger?: boolean; resolve: (v: boolean) => void } | null>(null);
  const ask = (title: string, body: ReactNode, confirm = 'Confirmer', danger = false) =>
    new Promise<boolean>((resolve) => setState({ title, body, confirm, danger, resolve }));
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  const node = (
    <Sheet
      open={!!state}
      onClose={() => close(false)}
      title={state?.title}
      footer={
        <>
          <button className="btn ghost" onClick={() => close(false)}>Annuler</button>
          <button className={`btn ${state?.danger ? 'danger' : 'primary'}`} onClick={() => close(true)}>{state?.confirm}</button>
        </>
      }
    >
      <div className="muted">{state?.body}</div>
    </Sheet>
  );
  return { ask, node };
}
