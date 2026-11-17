import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { buildApp } from './app';
import { purgeProcessedOps } from './accounts';
import { loadConfig } from './config';

const here = dirname(fileURLToPath(import.meta.url));
const defaultWeb = [resolve(here, '../../web/dist'), resolve(here, '../web')].find((p) => existsSync(p)) ?? null;
const config = loadConfig(process.env, process.env.HOMEOS_WEB_DIR ? {} : { webDir: defaultWeb });
const { app, backups, push, db } = buildApp({ config });

async function backupIfDue() {
  const last = backups.lastAutoAt();
  if (!last || Date.now() - Date.parse(last) > 20 * 3_600_000) {
    try {
      const b = await backups.create('auto');
      app.log.info({ backup: b.name, verified: b.verified }, 'Sauvegarde automatique effectuée');
    } catch (e) {
      app.log.error(e, 'Échec de la sauvegarde automatique');
    }
  }
}

await app.listen({ port: config.port, host: config.host });
app.log.info(`HOMEOS démarré — données : ${config.dataDir}${config.webDir ? '' : ' (interface web non trouvée : lancez « npm run build »)'}`);

if (config.schedulers) {
  await backupIfDue();
  setInterval(backupIfDue, 3_600_000).unref();
  const purge = () => {
    const n = purgeProcessedOps(db, config.processedOpsDays);
    if (n) app.log.info(`${n} opérations anciennes purgées du journal d'idempotence`);
  };
  purge();
  setInterval(purge, 24 * 3_600_000).unref();
  const digest = () => push.runDigests().catch((e) => app.log.warn(e, 'Récapitulatifs push'));
  // Vérifie chaque quart d'heure ; l'anti-doublon garantit un seul envoi par jour et par membre.
  setInterval(digest, 15 * 60_000).unref();
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    app.log.info('Arrêt en cours…');
    await app.close();
    process.exit(0);
  });
}
