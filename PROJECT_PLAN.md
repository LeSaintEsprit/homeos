# HOMEOS — Plan de projet

> Organisation, état des lieux et étapes du développement.
> Exigences : `MASTER_SPEC.md` (référence). État de chaque fonctionnalité : `FEATURE_TRACKER.md`.
>
> Version 2.5 — 17/11/2026 — phases 1 à 5 terminées. (v2.0 : consolidation M1–M5 et audit du code.) (v1.0 : plan initial ; v1.1 : analyse d'impact du scanner et des enrichissements, intégrée à MASTER_SPEC.)

---

## 0. Documents de référence et processus

| Document | Rôle | Mis à jour quand |
|---|---|---|
| `MASTER_SPEC.md` | **Tout ce que HOMEOS doit faire** (vision, règles, architecture, sécurité, tests) | À chaque nouvelle demande ou précision |
| `FEATURE_TRACKER.md` | **État réel** de chaque fonctionnalité, couche par couche | À chaque fonctionnalité commencée, terminée ou vérifiée |
| `PROJECT_PLAN.md` | **Ordre, dépendances, critères de sortie** | Quand l'ordre ou le périmètre d'une phase change |

À chaque nouvelle demande : (1) identifier les exigences concernées ; (2) mettre à jour MASTER_SPEC ; (3) actualiser le tracker ; (4) actualiser ce plan si besoin ; (5) vérifier l'impact sur l'existant et consigner les contradictions (MASTER_SPEC §16). Une nouvelle demande ne remplace jamais automatiquement les précédentes.

---

## 1. État des lieux — audit du 17/11/2026

### 1.1 Méthode
- Relecture des **5 messages** du projet (M1 à M5) : **tous accessibles**, aucune instruction perdue (le redémarrage du processus de travail n'a pas effacé l'historique de la conversation).
- Inspection de l'arborescence et de chaque module ; relance des tests existants ; **premier démarrage réel du serveur** (test de fumée) ; **sondage d'isolation** entre deux foyers par accès API directs.
- Comparaison exigence par exigence avec MASTER_SPEC → résultats ligne par ligne dans FEATURE_TRACKER.

### 1.2 Inventaire du code
| Partie | Contenu | Taille | Vérification |
|---|---|---|---|
| `packages/shared` | Types, unités, temps, texte, identifiants, argent, valeurs par défaut, règles de lots/FEFO, inventaires, magasin mémoire à couches, schémas d'opérations (46 opérations), handlers, exécuteur, moteur, prix, statistiques, audit, notifications, GS1, OCR (analyse), fiches produits | ≈ 5 500 lignes | **76 tests verts** |
| `packages/server` | Schéma SQLite (15 tables métier + 11 tables serveur), magasin SQL filtré par foyer, comptes et sessions, foyers/invitations/rôles, synchronisation idempotente, SSE, sauvegardes vérifiées et restauration, export JSON/CSV, import, contrôle d'intégrité, proxy codes-barres, Web Push, routes HTTP | ≈ 2 100 lignes | Compile ; **2 tests** (fumée + sondage d'isolation) verts |
| `packages/web` | — | 0 | **Aucune interface** |
| `e2e/`, `docs/` | — | 0 | — |
| Documentation | PROJECT_PLAN (v1), puis MASTER_SPEC, FEATURE_TRACKER, ce plan (v2) | — | — |
| Déploiement | — | 0 | Pas de Dockerfile ni de README |

