import { rmSync } from 'node:fs';

/** Données de test neuves à chaque exécution. */
export default function globalSetup() {
  rmSync('e2e/.data', { recursive: true, force: true });
}
