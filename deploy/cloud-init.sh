#!/bin/bash
# =============================================================================
#  HOMEOS - installation automatique d'un serveur (Ubuntu 22.04 / 24.04)
#  A coller dans la case cloud-init a la creation de la machine (Oracle Cloud).
#  Une seule ligne a modifier : la cle Tailscale ci-dessous.
# =============================================================================
TAILSCALE_AUTHKEY="COLLEZ-ICI-VOTRE-CLE-TAILSCALE"
HOMEOS_REPO="https://github.com/LeSaintEsprit/homeos"
HOMEOS_DIR="/opt/homeos"
MACHINE_NAME="homeos"
# -----------------------------------------------------------------------------
set -uo pipefail
exec > >(tee -a /var/log/homeos-installation.log) 2>&1
echo "=== HOMEOS : debut de l'installation $(date -Is) ==="
fail() { echo "ECHEC : $*"; echo "=== HOMEOS : installation interrompue ==="; exit 1; }

# 1. Memoire d'appoint (2 Go) : la construction de l'application en a besoin sur les petites machines.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile \
    && echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# 2. Outils de base, Docker et Tailscale (sources officielles).
export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get install -y git curl ca-certificates python3 || fail "installation des outils de base"
command -v docker >/dev/null || { curl -fsSL https://get.docker.com | sh || fail "installation de Docker"; }
command -v tailscale >/dev/null || { curl -fsSL https://tailscale.com/install.sh | sh || fail "installation de Tailscale"; }
systemctl enable --now docker

# 3. Code de HOMEOS.
if [ -d "$HOMEOS_DIR/.git" ]; then git -C "$HOMEOS_DIR" pull --ff-only; else git clone --depth 1 "$HOMEOS_REPO" "$HOMEOS_DIR" || fail "telechargement du code"; fi

# 4. Connexion a Tailscale et adresse publique https://homeos.<votre-reseau>.ts.net
tailscale up --authkey="$TAILSCALE_AUTHKEY" --hostname="$MACHINE_NAME" || fail "connexion a Tailscale (cle invalide ou expiree ?)"
DOMAIN=""
for i in $(seq 1 30); do
  DOMAIN=$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))' 2>/dev/null)
  [ -n "$DOMAIN" ] && break; sleep 2
done
[ -n "$DOMAIN" ] || fail "adresse Tailscale introuvable (MagicDNS active ?)"
printf 'HOMEOS_PUBLIC_URL=https://%s\n' "$DOMAIN" > "$HOMEOS_DIR/deploy/.env"

# 5. Construction et demarrage (redemarre seul apres une coupure).
cd "$HOMEOS_DIR/deploy" && docker compose -f compose.server.yml up -d --build || fail "construction ou demarrage de HOMEOS"
for i in $(seq 1 60); do curl -fsS http://127.0.0.1:8080/api/health >/dev/null 2>&1 && break; sleep 2; done
curl -fsS http://127.0.0.1:8080/api/health >/dev/null || fail "HOMEOS ne repond pas"

# 6. Taches automatiques :
#    - publication HTTPS (Tailscale Funnel) retentee toutes les 10 minutes tant qu'elle n'est pas active
#      (utile si HTTPS ou Funnel n'etaient pas encore actives dans la console Tailscale) ;
#    - mise a jour chaque nuit (code de GitHub + reconstruction ; les donnees ne sont pas touchees).
cat > /etc/cron.d/homeos <<CRON
*/10 * * * * root /usr/bin/tailscale funnel --bg 8080 >> /var/log/homeos-funnel.log 2>&1
30 4 * * * root bash $HOMEOS_DIR/deploy/mise-a-jour.sh >> /var/log/homeos-mise-a-jour.log 2>&1
CRON

# 7. Publication en HTTPS (https://homeos.<votre-reseau>.ts.net).
if tailscale funnel --bg 8080; then
  echo "=== HOMEOS est en ligne : https://$DOMAIN ==="
else
  echo "ATTENTION : publication HTTPS refusee pour l'instant. Activez 'HTTPS' (page DNS) et 'Funnel' (page Access controls)"
  echo "dans la console Tailscale : elle sera retentee automatiquement toutes les 10 minutes."
  echo "=== HOMEOS fonctionne ; adresse prevue : https://$DOMAIN ==="
fi