### 1.3 Terminé et testé
Au sens strict de R11 (toutes les couches + vérification réelle) : **aucune fonctionnalité visible par l'utilisateur n'est terminée**, puisqu'aucune interface n'existe. Sont vérifiés par des tests automatisés :
- **Domaine** : unités et conversions sûres ; lots, FEFO, quantités partielles et approximatives ; ouverture avec isolement de l'unité ; déplacement partiel ; consommation sur stock insuffisant ; corrections avec contrôle de concurrence ; annulation unique ; liste (fusion des doublons, alias, achats partiels, réception avec reliquat, prix inconnu) ; conflits par champ ; droits (lecture seule, administration) ; codes-barres multiples ; fusion de produits ; inventaires par emplacement ; tickets (validation, apprentissage) ; moteur (seuils, consommation observée, exclusion des ruptures, liste déduite, conditionnement, cadence, qualité, gaspillage, texte d'explication de l'exemple du cahier des charges) ; GS1 ; OCR des dates et des tickets (analyse de texte) ; statistiques ; audit ; notifications ; **semaine familiale simulée au niveau domaine**.
- **Serveur** : inscription → création de foyer → envoi d'opérations → réception des changements → contrôle d'intégrité ; isolation : lecture et écriture directes dans un autre foyer refusées (404), référence à un produit d'un autre foyer rejetée, écrasement d'un produit d'un autre foyer refusé, aucune donnée de A dans le flux de B.

### 1.4 Partiellement développé
- **Serveur écrit mais non vérifié** : connexion/déconnexion, changement de mot de passe, limitation des tentatives, invitations (création, aperçu, acceptation, révocation), rôles et retrait, SSE, pagination du pull, sauvegardes/rotation/restauration, export/import, photos, proxy codes-barres, Web Push et récapitulatifs, suppression de foyer.
- **Domaine écrit mais non testé** : produits oubliés, avancement d'un inventaire, statistiques par catégorie/magasin/produits coûteux, dépenses inhabituelles, alertes « courses non terminées » et « inventaires à vérifier », dates incohérentes (audit), recettes (créer/cuisiner), article libre transformé en produit à la réception.

### 1.5 Existant uniquement visuellement
Rien (pas encore d'interface).

### 1.6 Manquant
- **Toute l'interface** (PWA, design, navigation, toutes les pages, mode courses, scanner caméra, OCR, assistant d'inventaire, graphiques, mode sombre).
- Client de synchronisation (réplique IndexedDB par foyer, outbox, indicateur, résolution des conflits, hors ligne, purge d'un foyer quitté).
- Lecture caméra des codes (zxing-wasm) et moteur OCR (Tesseract.js).
- Comptes : récupération du mot de passe, changement d'e-mail, suppression de compte / export des données personnelles.
- Foyer : avatar, devise et paramètres et préférences de notification **à la création**, parcours d'accueil.
- Invitations par e-mail ; invitation « plateforme » pour qu'une autre famille crée son foyer.
- Matrice de permissions extensible.
- Isolation au niveau base (clés étrangères composites).
- Restauration d'un seul foyer ; preuve automatisée sauvegarde → restauration.
- Produits habituellement achetés par magasin ; suggestions périodiques ; recettes réalisables ; ingrédients manquants.
- Suites de tests : intégration serveur complète, isolation A1/A2/B1/B2, semaine familiale sur la pile complète, E2E Playwright.
- Déploiement (Docker), guide de déploiement gratuit, guide utilisateur.

### 1.7 Fonctionnait mal — corrigé pendant l'audit
| Problème | Gravité | Correction |
|---|---|---|
| **Le serveur plantait au démarrage** : import par défaut de `web-push` v4 (paquet ESM sans export par défaut) | Bloquante | `import * as webpush` — vérifié par le test de fumée. |

### 1.8 À corriger
| # | Constat | Exigence | Action |
|---|---|---|---|
| A1 | 4 rôles (propriétaire/admin/membre/lecture) au lieu de 3 | M4§4 (C1) | ✅ Corrigé (phase 1) : 3 rôles, dernier administrateur protégé. |
| A2 | Permissions codées en dur (`VIEWER_OPS`, `ADMIN_OPS`) | M4§4 | ✅ Corrigé : `OP_PERMISSIONS` + `ROLE_PERMISSIONS`. |
| A3 | La réponse de recherche de code-barres expose `cached`, qui révèle qu'un **autre foyer** a déjà scanné ce code | M4§6 | ✅ Corrigé : champ retiré (le temps de réponse plus court d'un code en cache reste un indice mineur, accepté). |
| A4 | Inscription par défaut « sur invitation d'un foyer » : une autre famille ne peut pas créer son propre foyer sans être invitée dans le vôtre | M4§9 | ✅ Corrigé : invitations plateforme (D1). |
| A5 | Création de foyer limitée au nom | M4§2 | ✅ Corrigé (API) ; écran à faire en phase 2. |
| A6 | `processed_ops` croît sans limite | Fiabilité | ✅ Corrigé : purge à 180 jours, opérations de plus de 150 jours refusées (aucune double application possible). |
| A7 | La restauration complète touche toutes les familles d'une instance | M4 (C7) | ✅ Corrigé (API) : restauration d'un foyer en nouveau foyer ; restauration complète réservée à l'hébergeur. |
| A8 | Tracker / statuts : le plan v1 ne distinguait pas les couches | M5§4 | Fait : statut + avancement par couche. |

