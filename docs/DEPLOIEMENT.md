# HOMEOS — Installer et héberger gratuitement

Ce guide s'adresse à la personne qui héberge HOMEOS pour sa famille (et éventuellement d'autres familles).
Aucun abonnement n'est nécessaire : un ordinateur toujours allumé à la maison suffit.

---

## 1. Ce qu'il faut

| Élément | Exemples | Coût |
|---|---|---|
| Une machine allumée en permanence | Raspberry Pi 4 ou 5, NAS Synology/QNAP compatible Docker, vieux PC ou portable sous Linux | Matériel existant |
| Docker et Docker Compose | `curl -fsSL https://get.docker.com \| sh` sur Debian/Ubuntu/Raspberry Pi OS | Gratuit |
| Un accès sécurisé depuis l'extérieur (HTTPS) | Tailscale (recommandé), ou Cloudflare Tunnel avec votre domaine | Gratuit (Tailscale) |

**Pourquoi HTTPS est indispensable** : sur iPhone et Android, la caméra (scanner), l'installation de l'application sur l'écran d'accueil et les notifications ne fonctionnent qu'avec une adresse en `https://`.

Ressources consommées : environ 120 Mo de mémoire pour le serveur ; l'application elle-même occupe 19 Mo (dont le moteur de lecture de texte, chargé seulement quand on s'en sert).

---

## 2. Installation (Docker)

```bash
git clone <adresse-du-dépôt> homeos
cd homeos
docker compose up -d --build
```

- La première construction prend quelques minutes (davantage sur un Raspberry Pi).
- Si Docker Hub refuse le téléchargement des images de base (« 429 Too Many Requests »), utilisez le miroir public de Google : décommentez la ligne `args: { REGISTRY: "mirror.gcr.io/library/" }` dans `docker-compose.yml`, puis relancez `docker compose up -d --build`.
- Toutes les données sont dans le dossier `./data` : la base `homeos.db` (photos comprises), les sauvegardes `backups/` et les clés des notifications `vapid.json`. **C'est le seul dossier à protéger.**

Vérifiez que tout fonctionne :

```bash
curl http://localhost:8080/api/health
```

La réponse contient `"ok":true`.

### Premier compte = hébergeur

