import { EventEmitter } from 'node:events';
import { OpEnvelopeSchema, executeOp, type Activity, type Op, type OpResult, type Role } from '@homeos/shared';
import type { Db } from './db';
import { SqlStore } from './sqlStore';

/** Diffusion des changements aux appareils connectés (SSE). */
export class Bus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(1000);
  }
  changed(householdId: string, seq: number) {
    this.emit(`hh:${householdId}`, seq);
  }
}

class Rollback extends Error {
  constructor(public result: OpResult) {
    super('rollback');
  }
}

export interface PushContext {
  householdId: string;
  userId: string;
  role: Role;
  timezone: string;
}

export interface PushOutcome {
  results: OpResult[];
  applied: number;
  important: Activity[];
  /** Erreur transitoire : les opérations suivantes ne sont pas traitées (à renvoyer). */
  interrupted: boolean;
}

const TRANSIENT = new Set(['SQLITE_BUSY', 'SQLITE_LOCKED', 'SQLITE_IOERR', 'SQLITE_FULL']);

function storedResult(db: Db, opId: string): { householdId: string; result: OpResult } | null {
  const r = db.prep('SELECT householdId, result FROM processed_ops WHERE opId = ?').get(opId) as { householdId: string; result: string } | undefined;
  return r ? { householdId: r.householdId, result: JSON.parse(r.result) } : null;
}

function record(db: Db, op: Op, ctx: PushContext, result: OpResult, now: string) {
  db.prep('INSERT INTO processed_ops(opId, householdId, userId, type, result, at) VALUES (?, ?, ?, ?, ?, ?)').run(
    op.opId, ctx.householdId, ctx.userId, op.type, JSON.stringify(result), now,
  );
}

/**
 * Applique une série d'opérations, chacune dans sa propre transaction, de façon
 * idempotente : le résultat est enregistré atomiquement avec les écritures, et un
 * renvoi de la même opération renvoie le résultat mémorisé sans la ré-appliquer.
 */
export function pushOps(db: Db, rawOps: unknown[], ctx: PushContext, log?: (e: unknown) => void): PushOutcome {
  const out: PushOutcome = { results: [], applied: 0, important: [], interrupted: false };
  for (const raw of rawOps) {
    const env = OpEnvelopeSchema.safeParse(raw);
    if (!env.success) {
      const opId = (raw as { opId?: unknown })?.opId;
      out.results.push({
        opId: typeof opId === 'string' ? opId : '?',
        status: 'rejected',
        warnings: [],
        conflicts: [],
        error: { code: 'invalid', message: 'Opération mal formée.' },
      });
      continue;
    }
    const op = env.data as Op;
    const prev = storedResult(db, op.opId);
    if (prev) {
      out.results.push(
        prev.householdId === ctx.householdId
          ? prev.result
          : { opId: op.opId, status: 'rejected', warnings: [], conflicts: [], error: { code: 'op_conflict', message: 'Identifiant d’opération déjà utilisé.' } },
      );
      continue;
    }
    const now = new Date().toISOString();
    try {
      const res = db.tx(() => {
        const store = new SqlStore(db, ctx.householdId, ctx.userId);
        const { result, rollback } = executeOp(store, op, { householdId: ctx.householdId, userId: ctx.userId, role: ctx.role, now, timezone: ctx.timezone });
        if (rollback) throw new Rollback(result);
        record(db, op, ctx, result, now);
        const acts = store.list('activity', { opId: op.opId }).filter((a) => a.important);
        out.important.push(...acts);
        return result;
      });
      out.results.push(res);
      out.applied++;
    } catch (e) {
      if (e instanceof Rollback) {
        db.tx(() => record(db, op, ctx, e.result, now));
        out.results.push(e.result);
        continue;
      }
      const code = (e as { code?: string }).code ?? '';
      if (TRANSIENT.has(code) || code.startsWith('SQLITE_IOERR')) {
        log?.(e);
        out.interrupted = true;
        break;
      }
      // Erreur déterministe (contrainte SQL, bogue) : rejet mémorisé, jamais d'application partielle.
      log?.(e);
      const result: OpResult = {
        opId: op.opId,
        status: 'rejected',
        warnings: [],
        conflicts: [],
        error: { code: 'internal', message: 'Opération refusée par le contrôle d’intégrité du serveur.' },
      };
      try {
        db.tx(() => record(db, op, ctx, result, now));
      } catch {
        /* déjà enregistrée */
      }
      out.results.push(result);
    }
  }
  return out;
}