### 1.9 Refontes techniques nécessaires (avant de construire dessus)
1. **Rôles et permissions** (A1, A2) : touche `shared/types`, `commands/execute`, `server/households`, schéma `members` (contrainte `CHECK`). Faible volume, mais **fondation** : à faire avant l'interface.
2. **Clés étrangères composites `(householdId, id)`** (ISO-05) : modification du schéma SQLite ; aucune donnée de production n'existe encore → **coût minimal maintenant, élevé plus tard**.
3. **Champs de foyer** (avatar) et opérations associées (A5).
Aucune autre refonte : le modèle de données, le protocole de synchronisation et le moteur sont cohérents avec l'ensemble des exigences M1–M5.

### 1.10 Oublis identifiés par la consolidation
Exigences présentes dans les messages mais absentes ou incomplètes dans le plan v1 : récupération du mot de passe et modification de l'e-mail (M4§1) ; invitation par e-mail (M4§3) ; avatar, devise, préférences de notification à la création (M4§2) ; trois rôles et permissions extensibles (M4§4) ; purge locale d'un foyer quitté (M4§8) ; isolation au niveau base (M4§6) ; plateforme ouverte à d'autres familles (M4§9) ; protection des données personnelles (export/suppression de compte, M3§10) ; restauration d'un seul foyer ; accessibilité ; guide utilisateur ; tests sur iPhone/Android/Windows (M4§7). Tous sont désormais dans MASTER_SPEC et le tracker.

---

## 2. Principes d'organisation

1. **Fondations d'abord** : comptes, multi-foyers, isolation, permissions et synchronisation avant toute interface métier.
2. **Un seul modèle de données** pour scanner, lots, mouvements, inventaires, liste, réception, tickets et moteur : tout passe par les mêmes opérations partagées (`packages/shared/src/commands`). Aucun module isolé.
3. **Chaque phase se termine par sa vérification** : tests automatisés + parcours E2E + mise à jour du tracker. Une phase n'est close que si ses critères de sortie sont atteints.
4. **Ordre de priorité du cahier initial respecté** (M1§13 : foyer → inventaire → mouvements → liste → mise à jour après achat → moteur → péremption → tableau de bord → dépenses → avancé), le **scanner** (M2 : « fonctionnalité prioritaire ») étant placé dès que l'inventaire et les mouvements existent.

---

## 3. Phases

### Phase 0 — Consolidation ✅ (17/11/2026)
MASTER_SPEC, FEATURE_TRACKER, PROJECT_PLAN v2, audit. **Sortie** : documents créés, audit consigné, décisions D1–D5 soumises.

