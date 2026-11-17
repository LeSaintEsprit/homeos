import type { EntityMap, EntityType, Role } from '../types';

/**
 * Accès aux données d'UN foyer. Implémenté :
 *  - côté serveur par SQLite (dans une transaction, filtré par householdId) ;
 *  - côté client par une surcouche en mémoire (prédiction optimiste).
 */
export interface DataStore {
  get<K extends EntityType>(type: K, id: string): EntityMap[K] | undefined;
  /** Liste les entités dont les champs valent exactement ceux de `where`. */
  list<K extends EntityType>(type: K, where?: Partial<Record<keyof EntityMap[K], unknown>>): EntityMap[K][];
  /**
   * Écrit une entité. Le magasin attribue la version et, pour chaque champ de
   * `touched`, enregistre la version par champ (détection des conflits).
   */
  put<K extends EntityType>(type: K, entity: EntityMap[K], touched?: string[]): EntityMap[K];
  remove(type: EntityType, id: string): void;
  resolveAlias(type: EntityType, id: string): string;
  addAlias(type: EntityType, fromId: string, toId: string): void;
}

export interface Notice {
  code: string;
  message: string;
}

export interface FieldConflict {
  entityType: EntityType;
  entityId: string;
  field: string;
  label: string;
  /** Valeur vue par l'utilisateur au moment de la modification (si connue). */
  base?: unknown;
  mine: unknown;
  theirs: unknown;
  theirsBy?: string | null;
}

export type OpStatus = 'applied' | 'conflict' | 'rejected';

export interface OpResult {
  opId: string;
  status: OpStatus;
  warnings: Notice[];
  conflicts: FieldConflict[];
  error?: Notice;
  /** Redirections d'identifiants (ex. article fusionné dans un autre). */
  aliases?: { type: EntityType; from: string; to: string }[];
}

export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export interface ExecEnv {
  householdId: string;
  userId: string;
  role: Role;
  /** Instant d'application (heure serveur côté serveur). */
  now: string;
  timezone: string;
}
