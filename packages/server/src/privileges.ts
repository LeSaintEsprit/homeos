/**
 * Image Docker : le serveur et l'outil d'administration ne tournent jamais en root.
 * Une commande lancée par `docker exec` (root par défaut) abandonne ses droits avant d'ouvrir la base :
 * un fichier créé par root (journal SQLite, sauvegarde) empêcherait ensuite le serveur de l'ouvrir.
 */
export function dropRootPrivileges(): void {
  const user = process.env.HOMEOS_RUN_AS;
  if (!user || typeof process.getuid !== 'function' || process.getuid() !== 0) return;
  process.setgid!(user);
  process.setuid!(user);
}
