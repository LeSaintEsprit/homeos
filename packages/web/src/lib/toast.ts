import { Observable } from './store';

export type ToastKind = 'success' | 'error' | 'warning' | 'info';
export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  action?: { label: string; run: () => void };
  ms: number;
}

export const toasts = new Observable<Toast[]>([]);
let seq = 0;

export function toast(message: string, kind: ToastKind = 'success', opts: { action?: Toast['action']; ms?: number } = {}) {
  const t: Toast = { id: ++seq, kind, message, action: opts.action, ms: opts.ms ?? (kind === 'error' ? 6000 : opts.action ? 6000 : 3200) };
  toasts.update((list) => [...list.slice(-2), t]);
  setTimeout(() => dismissToast(t.id), t.ms);
  return t.id;
}

export function dismissToast(id: number) {
  toasts.update((list) => list.filter((t) => t.id !== id));
}