### Phase 1 — Fondations multi-foyers et sécurité (P0) ✅ (17/11/2026)
**Contenu** : refonte en 3 rôles + matrice de permissions (A1, A2) ; clés étrangères composites (ISO-05) ; création de foyer complète (avatar, devise, paramètres, préférences de notification — A5) ; invitation plateforme et politique d'inscription (A4, D1) ; récupération du mot de passe, changement d'e-mail (D2) ; invitation par e-mail (D2) ; suppression de compte et export des données personnelles ; retrait du champ `cached` (A3) ; rétention de `processed_ops` (A6) ; restauration d'un seul foyer (A7).
**Tests** : suite d'intégration serveur complète (comptes, sessions, limitation, CSRF, invitations, rôles, retrait, sync, idempotence par rejeu, concurrence, ordre hors ligne, alias, export/import aller-retour, sauvegarde → restauration → données identiques, push simulé, proxy codes-barres simulé) ; **suite d'isolation A1/A2/B1/B2 complète** (MASTER_SPEC §6.3) ; **semaine familiale sur la pile serveur** (deux membres, deux appareils, rejeux).
**Sortie** : tous ces tests verts ; ISO-*, MEM-*, ACC-*, SYNC-01/03/09, BAK-01..09 au statut « Développé » ou mieux côté serveur.
**Dépend de** : décisions D1, D2 (des valeurs par défaut permettent d'avancer).

**Bilan de la phase 1** — critères de sortie atteints :
- Réalisé : 3 rôles + matrice de permissions nommées ; clés étrangères composites `(householdId, id)` ; création de foyer complète (avatar, devise, fuseau, paramètres, préférences de notification) ; invitations de foyer (code, lien, e-mail via SMTP ou `mailto:`, réservées à une adresse) ; invitations plateforme ; mot de passe oublié (SMTP en libre-service, lien administrateur serveur, commande serveur) ; changement d'e-mail et de nom répercuté ; export des données personnelles et suppression de compte avec anonymisation ; retrait du champ `cached` ; refus des opérations hors ligne de plus de 150 jours + purge quotidienne du journal d'idempotence (180 jours) ; restauration d'un seul foyer ; routes réparties en modules ; outil en ligne de commande.
- Vérifié : **59 tests serveur** (comptes 12, foyers 11, synchronisation 9, **isolation A1/A2/B1/B2 11**, données 8, services 6, **semaine familiale sur 3 appareils** 1, fumée 1) + 77 tests du domaine = **136 tests verts** ; serveur compilé pour la production, démarré réellement (sauvegarde automatique au démarrage, outil en ligne de commande).
- Défauts trouvés et corrigés pendant la phase : l'heure du récapitulatif push était lue « 08 h » en français (le récapitulatif ne serait **jamais** parti) ; chaque sauvegarde laissait des fichiers `-wal`/`-shm` à côté d'elle (désormais un fichier autonome) ; le serveur plantait au démarrage (import `web-push`, corrigé lors de l'audit).

### Phase 2 — Socle client ✅ (17/11/2026)
**Contenu** : PWA (Vite, service worker, manifeste, icônes) ; **design system** (couleurs, typographie Manrope, composants, cartes, feuilles, animations, clair/sombre) ; coquille d'application (navigation 6 rubriques, barre latérale ordinateur, bouton Scanner central) ; **sélecteur de foyer + nom du foyer actif** ; réplique IndexedDB **par foyer**, outbox, prédiction optimiste (`MemoryStore`), SSE, indicateur de synchronisation, écran des conflits/rejets, hors ligne, époque, purge d'un foyer quitté ; parcours d'accueil (inscription, connexion, créer/rejoindre un foyer, lien d'invitation) ; Dockerfile minimal pour tester sur de vrais téléphones en HTTPS.
**Tests** : E2E inscription → foyer → invitation → second membre ; hors ligne → reconnexion sans perte ; bascule entre deux foyers sans mélange ; mobile émulé (iPhone, Android).
**Sortie** : MULTI-*, SYNC-02/04/05/06/08/10/12, HH-02, MEM-01/02/05 « Testé et validé ».
**Dépend de** : Phase 1.

**Bilan de la phase 2** : design system (palette « lin & forêt », clair/sombre, Manrope, composants), coquille (barre latérale / onglets, bouton Scanner, sélecteur de foyer au nom synchronisé), parcours d'accueil (inscription, connexion, mot de passe oublié, invitation par lien, création de foyer en 3 étapes, rejoindre), Famille (membres, rôles, retrait, invitations avec code/lien/QR/e-mail, invitation d'une autre famille, journal), Paramètres (profil, foyer, notifications et push, thème, mes foyers, données personnelles, administration du serveur), moteur de synchronisation (réplique IndexedDB par foyer, outbox, prédiction partagée, SSE, reprise, époque, purge), PWA (précache, démarrage hors ligne, notifications), Dockerfile.
Vérifié : **6 parcours de bout en bout** verts ; build de production ; disposition de production démarrée hors conteneur.
Défauts trouvés et corrigés : nom du foyer dans l'en-tête non synchronisé (ni hors ligne ni en direct) ; police bloquée par la CSP (ressource intégrée en ligne).
Limites honnêtes : WebKit (Safari iPhone) indisponible dans cet environnement de test → à vérifier sur appareil ; image Docker non construite ici (Docker Hub a refusé les téléchargements : 429).

