#!/bin/sh
# Démarrage de l'image HOMEOS : le dossier de données (souvent créé par Docker au nom de root
# lors de la première installation) est confié au compte « node », puis les droits root sont abandonnés.
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$HOMEOS_DATA_DIR"
  find "$HOMEOS_DATA_DIR" ! -user node -exec chown node:node {} +
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
