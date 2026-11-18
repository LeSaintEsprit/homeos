#!/bin/bash
# =============================================================================
#  HOMEOS - creation automatique de la machine gratuite Oracle Cloud
#  A lancer dans Oracle Cloud Shell (console Oracle > icone Developer tools > Cloud Shell) :
#    bash <(curl -fsSL https://raw.githubusercontent.com/LeSaintEsprit/homeos/main/deploy/oracle-creer-machine.sh)
#  Reessaie toutes les 2 minutes tant qu'Oracle n'a pas de place (Ampere gratuit, puis AMD gratuit).
#  Prerequis : le reseau "homeos-reseau" (assistant "Create VCN with Internet Connectivity").
# =============================================================================
set -uo pipefail
T="${OCI_TENANCY:-}"
[ -n "$T" ] || { echo "Ce script doit etre lance dans Oracle Cloud Shell."; exit 1; }
NAME="homeos"
LOG=/tmp/homeos-lancement.log
CI=/tmp/homeos-cloud-init.sh

# Lecture d'une liste JSON renvoyee par la CLI (vide si aucun resultat).
pyjson() { python3 -c "import json,sys; t=sys.stdin.read().strip(); d=json.loads(t)['data'] if t else []; $1"; }

echo "== HOMEOS : verification =="
deja=$(oci compute instance list -c "$T" --display-name "$NAME" --all 2>/dev/null \
  | pyjson "print(sum(1 for i in d if i['lifecycle-state'] not in ('TERMINATED','TERMINATING')))")
if [ "${deja:-0}" != "0" ]; then echo "Une machine \"$NAME\" existe deja : rien a faire."; exit 0; fi

VCN=$(oci network vcn list -c "$T" --display-name homeos-reseau --all 2>/dev/null | pyjson "print(d[0]['id'] if d else '')")
[ -n "$VCN" ] || { echo "Reseau \"homeos-reseau\" introuvable : creez-le d'abord (Networking > Virtual cloud networks > Start VCN Wizard)."; exit 1; }
SUBNET=$(oci network subnet list -c "$T" --vcn-id "$VCN" --all 2>/dev/null \
  | pyjson "p=[s['id'] for s in d if not s.get('prohibit-public-ip-on-vnic')]; print(p[0] if p else '')")
[ -n "$SUBNET" ] || { echo "Sous-reseau public introuvable dans homeos-reseau."; exit 1; }
AD=$(oci iam availability-domain list -c "$T" 2>/dev/null | pyjson "print(d[0]['name'] if d else '')")
image() {
  oci compute image list -c "$T" --operating-system "Canonical Ubuntu" --operating-system-version "24.04" \
    --shape "$1" --sort-by TIMECREATED --sort-order DESC --all 2>/dev/null | pyjson "print(d[0]['id'] if d else '')"
}
IMG_ARM=$(image VM.Standard.A1.Flex)
IMG_AMD=$(image VM.Standard.E2.1.Micro)
[ -n "$IMG_ARM$IMG_AMD" ] || { echo "Image Ubuntu 24.04 introuvable."; exit 1; }

echo
read -r -s -p "Collez votre cle Tailscale (elle commence par tskey-auth-) puis appuyez sur Entree : " KEY; echo
case "$KEY" in tskey-auth-*) ;; *) echo "Ce n'est pas une cle Tailscale valide."; exit 1 ;; esac
curl -fsSL https://raw.githubusercontent.com/LeSaintEsprit/homeos/main/deploy/cloud-init.sh -o "$CI" || { echo "Telechargement impossible."; exit 1; }
sed -i "s|COLLEZ-ICI-VOTRE-CLE-TAILSCALE|$KEY|" "$CI"
grep -q 'TAILSCALE_AUTHKEY="tskey-auth-' "$CI" || { echo "Insertion de la cle impossible."; exit 1; }
# Cle SSH de depannage (RSA : Cloud Shell, en mode FIPS, refuse les cles ED25519).
if [ ! -f ~/.ssh/homeos.pub ]; then
  rm -f ~/.ssh/homeos
  ssh-keygen -q -t rsa -b 4096 -N "" -f ~/.ssh/homeos || { echo "Creation de la cle SSH impossible."; rm -f "$CI"; exit 1; }
fi

lancer() { # $1 forme, $2 image, $3 configuration (facultative)
  [ -n "$2" ] || return 1
  # --no-retry : reponse immediate (sinon la CLI reessaie en silence jusqu a 10 minutes) ; la boucle ci-dessous gere les essais.
  local args=(--no-retry compute instance launch -c "$T" --availability-domain "$AD" --shape "$1" --image-id "$2"
    --subnet-id "$SUBNET" --assign-public-ip true --display-name "$NAME"
    --ssh-authorized-keys-file "$HOME/.ssh/homeos.pub" --user-data-file "$CI")
  [ -n "${3:-}" ] && args+=(--shape-config "$3")
  oci "${args[@]}" > "$LOG" 2>&1
}
reessayable() { grep -qiE "capacity|TooManyRequests|InternalError" "$LOG"; }

echo
echo "== Creation de la machine (laissez cette fenetre ouverte) =="
n=0
while true; do
  n=$((n + 1))
  echo "$(date +%H:%M) - essai $n : modele Ampere (1 OCPU, 6 Go)..."
  if lancer VM.Standard.A1.Flex "$IMG_ARM" '{"ocpus": 1, "memoryInGBs": 6}'; then echo "Machine Ampere creee."; break; fi
  reessayable || { echo "Erreur inattendue :"; cat "$LOG"; rm -f "$CI"; exit 1; }
  echo "        pas de place. Modele AMD (VM.Standard.E2.1.Micro)..."
  if lancer VM.Standard.E2.1.Micro "$IMG_AMD"; then echo "Machine AMD creee."; break; fi
  reessayable || { echo "Erreur inattendue :"; cat "$LOG"; rm -f "$CI"; exit 1; }
  echo "        pas de place non plus. Nouvel essai dans 2 minutes."
  sleep 120
done
rm -f "$CI"
echo
echo "== C'est parti ! HOMEOS s'installe tout seul sur la machine (20 a 40 minutes). =="
echo "Ensuite : la machine \"homeos\" apparait sur login.tailscale.com/admin/machines,"
echo "et l'application s'ouvre a l'adresse https://homeos.<nom-de-votre-reseau>.ts.net"