### Phase 3 — Inventaire et mouvements ✅ (17/11/2026)
**Contenu** : catégories, emplacements, magasins (gestion) ; fiche produit complète (photo, conditionnement, codes, alias, variantes) ; liste d'inventaire (recherche, filtres, regroupements, statuts) ; détail produit (lots, fiabilité, consommation, historique) ; **actions rapides** (ajouter, consommer, terminé, manquant, corriger, ouvert, déplacer, jeter) avec quantités décimales/approximatives ; journal d'activité ; **annulation** ; doublons et fusion validée.
**Sortie** : CAT-*, STK-*, MVT-* « Testé et validé » (E2E + domaine).

**Bilan de la phase 3** : liste d'inventaire (recherche nom/marque/alias/code, filtres épuisés/faibles/à consommer vite/ouverts, regroupement par emplacement ou catégorie, « −1 » rapide avec annulation), fiche produit (stock et fiabilité, lots par ordre de péremption avec source de la date et de la quantité, analyse et recommandation expliquées, codes-barres, noms alternatifs, historique regroupé par action avec annulation, fusion validée, archivage), formulaire produit (doublons signalés en direct, conditionnement, photo, stock initial), actions rapides (consommer, ajouter/acheter, ouvrir, terminé, corriger, manquant, jeter, déplacer, date), gestion du catalogue (catégories, emplacements, magasins).
Vérifié : 4 nouveaux parcours de bout en bout (10 au total) + 136 tests unitaires/intégration.
Défauts trouvés et corrigés : libellés de listes déroulantes non reliés à leur champ (accessibilité) ; historique d'une ouverture affiché en deux lignes contradictoires ; quantité par défaut de « 1 g » ; limites anti-abus bloquant les tests (désormais réglables, inchangées en production).
**Dépend de** : Phase 2.

### Phase 4 — Scanner universel ✅ (17/11/2026)
**Contenu** : lecture caméra zxing-wasm (1D/2D, GS1) ; identification (catalogue local hors ligne → serveur → OFF/OBF/OPF) ; validation d'identité incertaine ; création rapide ; **modes Réception / Consommation / Inventaire** ; quantité par scan ; mode continu ; confirmation discrète + Annuler ; anti-rebond ; gestion des erreurs.
**Tests** : images de codes (EAN, DataMatrix GS1, QR Digital Link) injectées dans la caméra simulée ; E2E des trois modes ; essais sur téléphones réels.
**Sortie** : SCAN-* (hors OCR) « Testé et validé ».

