import type { DataStore, ExecEnv, OpResult } from './context';
import { DomainError } from './context';
import { OP_SCHEMAS, type Op, type OpType } from './schemas';
import { HANDLERS, buildActivity, type Ctx } from './handlers';
import { clampClientTime, dateInTz } from '../time';
import { can, PERMISSION_LABELS } from '../types';
import { OP_PERMISSIONS } from './permissions';

export interface ExecOutcome {
  result: OpResult;
  /** true si les écritures doivent être annulées (opération rejetée). */
  rollback: boolean;
}

/**
 * Exécute une opération sur un magasin de données. Fonction PURE vis-à-vis du
 * stockage : l'appelant fournit la transaction (SQLite côté serveur, surcouche
 * mémoire côté client) et l'annule si `rollback` vaut true.
 */
export function executeOp(store: DataStore, op: Op, env: ExecEnv): ExecOutcome {
  const base = { opId: op.opId, warnings: [], conflicts: [] };
  const handler = HANDLERS[op.type as OpType] as ((ctx: Ctx, p: unknown) => void) | undefined;
  const schema = OP_SCHEMAS[op.type as OpType];
  if (!handler || !schema) {
    return { result: { ...base, status: 'rejected', error: { code: 'unknown_op', message: `Opération inconnue : ${op.type}` } }, rollback: true };
  }
  const parsed = schema.safeParse(op.payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path?.length ? ` (${issue.path.join('.')})` : '';
    return {
      result: { ...base, status: 'rejected', error: { code: 'invalid', message: `${issue?.message ?? 'Données invalides'}${where}` } },
      rollback: true,
    };
  }
  const perm = OP_PERMISSIONS[op.type];
  if (!perm || !can(env.role, perm)) {
    const message =
      env.role === 'viewer'
        ? 'Votre rôle (lecture seule) ne permet pas de modifier les données.'
        : `Action non autorisée pour votre rôle : ${PERMISSION_LABELS[perm] ?? op.type}.`;
    return { result: { ...base, status: 'rejected', error: { code: 'forbidden', message } }, rollback: true };
  }
  const occurredAt = clampClientTime(op.clientTime, env.now);
  const ctx: Ctx = {
    ...env,
    store,
    opId: op.opId,
    opType: op.type,
    occurredAt,
    today: dateInTz(occurredAt, env.timezone),
    warnings: [],
    conflicts: [],
    aliases: [],
    logs: [],
    counter: 0,
    writes: 0,
  };
  try {
    handler(ctx, parsed.data);
  } catch (e) {
    if (e instanceof DomainError) {
      return { result: { ...base, status: 'rejected', error: { code: e.code, message: e.message } }, rollback: true };
    }
    throw e;
  }
  const changed = ctx.writes > 0;
  if (changed) ctx.logs.forEach((entry, i) => store.put('activity', buildActivity(ctx, entry, i)));
  const status = ctx.conflicts.length > 0 && !changed ? 'conflict' : 'applied';
  const result: OpResult = { opId: op.opId, status, warnings: ctx.warnings, conflicts: ctx.conflicts };
  if (ctx.aliases.length) result.aliases = ctx.aliases;
  return { result, rollback: false };
}
