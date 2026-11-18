#!/bin/bash
# HOMEOS — mise à jour : récupère la dernière version sur GitHub et reconstruit si elle a changé.
# Les données (dossier data/) ne sont jamais touchées ; une sauvegarde est faite avant.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"
before=$(git rev-parse HEAD)
git pull --ff-only --quiet
after=$(git rev-parse HEAD)
if [ "$before" = "$after" ] && [ "${1:-}" != "--forcer" ]; then echo "$(date -Is) : déjà à jour ($after)"; exit 0; fi
docker exec homeos node server/cli.js sauvegarde || true
cd deploy && docker compose -f compose.server.yml up -d --build
docker image prune -f >/dev/null
echo "$(date -Is) : mis à jour vers $after"