**Bilan de la phase 4** : page Scanner (caméra arrière en continu, lampe, son/vibration, trois modes Réception/Consommation/Inventaire, quantité par scan, « Ranger dans », magasin, saisie manuelle, photo d'un code), identification (catalogue local → serveur → Open Food/Beauty/Products Facts → création rapide avec emplacement ; association à un produit existant proposée, jamais automatique), GS1 (date, DDM, lot, poids), une seule question (la date) quand elle manque pour un produit habituellement daté, confirmation discrète avec Annuler, regroupement par lot, inventaire par emplacement avec revue des écarts (stock situé ailleurs signalé).
Vérifié : décodage réel d'images de codes (4 formats) en test unitaire et dans le navigateur ; 2 parcours de bout en bout.
Défauts trouvés et corrigés : produit créé au scan sans emplacement (inventaire par emplacement faussé) ; bouton flottant redondant sur la page Scanner ; ordre des champs de la création rapide ; outillage de test (dossier de données supprimé après le démarrage du serveur, rechargements trop rapides).
Limites : caméra éprouvée avec le périphérique simulé de Chromium seulement ; Open Food Facts injoignable lors des derniers essais en direct (comportement dégradé vérifié). Sur un réseau imposant un proxy, lancer le serveur avec `NODE_USE_ENV_PROXY=1`.
**Dépend de** : Phase 3.

### Phase 5 — Liste de courses, mode courses, réception, multi-magasins ✅ (17/11/2026)
**Contenu** : liste collaborative complète (ajouts depuis stock/recommandations, priorités, attribution, magasins, rayons, historique, avertissement anti-doublon) ; **mode courses** (grandes cases, par magasin puis rayon, écran allumé, temps réel, prix facultatif) ; **réception** (quantités réelles, écarts, dates, prix, emplacement, reliquat) ; magasins (adresse, notes, ordre des rayons, historique, produits habituels).
**Tests** : E2E à deux navigateurs (mise à jour instantanée, fusion, « déjà acheté par ») ; réception partielle.
**Sortie** : SHOP-*, RCV-*, STORE-* « Testé et validé ».

**Bilan de la phase 5** : page Courses en trois onglets — **Liste** (saisie rapide avec suggestions du catalogue et avertissement anti-doublon, recommandations du moteur ajoutées une à une ou toutes, jamais automatiquement, regroupement par rayon ou par magasin, coût prévisionnel distinguant prix connus « ≈ estimés » et inconnus, fiche article : quantité, achat partiel, priorité, rayon, magasin, membre chargé, commentaire), **Réception** (quantité réellement rapportée, écart, reliquat laissé dans la liste, prix facultatif, magasin, emplacement, date saisie ou proposée d'après la conservation habituelle et marquée « estimée », produit existant / créé / dépense seule, « Pas acheté », « Tout ranger ») et **Historique** (achats rangés avec prix, articles retirés restaurables). **Mode courses** plein écran : magasin choisi (mémorisé), parcours par rayon selon l'ordre propre au magasin, grandes cases, progression, « Pris par … » en direct, quantité prise et prix en magasin, article pris en plus (coche l'existant plutôt que de dupliquer), écran maintenu allumé (Wake Lock). **Magasins** : création, adresse, notes, couleur, ordre des rayons, passages, dépensé (prix connus), panier moyen (passages entièrement chiffrés seulement), produits habituels, derniers achats, « Faire les courses ici ». Fiche produit : « Ajouter à la liste » / « Dans la liste de courses : … ».
Vérifié : 4 nouveaux tests unitaires (organisation par magasin et par rayon, bilan d'un magasin) ; 6 parcours de bout en bout dont 2 à deux navigateurs (fusion « ajouté par … », attribution et « Pris par … » en direct, achat partiel puis réception avec création du produit, écart à la réception, retrait/restauration, ordre des rayons suivi en mode courses, historique du magasin, recommandations, conflit de saisie).
Défauts trouvés et corrigés : **une synchronisation en arrière-plan (confirmation du serveur ou action d'un autre membre) effaçait la saisie en cours** dans la fiche d'un article de la liste et dans les fiches d'action de l'inventaire — formulaire désormais initialisé à l'ouverture seulement, version de référence des conflits mémorisée à l'ouverture (test de non-régression à deux navigateurs, vérifié en échec sur l'ancien code) ; historique limité aux articles entièrement réceptionnés (les réceptions partielles n'y figuraient pas) — désormais construit à partir des achats enregistrés ; en-têtes de page et barre d'ajout débordant sur téléphone.
Limites : écran maintenu allumé non vérifiable sans téléphone réel ; produits habituels d'un magasin couverts par les tests unitaires seulement.
**Dépend de** : Phase 3 (Phase 4 souhaitable pour la réception par scan).

### Phase 6 — Prévisions, péremption et anti-gaspillage ← **prochaine étape**
**Contenu** : page Prévisions (recommandations par urgence avec explications, confiance, coût estimé, « tout ajouter ») ; calendrier des ruptures ; achats réguliers ; produits sans données (inviter à définir des seuils) ; péremption (statuts, ouverts, oubliés, à consommer en priorité) ; tableau de bord anti-gaspillage ; affichage des **niveaux de fiabilité** partout.
**Sortie** : ENG-*, EXP-*, REL-* « Testé et validé ».

### Phase 7 — Tableau de bord et centre de notifications
**Contenu** : page d'accueil (indicateurs, « Ce que votre maison doit prévoir », liste, derniers mouvements, dépenses du mois, prévisions) ; personnalisation des widgets ; centre de notifications (alertes calculées, préférences par membre, masquage, fil d'activité).
**Sortie** : DASH-*, NOTIF-01..11/14 « Testé et validé ».

### Phase 8 — Inventaire initial guidé et inventaires correctifs
**Contenu** : assistant par espaces avec progression, scan à la chaîne, édition avant validation, reprise sur un autre appareil ; écran des écarts et validation ; contrôle de cohérence (écran d'anomalies avec actions).
**Sortie** : INV-*, AUD-* « Testé et validé ».
**Dépend de** : Phase 4.

### Phase 9 — Dépenses et budget avancé
**Contenu** : historique des achats, saisie/édition, graphiques interactifs (semaine, mois, année, catégorie, magasin), évolution des prix, comparaison par magasin, produits coûteux, budget et projection, panier moyen, dépenses inhabituelles, coût prévisionnel de la liste (connu/estimé/inconnu).
**Sortie** : BUD-* « Testé et validé ».

### Phase 10 — OCR : dates et tickets de caisse
**Contenu** : Tesseract.js auto-hébergé (chargé à la demande, mis en cache) ; photo d'étiquette → date proposée → confirmation ; ticket : photo/import → analyse → **écran de validation** (correspondances sûres/probables/incertaines, produits inconnus, lignes à mettre en stock) → application.
**Tests** : corpus d'étiquettes et de tickets réels (photos anonymisées) ; E2E.
**Sortie** : OCR-*, TKT-* « Testé et validé ».
**Dépend de** : Phases 4, 5, 9.

### Phase 11 — Données : sauvegardes, export/import, restauration (interface)
**Contenu** : écrans Paramètres → Données (export JSON/CSV, import, contrôle d'intégrité) et Administration du serveur (sauvegardes, vérification, téléchargement, restauration complète ou par foyer).
**Sortie** : BAK-* « Testé et validé ».

### Phase 12 — Notifications push et récapitulatifs
**Contenu** : abonnement Web Push (service worker), préférences de récapitulatif, alertes immédiates facultatives, test sur iPhone (PWA installée), Android, Windows.
**Sortie** : NOTIF-12/13 « Testé et validé ».

### Phase 13 — Validation globale
**Contenu** : E2E exhaustif (chaque bouton) ; **semaine familiale sur la pile complète** (2 membres, 2 appareils, hors ligne partiel) ; isolation de bout en bout ; performances (1 000 produits, 50 000 mouvements) ; accessibilité ; revue visuelle (captures clair/sombre, mobile/ordinateur) ; **audit global** (MASTER_SPEC §19).
**Sortie** : TST-* « Testé et validé ».

### Phase 14 — Déploiement et documentation
**Contenu** : image Docker finale, `docker-compose`, guide d'hébergement gratuit (Raspberry Pi/NAS/PC + Tailscale ou Cloudflare Tunnel), sauvegardes hors machine, mise à jour, guide utilisateur pour transmettre HOMEOS à d'autres familles.
**Sortie** : DEP-*, DOC-* « Testé et validé » (installation réelle depuis zéro).

### Phase 15 — Fonctionnalités avancées (P3)
Recettes (réalisables avec le stock, ingrédients manquants → liste, cuisiner), suggestions périodiques de réapprovisionnement, produits habituels par magasin.

### Phase 16 — Futur (P4, à spécifier — D5)
Planification des repas, gestion des restes, tâches ménagères, chiffrement de bout en bout (D4), option PostgreSQL/RLS.

---

## 4. Dépendances

```
Phase 1 Fondations ──► Phase 2 Socle client ──► Phase 3 Inventaire/mouvements ──┬─► Phase 4 Scanner ──► Phase 8 Inventaire guidé
                                                                                  ├─► Phase 5 Courses/réception/magasins
                                                                                  └─► Phase 6 Prévisions/péremption ──► Phase 7 Accueil/notifications
Phase 5 + Phase 9 Dépenses + Phase 4 ──► Phase 10 OCR (dates, tickets)
Phases 1-10 ──► Phase 11 Données (UI) ──► Phase 12 Push ──► Phase 13 Validation globale ──► Phase 14 Déploiement
Phase 13 ──► Phase 15 Avancé ──► Phase 16 Futur
```
Les phases 5, 6 et 9 peuvent avancer en parallèle une fois la phase 3 terminée.

---

## 5. Définition de « terminé »
Une fonctionnalité passe à **Testé et validé** lorsque : (1) toutes ses couches (domaine, serveur, interface) sont implémentées ; (2) des tests automatisés couvrent ses règles et son parcours réel (unitaires/intégration + E2E) ; (3) elle fonctionne hors ligne si elle le doit ; (4) elle respecte l'isolation des foyers ; (5) elle est en français, accessible et conforme au design ; (6) le tracker est mis à jour avec la preuve (fichier de test).

---

## 6. Risques et mesures
| Risque | Mesure |
|---|---|
| Lecture de codes peu fiable sur certains téléphones | zxing-wasm (moteur C++), essais sur appareils réels, saisie manuelle toujours possible. |
| OCR imprécis | Confirmation obligatoire, aucune écriture sans validation, corpus de tests réels. |
| iOS : limites PWA (notifications seulement si installée, stockage) | Guide d'installation, persistance demandée (`navigator.storage.persist`), synchronisation fréquente. |
| Perte de données côté serveur | Sauvegardes vérifiées, rotation, copie hors machine documentée, restauration testée. |
| Fuite entre foyers | Couche d'accès unique, contrôle par requête, clés composites, suite d'isolation dans l'intégration continue. |
| Confidentialité vis-à-vis de l'hébergeur | Transparence (D4), possibilité d'une instance par famille. |
| Dérive du périmètre | Tracker exhaustif, phases avec critères de sortie, R12. |

---

## 7. Décisions en attente (voir MASTER_SPEC §16.2)
D1 inscription plateforme · D2 e-mails sans service payant · D3 suppression d'un foyer · D4 confidentialité vis-à-vis de l'hébergeur · D5 périmètre repas/restes/tâches ménagères. Les phases 1 et suivantes peuvent démarrer avec les **propositions par défaut**, faciles à ajuster.
