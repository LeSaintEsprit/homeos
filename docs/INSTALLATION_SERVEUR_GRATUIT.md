# Mettre HOMEOS en ligne gratuitement (Oracle Cloud + Tailscale)

Durée : environ 30 minutes, sur un ordinateur (plus confortable que le téléphone).
Coût : 0 €. Il faut deux comptes gratuits : **Tailscale** (l'adresse sécurisée `https://`) et **Oracle Cloud** (la machine toujours allumée).
Ensuite, tout s'installe tout seul.

> Les noms des boutons peuvent varier légèrement (français ou anglais selon la langue du site).

---

## Est-ce vraiment gratuit ?

Oui, si vous restez dans les offres gratuites :
- **Tailscale** : offre « Personal », gratuite pour un usage personnel.
- **Oracle Cloud** : offre **« Always Free »**, gratuite sans limite de durée. La carte bancaire sert à vérifier votre identité ; une petite somme peut être réservée puis rendue aussitôt.
  - Pour rester à 0 € : choisissez uniquement des éléments marqués **« Always Free-eligible »**, et ne cliquez **jamais** sur « Upgrade » / « Passer au paiement à l'utilisation ».
  - À la création, Oracle offre aussi un **essai de 30 jours** avec des crédits. À la fin, le compte redevient simplement gratuit : rien n'est prélevé tant que vous n'avez pas demandé le passage au paiement.
  - Oracle peut **arrêter** une machine gratuite jugée trop peu utilisée. Elle se relance alors depuis la console (bouton **Start**) et les données restent sur son disque. Par prudence, téléchargez de temps en temps une sauvegarde (Administration du serveur → Sauvegardes → Télécharger).

## Partie A — Tailscale (5 minutes)

1. Allez sur **login.tailscale.com** et choisissez **« Sign in with GitHub »** (votre compte GitHub suffit).
2. Si on vous demande à quoi servira Tailscale, choisissez un usage **personnel**. Si on vous propose d'installer Tailscale sur un appareil, passez cette étape (« Skip »).
3. Ouvrez **login.tailscale.com/admin/dns** :
   - si **MagicDNS** n'est pas activé, cliquez sur **« Enable MagicDNS »** ;
   - plus bas, dans **« HTTPS Certificates »**, cliquez sur **« Enable HTTPS »** et confirmez.
4. Ouvrez **login.tailscale.com/admin/acls** : dans la section **« Funnel »**, cliquez sur **« Add Funnel to policy »**.
5. Ouvrez **login.tailscale.com/admin/settings/keys** : cliquez sur **« Generate auth key… »**, laissez les options par défaut, puis **« Generate key »**.
   **Copiez la clé** (elle commence par `tskey-auth-`). Gardez-la pour la partie B. **Ne la donnez à personne**, pas même dans une conversation.

## Partie B — Oracle Cloud (15 minutes + 20 minutes d'attente)

1. Allez sur **signup.cloud.oracle.com** et créez le compte gratuit :
   - pays : France ;
   - **région d'origine (« Home Region ») : France Central (Paris)** ou France South (Marseille). Elle ne peut plus être changée ensuite ;
   - une carte bancaire est demandée pour vérifier votre identité. L'offre « Always Free » n'est pas facturée.
2. Une fois dans la console : menu **☰ → Compute (Calcul) → Instances → « Create instance » (Créer une instance)**.
3. **Name** : `homeos`.
4. **Image and shape** :
   - **Image** : « Edit » → **Ubuntu** → *Canonical Ubuntu 24.04* ;
   - **Shape** : **Ampere → VM.Standard.A1.Flex**, **1 OCPU, 6 Go**. La mention *Always Free-eligible* doit apparaître.
   - Si Oracle répond « Out of capacity » (pas de machine disponible), choisissez **AMD → VM.Standard.E2.1.Micro** (également gratuite), ou réessayez plus tard.
5. **Networking** : ne changez rien (une adresse publique est créée).
6. **SSH keys** : cliquez sur **« Save private key »** et gardez le fichier. Il ne sert qu'en cas de dépannage.
7. Tout en bas, **« Show advanced options » → onglet « Management » → « Paste cloud-init script »** :
   - ouvrez **github.com/LeSaintEsprit/homeos/blob/main/deploy/cloud-init.sh**, cliquez sur l'icône **« Copy raw file »** et collez le tout dans la case ;
   - dans la case, remplacez `COLLEZ-ICI-VOTRE-CLE-TAILSCALE` par votre clé Tailscale (en gardant les guillemets).
8. Cliquez sur **« Create »**. La machine démarre, puis HOMEOS s'installe tout seul (**15 à 20 minutes**).

## Partie C — Ouvrir HOMEOS

1. Ouvrez **login.tailscale.com/admin/machines** : la machine **homeos** apparaît (« Connected ») après quelques minutes.
2. L'adresse de votre application est **`https://homeos.<nom-de-votre-réseau>.ts.net`**. Le nom de votre réseau est affiché sur **login.tailscale.com/admin/dns** (« Tailnet name »).
3. Ouvrez cette adresse sur l'iPhone (Safari) **20 minutes après la création** :
   - **« Créer mon compte »** : le premier compte devient l'administrateur ;
   - créez votre foyer ;
   - **Partager → « Sur l'écran d'accueil »** pour installer l'application (indispensable pour les notifications sur iPhone).
4. Invitez la famille : **Famille → Inviter un membre**. Ils n'ont besoin de rien d'autre que l'adresse et le lien d'invitation (pas de Tailscale sur leur téléphone).

## Ensuite

- **Mises à jour** : chaque nuit, le serveur récupère automatiquement la dernière version publiée sur GitHub. Vos données ne sont pas touchées, et une sauvegarde est faite avant.
- **Sauvegardes** : automatiques chaque jour sur le serveur (Administration du serveur → Sauvegardes, téléchargeables).

## En cas de problème

- **La machine n'apparaît pas dans Tailscale après 30 minutes** : la clé était peut-être mal collée. Dans Oracle, **Terminate** la machine, générez une nouvelle clé (partie A, étape 5) et recommencez la partie B.
- **La machine apparaît, mais l'adresse ne répond pas** : vérifiez la partie A, étapes 3 et 4 (HTTPS et Funnel). Pas besoin de recommencer : le serveur réessaie tout seul toutes les 10 minutes.
- Le journal d'installation se trouve sur la machine : `/var/log/homeos-installation.log`.
