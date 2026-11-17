import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { can, type EntityCollections, type OpInput, type OpType, type Permission } from '@homeos/shared';
import { useObservable } from '../store';
import { toast } from '../toast';
import { refreshMe } from '../session';
import { deleteLocalHousehold } from './db';
import { SyncEngine, type RunOutcome, type SyncState } from './engine';

const Ctx = createContext<SyncEngine | null>(null);

export function EngineProvider({ userId, householdId, role, children }: { userId: string; householdId: string; role: import('@homeos/shared').Role; children: ReactNode }) {
  const [engine, setEngine] = useState<SyncEngine | null>(null);
  useEffect(() => {
    const e = new SyncEngine(userId, householdId, role);
    const off = e.on((ev) => {
      if (ev.kind === 'notice') for (const n of ev.notices) toast(n.message, 'warning', { ms: 6000 });
      if (ev.kind === 'issue') toast(`Synchronisation : ${ev.issue.message}`, 'error', { ms: 7000 });
      if (ev.kind === 'epoch') toast('Les données ont été restaurées sur le serveur : resynchronisation complète effectuée.', 'info');
      if (ev.kind === 'revoked') {
        void (async () => {
          await refreshMe();
          // Le foyer n'est plus accessible : ses données sont retirées de l'appareil.
          await deleteLocalHousehold(userId, householdId).catch(() => {});
        })();
      }
    });
    void e.init();
    setEngine(e);
    return () => {
      off();
      e.dispose();
    };
    // Le rôle initial ne recrée pas le moteur (il est ensuite lu dans les données synchronisées).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, householdId]);
  if (!engine) return null;
  return <Ctx.Provider value={engine}>{children}</Ctx.Provider>;
}

export function useEngine(): SyncEngine {
  const e = useContext(Ctx);
  if (!e) throw new Error('useEngine hors du foyer actif');
  return e;
}

export function useSync(): SyncState {
  return useObservable(useEngine().state);
}

export function useView(): EntityCollections {
  return useSync().view;
}

export function useCan(perm: Permission): boolean {
  return can(useSync().role, perm);
}

export interface RunOptions {
  /** Message de succès (sinon aucun). */
  success?: string;
  /** Proposer « Annuler » (annulation compensatoire des mouvements de stock). */
  undoable?: boolean;
}

/**
 * Exécute une opération avec retour visuel : refus immédiat (règle métier, droits)
 * ou avertissements de la prédiction locale.
 */
export function useRun() {
  const engine = useEngine();
  return useCallback(
    async <T extends OpType>(type: T, payload: OpInput<T>, opts: RunOptions = {}): Promise<RunOutcome> => {
      const out = await engine.run(type, payload);
      if (!out.ok) {
        toast(out.result.error?.message ?? 'Action impossible.', 'error');
        return out;
      }
      for (const c of out.result.conflicts) toast(`${c.label} : modifié entre-temps par un autre membre, votre valeur n'a pas été appliquée.`, 'warning', { ms: 7000 });
      for (const w of out.result.warnings) toast(w.message, 'warning', { ms: 6000 });
      if (opts.success && !out.result.warnings.length) {
        toast(opts.success, 'success', opts.undoable ? { action: { label: 'Annuler', run: () => void engine.run('movement.revertOp', { targetOpId: out.opId }) } } : {});
      }
      return out;
    },
    [engine],
  );
}

/** Mémorise un calcul dérivé de la vue (recalculé uniquement quand la vue change). */
export function useDerived<T>(fn: (v: EntityCollections) => T, deps: unknown[] = []): T {
  const view = useView();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => fn(view), [view, ...deps]);
}