Ouvrez HOMEOS (voir l'accès sécurisé ci-dessous) et créez votre compte : **le premier compte créé devient administrateur du serveur**.
Il voit la rubrique **Administration du serveur** (comptes, sauvegardes, liens de réinitialisation de mot de passe).
Ensuite, avec le réglage par défaut, **personne ne peut s'inscrire sans invitation**.

---

## 3. Réglages (fichier `docker-compose.yml`)

| Variable | Rôle | Valeur conseillée |
|---|---|---|
| `HOMEOS_PUBLIC_URL` | Adresse publique, utilisée dans les liens d'invitation et de réinitialisation | `https://maison.votre-reseau.ts.net` |
| `HOMEOS_REGISTRATION` | `invite` : invitation obligatoire (sauf premier compte) · `open` : inscription libre · `closed` : aucune inscription | `invite` |
| `HOMEOS_TRUST_PROXY` | Faire confiance au relais HTTPS (Tailscale, Cloudflare, Caddy) pour l'adresse et le protocole | `1` |
| `HOMEOS_COOKIE_SECURE` | `1` : cookies de session uniquement en HTTPS (à mettre une fois l'accès HTTPS en place) | `1` |
| `HOMEOS_SMTP_URL`, `HOMEOS_MAIL_FROM` | Facultatif : envoi des invitations et des « mot de passe oublié » avec **votre propre** boîte e-mail | — |
| `HOMEOS_BACKUP_KEEP_DAILY` / `_MONTHLY` | Nombre de sauvegardes conservées | `14` / `12` |
| `HOMEOS_VAPID_SUBJECT` | Contact technique transmis aux services de notification des navigateurs | `mailto:vous@exemple.fr` |
| `HOMEOS_OFF_DISABLED` | `1` : ne jamais interroger Open Food Facts (fiches produits) | vide |
| `HOMEOS_LOG_REQUESTS` | `1` : journaliser chaque requête (diagnostic) ; par défaut seuls le démarrage, les avertissements et les erreurs sont journalisés | vide |

Sans `HOMEOS_SMTP_URL`, rien n'est perdu : les invitations se partagent par lien ou code, et l'hébergeur génère les liens « mot de passe oublié » depuis l'administration.

Si votre serveur ne peut sortir sur Internet que par un proxy HTTP (entreprise, école), ajoutez `NODE_USE_ENV_PROXY: "1"` et `HTTPS_PROXY: "http://proxy:port"` : la recherche des fiches produits passera par ce proxy.

Après chaque modification : `docker compose up -d`.

---

## 4. Accès depuis l'extérieur, en HTTPS, sans rien payer

### Option A — Tailscale, réseau privé (recommandé pour une famille)

Seuls les appareils de votre réseau privé voient HOMEOS : rien n'est exposé sur Internet.

1. Créez un compte gratuit sur tailscale.com (offre « Personal », usage non commercial ; vérifiez les limites actuelles d'utilisateurs sur la page des tarifs).
2. Installez Tailscale sur le serveur : `curl -fsSL https://tailscale.com/install.sh | sh` puis `sudo tailscale up`.
3. Dans la console Tailscale, activez **MagicDNS** et **HTTPS Certificates** (page DNS).
4. Publiez HOMEOS en HTTPS dans votre réseau privé :
   ```bash
   sudo tailscale serve --bg 8080
   ```
   L'adresse affichée ressemble à `https://serveur.nom-du-reseau.ts.net` : mettez-la dans `HOMEOS_PUBLIC_URL`.
5. Chaque membre de la famille installe l'application Tailscale sur son téléphone (App Store / Play Store) et rejoint votre réseau (invitation depuis la console Tailscale).

Pour que HOMEOS ne soit pas joignable en clair sur le réseau local, limitez le port à la machine elle-même dans `docker-compose.yml` : `"127.0.0.1:8080:8080"`.

### Option B — Tailscale Funnel, adresse publique sans nom de domaine

Pour inviter d'autres familles sans leur faire installer Tailscale :

```bash
sudo tailscale funnel --bg 8080
```

HOMEOS devient accessible publiquement à `https://serveur.nom-du-reseau.ts.net` (certificat valide). L'accès reste protégé par les comptes HOMEOS, l'inscription sur invitation et la limitation des tentatives de connexion. Pensez à `HOMEOS_COOKIE_SECURE=1`.

### Option C — Cloudflare Tunnel avec votre propre nom de domaine

Le tunnel est gratuit, mais **il faut un nom de domaine géré par Cloudflare** (environ 10 € par an — ce n'est donc pas une solution à 0 €).
Les « tunnels rapides » `trycloudflare.com` ne conviennent pas : adresse qui change à chaque redémarrage et **pas de temps réel** (les événements serveur ne passent pas ; HOMEOS se rabat alors sur une actualisation toutes les 60 s).

```bash
cloudflared tunnel login
cloudflared tunnel create homeos
cloudflared tunnel route dns homeos homeos.votre-domaine.fr
cloudflared tunnel run --url http://localhost:8080 homeos
```

### Accès local seulement (essais)

`http://adresse-du-serveur:8080` fonctionne sur le réseau de la maison, **sans caméra, ni installation, ni notifications** sur téléphone (HTTPS absent). À réserver aux essais.

---

## 5. Sauvegardes

HOMEOS sauvegarde **automatiquement chaque jour** (14 quotidiennes + 12 mensuelles, chacune vérifiée) dans `./data/backups`, ainsi qu'avant chaque import, restauration ou suppression de foyer.
Une sauvegarde sur la même machine ne protège pas d'une panne de disque : **copiez-les ailleurs**.

Copie quotidienne vers un disque USB (ajoutez la ligne avec `crontab -e`) :

```
30 3 * * * rsync -a /chemin/vers/homeos/data/backups /chemin/vers/homeos/data/vapid.json /media/disque-usb/homeos/
```

Autres solutions gratuites : Syncthing vers un autre ordinateur de la maison, ou `rclone` vers un stockage en ligne que vous possédez déjà.

Sauvegarde manuelle immédiate :

```bash
docker compose exec homeos node server/cli.js sauvegarde
```

### Restaurer

- **Un foyer** (erreur de manipulation) : un administrateur du foyer, dans Paramètres › Données › « Revenir à une version précédente ». Les données sont recréées dans un **nouveau foyer**, l'original reste intact.
- **Un foyer supprimé** : l'hébergeur, dans Administration › Sauvegardes › « Foyers… » ; les autres familles ne sont pas touchées.
- **Tout le serveur** : Administration › Sauvegardes › « Tout restaurer » (une sauvegarde de l'état actuel est faite avant). Les appareils se resynchronisent seuls.
- **Machine perdue** : réinstallez HOMEOS, arrêtez-le (`docker compose down`), copiez la dernière sauvegarde (fichier `.db` de `backups/`) en `./data/homeos.db` et `vapid.json` dans `./data/`, puis redémarrez (`docker compose up -d`). Sans `vapid.json`, tout fonctionne mais chaque membre doit réactiver les notifications.

---

## 6. Mettre à jour

```bash
cd homeos
docker compose exec homeos node server/cli.js sauvegarde
git pull
docker compose up -d --build
```

La base de données est complétée automatiquement au démarrage ; un serveur plus ancien refuse d'ouvrir une base plus récente (pas de retour en arrière accidentel). Sur les appareils, un message « Une nouvelle version de HOMEOS est disponible » propose « Mettre à jour » : rien n'est perdu, les modifications en attente sont conservées.

---

## 7. Commandes utiles

```bash
docker compose logs -f homeos                                              # journal du serveur
docker compose exec homeos node server/cli.js utilisateurs                 # liste des comptes
docker compose exec homeos node server/cli.js lien-reinitialisation adresse@exemple.fr   # lien « mot de passe oublié »
docker compose exec homeos node server/cli.js sauvegarde                   # sauvegarde immédiate
```

---

## 8. Sans Docker (Node.js 22)

```bash
npm ci
npm run build
HOMEOS_DATA_DIR=./data HOMEOS_WEB_DIR=packages/web/dist npm start
```

Pour un démarrage automatique, créez un service systemd qui lance ces commandes.

---

## 9. Confidentialité

L'hébergeur a techniquement accès aux fichiers du serveur, donc aux données des foyers hébergés (comme tout service non chiffré de bout en bout). Dites-le aux familles que vous invitez ; une famille qui le souhaite peut héberger sa propre instance avec ce guide.

---

## 10. Licences

HOMEOS n'utilise que des composants libres et gratuits. Pour le vérifier : `node scripts/check-licenses.mjs`.
