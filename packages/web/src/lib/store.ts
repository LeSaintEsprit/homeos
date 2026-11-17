import { useSyncExternalStore } from 'react';

/** Petit magasin observable (sans dépendance) utilisable avec useSyncExternalStore. */
export class Observable<T> {
  private listeners = new Set<() => void>();
  constructor(protected state: T) {}
  get = () => this.state;
  set(next: T) {
    this.state = next;
    for (const l of this.listeners) l();
  }
  update(fn: (s: T) => T) {
    this.set(fn(this.state));
  }
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}

export function useObservable<T>(o: Observable<T>): T {
  return useSyncExternalStore(o.subscribe, o.get, o.get);
}
