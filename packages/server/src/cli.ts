/**
 * Outil d'administration en ligne de commande (sur la machine qui héberge HOMEOS).
 *   node dist/cli.js utilisateurs
 *   node dist/cli.js lien-reinitialisation <email>
 *   node dist/cli.js sauvegarde
 */
import { loadConfig } from './config';
import { Db } from './db';
import { createResetToken, listUsers } from './accounts';
import { BackupManager } from './backup';
import { dropRootPrivileges } from './privileges';

dropRootPrivileges();
const [cmd, arg] = process.argv.slice(2);
const config = loadConfig();
const db = new Db(config.dbPath);

async function main() {
  switch (cmd) {
    case 'utilisateurs': {
      for (const u of listUsers(db) as { email: string; name: string; isServerAdmin: boolean; households: number }[]) {
        console.log(`${u.email}\t${u.name}\t${u.households} foyer(s)${u.isServerAdmin ? '\tadministrateur du serveur' : ''}`);
      }
      break;
    }
    case 'lien-reinitialisation': {
      const u = db.prep('SELECT id FROM users WHERE email = ?').get((arg ?? '').toLowerCase()) as { id: string } | undefined;
      if (!u) throw new Error('Aucun compte avec cette adresse.');
      const { token, expiresAt } = createResetToken(db, u.id, 'cli');
      const base = config.publicUrl?.replace(/\/$/, '') ?? `http://localhost:${config.port}`;
      console.log(`Lien (valable jusqu'au ${new Date(expiresAt).toLocaleString('fr-FR')}, usage unique) :\n${base}/reinitialiser/${token}`);
      break;
    }
    case 'sauvegarde': {
      const b = await new BackupManager(db, config.backupDir).create('manual');
      console.log(`Sauvegarde ${b.name} créée et vérifiée (${(b.sizeBytes / 1024).toFixed(0)} Ko).`);
      break;
    }
    default:
      console.log('Commandes : utilisateurs | lien-reinitialisation <email> | sauvegarde');
  }
}

main()
  .catch((e) => {
    console.error(`Erreur : ${(e as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => db.close());
