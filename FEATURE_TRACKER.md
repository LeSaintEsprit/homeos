# HOMEOS — Matrice de traçabilité (FEATURE_TRACKER)

> État **réel et vérifié** de chaque fonctionnalité. Référence fonctionnelle : `MASTER_SPEC.md`. Organisation : `PROJECT_PLAN.md`.
> Dernière mise à jour : 17/11/2026 — fin de la phase 2 (socle client).

## Légende

**Statuts** : `À spécifier` · `À développer` · `En développement` · `Développé` · `Testé et validé` · `Bloqué` · `Reporté`.

Règle (R11) : une fonctionnalité visible par l'utilisateur n'est « Testée et validée » que si **toutes ses couches** existent et que son fonctionnement réel a été vérifié (tests automatisés + parcours de bout en bout). Une interface seule ne compte pas, une logique seule non plus.

**Avancement par couche** : **D** = domaine partagé (`packages/shared`) · **S** = serveur/API (`packages/server`) · **C** = client/interface (`packages/web`) · **T** = tests.
✅ fait et vérifié par des tests · 🟡 écrit mais non vérifié (ou vérifié partiellement) · ❌ absent · — sans objet.

**Priorités** : P0 Indispensable · P1 Importante · P2 Complémentaire · P3 Avancée · P4 Future.
**Origine** : M1 cahier initial · M2 scanner · M3 enrichissement · M4 multi-foyers · M5 consolidation · AUD constat de l'audit.

**Constat global (fin de phase 2)** : domaine (77 tests) et serveur (59 tests) vérifiés ; socle de l'application vérifié de bout en bout (6 parcours Playwright : comptes, foyers, invitations, temps réel, hors ligne, bascule entre foyers, retrait, lecture seule, démarrage sans réseau). Les modules métier visibles (inventaire, scanner, courses, prévisions…) restent à construire dans l'interface : ils sont donc « En développement ».

---

## 1. Fondations et contraintes

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| FND-01 | Budget 0 € | Aucune dépendance payante indispensable | M1§1, M3§12, M5§5 | P0 | — | Développé | Toutes les dépendances actuelles sont libres et gratuites ; à revérifier à chaque ajout | Revue des dépendances à chaque phase |
| FND-02 | Open source | Technologies libres privilégiées | M1§1 | P0 | — | Développé | Fastify, SQLite, React, zod… (MIT/Apache/ISC/OFL) | Revue des licences |
| FND-03 | Vérification des services gratuits | Limites vérifiées avant intégration | M1§1 | P0 | — | Testé et validé | Supabase écarté (pas de sauvegarde, pause 7 j) ; OFF : 100 req/min, User-Agent, testé sur une fiche réelle ; Cloudflare Tunnel gratuit ≤ 50 utilisateurs | — |
| FND-04 | Sans IA générative | Règles déterministes, statistiques | M1§4, M3§12, M5§5 | P0 | — | Développé | D ✅ moteur purement algorithmique | Revue de code |
| FND-05 | Interface en français | Tous les textes en français | M1§1 | P0 | UX | En développement | D/S ✅ messages · C 🟡 écrans des phases 1-2 en français ; modules suivants à faire | E2E : aucun texte anglais |
| FND-06 | PWA installable | Installation PC/iPhone/Android, cache hors ligne | M1§1, M4§7 | P0 | C | Développé | C ✅ manifeste, icônes, service worker ; démarrage sans réseau vérifié (`e2e/foundations.spec.ts`) · installation sur appareil réel non vérifiée ici | Lighthouse PWA, installation réelle |
| FND-07 | Architecture monorepo partagée | Même logique métier client/serveur | M1§12 | P0 | — | Testé et validé | D ✅ S ✅ — logique partagée exécutée côté serveur (toutes les suites serveur) | — |

## 2. Comptes utilisateurs

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| ACC-01 | Inscription | Compte personnel (e-mail, mot de passe, nom) | M1§2, M4§1 | P0 | ACC-11 | Testé et validé | S ✅ auth.test · C ✅ `e2e/foundations.spec.ts` | Intégration + E2E |
| ACC-02 | Connexion | Session par cookie sécurisé | M4§1 | P0 | — | Développé | S ✅ · C ✅ écran de connexion (non couvert par un test de bout en bout) | Intégration (succès, échec, limitation) |
| ACC-03 | Déconnexion | Suppression de la session | M4§1 | P0 | — | Développé | S ✅ · C ✅ (purge des données locales à la déconnexion) — non couvert E2E | Intégration |
| ACC-04 | Récupération du mot de passe | Lien à usage unique / SMTP facultatif / commande serveur | M4§1 | P0 | D2 | Développé | S ✅ · CLI ✅ · C ✅ écrans « mot de passe oublié » et « réinitialiser » + génération du lien (Paramètres) — non couverts E2E | Intégration (expiration, usage unique) |
| ACC-05 | Gestion du profil | Nom, couleur, préférences | M1§2, M4§1 | P0 | — | Développé | S ✅ · C ✅ Paramètres → Mon profil — non couvert E2E | Intégration + E2E |
| ACC-06 | Modifier ses informations | Nom, e-mail, mot de passe (déconnexion des autres appareils) | M4§1 | P1 | — | Développé | S ✅ · C ✅ nom, e-mail (avec mot de passe), mot de passe — non couverts E2E | Intégration |
| ACC-07 | Sessions sécurisées | HttpOnly, SameSite, Secure, glissantes 180 j, anti-CSRF | M3§10 | P0 | — | Testé et validé | S ✅ auth.test (HttpOnly, SameSite, CSRF en-tête + origine, invalidation) | Intégration (CSRF, expiration) |
| ACC-08 | Limitation des tentatives | Connexion, inscription, invitations | M3§10 | P0 | — | Testé et validé | S ✅ auth.test (blocage après 10 échecs, même avec le bon mot de passe) | Intégration |
| ACC-09 | Attribution des actions | Chaque action liée à son auteur | M1§2, M4§1 | P0 | — | Testé et validé | D ✅ · S ✅ week.test (chaque mouvement attribué), auth.test (anonymisation conservant l’historique) | Intégration |
| ACC-10 | Protection des données personnelles | Export de ses données, suppression du compte (historique anonymisé) | M3§10 | P1 | — | Développé | S ✅ · C ✅ téléchargement des données, suppression du compte — non couverts E2E | Intégration |
| ACC-11 | Politique d'inscription plateforme | Ouverte / sur invitation / invitation plateforme | M4§9, AUD | P0 | D1 | Testé et validé | S ✅ auth.test (premier compte libre, sur invitation, invitation plateforme, fermée, ouverte) | Intégration |

## 3. Foyers

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| HH-01 | Création d'un foyer | Nom + catégories/emplacements par défaut | M1§2, M4§2 | P0 | ACC-01 | Testé et validé | S ✅ · C ✅ `e2e/foundations.spec.ts` | Intégration + E2E |
| HH-02 | Parcours d'accueil | « Créer un foyer » ou « Rejoindre avec une invitation » | M4§2 | P0 | HH-01, MEM-01 | Testé et validé | C ✅ `e2e/foundations.spec.ts` (créer / rejoindre) | E2E |
| HH-03 | Photo / avatar du foyer | Facultatif | M4§2 | P1 | CAT-04 | Développé | S ✅ · C ✅ choix d’emoji à la création et dans les réglages | Intégration |
| HH-04 | Paramètres initiaux | Fréquence des courses, marge, alertes, budget | M4§2 | P1 | — | Développé | S ✅ · C ✅ assistant de création (fréquence, budget) | Intégration |
| HH-05 | Devise | Choisie à la création | M4§2 | P1 | — | Développé | S ✅ · C ✅ assistant + réglages | Intégration |
| HH-06 | Préférences de notifications à la création | Récapitulatif, types | M4§2 | P1 | NOTIF-10 | Développé | S ✅ · C ✅ étape « notifications » de l’assistant | E2E |
| HH-07 | Créateur = administrateur | Automatique | M4§2 | P0 | MEM-06 | Testé et validé | S ✅ · C ✅ `e2e/foundations.spec.ts` (le créateur administre et invite) | Intégration |
| HH-08 | Paramètres du foyer | Modification avec détection de conflit | M1§2 | P0 | MEM-06 | Testé et validé | D/S ✅ · C ✅ `e2e/foundations.spec.ts` (modification hors ligne puis synchronisée) | Intégration + E2E |
| HH-09 | Suppression d'un foyer | Double confirmation + sauvegarde préalable | AUD | P1 | BAK-01 | En développement | S ✅ households.test (administrateur, confirmation, sauvegarde préalable, purge complète) · C ❌ | Intégration |
| HH-10 | Nombre illimité de foyers | Une instance, plusieurs familles | M4 | P0 | ISO-* | En développement | S ✅ isolation.test · C ❌ | Tests d'isolation |

## 4. Membres, invitations, rôles

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| MEM-01 | Invitation par code | Code 10 caractères | M1§2, M4§3 | P0 | HH-01 | Testé et validé | S ✅ · C ✅ `e2e/foundations.spec.ts` (inscription avec code) | Intégration |
| MEM-02 | Invitation par lien | `/invitation/CODE`, partage SMS/WhatsApp/QR | M4§3 | P0 | MEM-01 | Testé et validé | S ✅ · C ✅ `e2e/foundations.spec.ts` (page d’invitation par lien) ; QR code et partage natif disponibles | E2E |
| MEM-03 | Invitation par e-mail | Sans service payant | M4§3 | P1 | D2 | Développé | S ✅ · C ✅ champ e-mail + lien mailto — non couvert E2E | Intégration |
| MEM-04 | Règles d'invitation | Rôle, expiration, nombre d'utilisations, révocation | M4§3 | P0 | MEM-01 | Développé | S ✅ · C ✅ rôle, validité, utilisations, révocation — non couvert E2E | Intégration (expirée, révoquée, épuisée) |
| MEM-05 | Accès immédiat après acceptation | Synchronisation initiale complète | M4§3 | P0 | SYNC-05 | Testé et validé | `e2e/foundations.spec.ts` : données visibles dès l’arrivée, en temps réel chez les autres | E2E |
| MEM-06 | Trois rôles | Administrateur / Membre / Lecture seule | M4§4 | P0 | — | Testé et validé | D ✅ matrice testée (commands.test) · S ✅ households.test (contrainte base, refus de « owner ») | Unitaires + intégration |
| MEM-07 | Droits administrateur | Foyer, invitations, retrait, rôles, tout | M4§4 | P0 | MEM-06 | Testé et validé | S ✅ · C ✅ `e2e/foundations.spec.ts` (retrait d’un membre) | Intégration |
| MEM-08 | Droits membre | Stocks, produits, scans, liste, achats, statistiques | M4§4 | P0 | MEM-06 | En développement | D ✅ · S ✅ · C ❌ | Intégration |
| MEM-09 | Lecture seule | Aucune modification | M4§4 | P0 | MEM-06 | Testé et validé | D/S ✅ · C ✅ `e2e/foundations.spec.ts` (actions de modification absentes) | Intégration + E2E |
| MEM-10 | Matrice de permissions extensible | Permissions nommées par opération | M4§4 | P0 | MEM-06 | Testé et validé | D ✅ `OP_PERMISSIONS` + `ROLE_PERMISSIONS` (commands.test) · S ✅ routes par permission | Unitaires |
| MEM-11 | Retrait : perte immédiate des droits | API, temps réel, purge locale | M4§8 | P0 | SYNC-12 | Testé et validé | S ✅ · C ✅ `e2e/foundations.spec.ts` (accès coupé en direct, base locale supprimée) | Isolation |
| MEM-12 | Changement de rôle, dernier administrateur protégé | — | M4§4 | P0 | MEM-06 | Développé | S ✅ · C ✅ changement de rôle — non couvert E2E | Intégration |
| MEM-13 | Quitter un foyer | — | M4§5 | P1 | MEM-12 | Développé | S ✅ · C ✅ « Quitter le foyer » — non couvert E2E | Intégration |
| MEM-14 | Profils visibles du foyer | Nom, couleur, rôle | M1§2 | P1 | — | Testé et validé | C ✅ `e2e/foundations.spec.ts` (liste des membres) | E2E |
| MEM-15 | Invitation plateforme | Permet à une autre famille de créer son foyer | M4§9, AUD | P0 | D1 | Développé | S ✅ · C ✅ Famille → « Inviter une autre famille » — non couvert E2E | Intégration |

## 5. Multi-foyers

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| MULTI-01 | Appartenance à plusieurs foyers | — | M4§5 | P0 | — | Testé et validé | S ✅ · C ✅ `e2e/foundations.spec.ts` | Isolation |
| MULTI-02 | Sélecteur de foyer | Accessible partout | M4§5 | P0 | C | Testé et validé | C ✅ `e2e/foundations.spec.ts` | E2E |
| MULTI-03 | Données exclusives du foyer actif | Réplique locale séparée par foyer | M4§5 | P0 | SYNC-05 | Testé et validé | C ✅ `e2e/foundations.spec.ts` (une base locale par foyer, aucune donnée croisée) | E2E (bascule sans mélange) |
| MULTI-04 | Nom du foyer actif affiché | En permanence | M4§5 | P0 | C | Testé et validé | C ✅ `e2e/foundations.spec.ts` (nom synchronisé, à jour hors ligne et en direct) | E2E |
| MULTI-05 | Aucun mélange (listes, stocks, notifications) | Y compris notifications push | M4§5 | P0 | NOTIF-* | En développement | S ✅ · C ✅ pour membres/invitations ; stocks, listes et notifications à vérifier avec leurs modules | Isolation + E2E |

## 6. Isolation et sécurité

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| ISO-01 | `householdId` sur chaque donnée | Toutes les tables métier | M4§6 | P0 | — | Testé et validé | S ✅ isolation.test | Isolation |
| ISO-02 | Couche d'accès filtrée | `SqlStore(householdId)` | M4§6 | P0 | — | Testé et validé | S ✅ isolation.test | Isolation |
| ISO-03 | Vérification serveur de l'appartenance | Jamais de confiance dans le client | M4§6 | P0 | — | Testé et validé | S ✅ isolation.test (14 routes × 2 foyers → 404 ; non connecté → 401) | Isolation complète |
| ISO-04 | Anti-falsification d'identifiants | Référence ou écrasement d'une entité d'un autre foyer | M4§6, M4§8 | P0 | — | Testé et validé | S ✅ isolation.test (25 opérations falsifiées rejetées ; aucune modification de A) | Alias, fusion, import, photos |
| ISO-05 | Isolation au niveau base | Clés étrangères composites `(householdId, id)` | M4§6, C8 | P0 | — | Testé et validé | S ✅ clés étrangères composites ; isolation.test (insertion SQL directe refusée) | Tentatives SQL directes |
| ISO-06 | Photos/fichiers isolés | Par foyer | M4§6 | P0 | CAT-04 | Testé et validé | S ✅ isolation.test (photo de A introuvable depuis B) | Isolation |
| ISO-07 | Notifications isolées | Par foyer | M4§6 | P0 | NOTIF-* | Testé et validé | S ✅ isolation.test + services.test | Isolation |
| ISO-08 | Suite de tests A1/A2/B1/B2 | 8 vérifications + API directe + falsification | M4§8 | P0 | ISO-01..07 | Testé et validé | `server/test/isolation.test.ts` (11 tests) | — |
| ISO-09 | Cache produits sans fuite | Ne pas révéler qu'un autre foyer a scanné un code | AUD | P1 | SCAN-03 | Testé et validé | S ✅ champ retiré ; services.test vérifie son absence | Intégration |
| ISO-10 | Transparence vis-à-vis de l'hébergeur | Information des foyers hébergés | AUD | P1 | D4 | En développement | Décision D4 consignée (MASTER_SPEC §16.2) · C ❌ (affichage aux foyers hébergés) | — |
| ISO-11 | En-têtes de sécurité, CSP, anti-CSRF | — | M3§10 | P0 | — | Testé et validé | S ✅ auth.test (CSRF) ; en-têtes présents sur toutes les réponses | Intégration |

## 7. Synchronisation et hors ligne

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| SYNC-01 | Opérations idempotentes | `opId`, résultat enregistré atomiquement | M1§12, M3§7 | P0 | — | Testé et validé | S ✅ sync.test (rejeu, rejet mémorisé), week.test (renvois réseau) | Rejeu, coupure réseau |
| SYNC-02 | Succès seulement après confirmation | Outbox persistante | M1§12 | P0 | SYNC-05 | Testé et validé | S ✅ · C ✅ `e2e/foundations.spec.ts` (en attente hors ligne → confirmé au retour) | Intégration + E2E |
| SYNC-03 | Pull incrémental paginé | Curseur `seq` | M1§12 | P0 | — | Testé et validé | S ✅ sync.test (pagination, pierres tombales, curseur) | Pagination, pierres tombales |
| SYNC-04 | Temps réel | SSE + repli périodique | M1§5 | P0 | — | Testé et validé | S ✅ · C ✅ `e2e/foundations.spec.ts` (arrivée d’un membre, renommage vus en direct) | Intégration + E2E 2 membres |
| SYNC-05 | Réplique locale + prédiction | IndexedDB par foyer, même logique métier | M1§1 | P0 | D | Testé et validé | D ✅ · C ✅ `e2e/foundations.spec.ts` | Unitaires + E2E |
| SYNC-06 | Hors connexion | App + données + file d'attente | M1§1, M3§10 | P0 | SYNC-05 | Testé et validé | C ✅ `e2e/foundations.spec.ts` (modification hors ligne ; ouverture de l’application sans réseau) | E2E hors ligne |
| SYNC-07 | Conflits | Par champ, stock attendu, fusion, alias | M1§12 | P0 | — | En développement | D/S ✅ · C 🟡 conflits signalés (notifications + liste « À vérifier ») ; écran de résolution champ par champ à compléter | Concurrence serveur + E2E |
| SYNC-08 | Indicateur de synchronisation | Synchronisé / en attente / hors ligne / problème | M1§12 | P0 | SYNC-02 | Testé et validé | C ✅ `e2e/foundations.spec.ts` (état synchronisé / hors ligne) | E2E |
| SYNC-09 | Connexions simultanées | Transactions sérialisées | M1§12 | P0 | — | Testé et validé | S ✅ sync.test (consommations simultanées), week.test | Concurrence |
| SYNC-10 | Resynchronisation après restauration | Changement d'époque | M3§10 | P0 | BAK-04 | Développé | S ✅ · C ✅ resynchronisation complète au changement d’époque — non couverte E2E | Intégration |
| SYNC-11 | iPhone, Android, Windows, navigateurs | — | M4§7 | P0 | C | En développement | Chromium (ordinateur et mobile émulé) ✅ ; WebKit/Safari iPhone indisponible dans cet environnement de test : à vérifier sur appareil | E2E (WebKit, Chromium, mobile) |
| SYNC-12 | Purge locale d'un foyer quitté | — | M4§8, AUD | P0 | MEM-11 | Testé et validé | C ✅ `e2e/foundations.spec.ts` (retrait) ; déconnexion et foyer quitté purgent aussi | E2E |
| SYNC-13 | Rétention des opérations traitées | Purge sûre de `processed_ops` | AUD | P2 | — | Développé | S ✅ refus des opérations trop anciennes (sync.test) ; purge quotidienne écrite, non testée | Intégration |

## 8. Catalogue

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| CAT-01 | Fiche produit complète | Tous les champs de M1§3 | M1§3 | P0 | — | En développement | D ✅ · S 🟡 · C ❌ | E2E |
| CAT-02 | Catégories personnalisables | 9 par défaut | M1§3 | P0 | — | En développement | D ✅ · C ❌ | E2E |
| CAT-03 | Emplacements personnalisables | 9 par défaut dont Cuisine | M1§3, M3§1 | P0 | — | En développement | D ✅ · C ❌ | E2E |
| CAT-04 | Photo facultative | Redimensionnée côté client, isolée | M1§3 | P1 | — | En développement | S 🟡 · C ❌ | Intégration |
| CAT-05 | Plusieurs codes-barres par produit | Avec format, marque, quantité par scan | M3§3 | P0 | — | En développement | D ✅ · C ❌ | — |
| CAT-06 | Formats d'emballage | Conditionnement (1 paquet = 500 g) | M3§3 | P0 | — | En développement | D ✅ · C ❌ | — |
| CAT-07 | Variantes | Famille de produits | M3§3 | P2 | — | En développement | D 🟡 champ seulement · C ❌ | E2E |
| CAT-08 | Marques différentes | Marque par code | M3§3 | P1 | CAT-05 | En développement | D ✅ · C ❌ | — |
| CAT-09 | Produits personnalisés | Sans code-barres | M3§3 | P0 | — | En développement | D ✅ · C ❌ | — |
| CAT-10 | Alias et noms alternatifs | Dont libellés de tickets appris | M3§3 | P1 | — | En développement | D ✅ · C ❌ | — |
| CAT-11 | Détection des doublons probables | Sans fusion automatique | M3§3, M1§12 | P0 | — | En développement | D ✅ · C ❌ | — |
| CAT-12 | Fusion validée | Conserve l'historique, conversion vérifiée | M3§3 | P1 | CAT-11 | En développement | D ✅ · S 🟡 · C ❌ | Intégration |
| CAT-13 | Validation d'identité incertaine | Question lors du scan | M3§3, M2§1 | P0 | SCAN-05 | À développer | C ❌ | E2E |
| CAT-14 | Archivage / restauration | — | AUD | P1 | — | En développement | D ✅ · C ❌ | — |
| CAT-15 | Magasin habituel | Par produit | M1§3 | P1 | STORE-01 | En développement | D ✅ · C ❌ | — |
| CAT-16 | Commentaires | — | M1§3 | P1 | — | En développement | D ✅ · C ❌ | — |
| CAT-17 | Consommation moyenne affichée | Calculée, avec sa source | M1§3 | P0 | ENG-05 | En développement | D ✅ · C ❌ | E2E |
| CAT-18 | Historique des mouvements par produit | — | M1§3 | P0 | MVT-08 | En développement | D ✅ · C ❌ | E2E |

## 9. Stocks, lots, unités

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| STK-01 | Lots multiples | Quantités et dates différentes | M1§3, M1§7 | P0 | — | En développement | D ✅ · S 🟡 · C ❌ | E2E |
| STK-02 | Quantités partielles | 0,5 bouteille, 250 g, 300 ml, 1,5 kg | M3§2 | P0 | — | En développement | D ✅ · C ❌ (saisie décimale) | E2E |
| STK-03 | Quantité approximative | « Environ la moitié » | M3§2, M3§8 | P0 | — | En développement | D ✅ · C ❌ | — |
| STK-04 | Unités et conversions | g/kg, ml/cl/L, comptage, conditionnements | M1§3, M3§2 | P0 | — | En développement | D ✅ · C ❌ | — |
| STK-05 | Aucune conversion incompatible | Sans information fiable | M3§2 | P0 | — | En développement | D ✅ · S 🟡 | Intégration |
| STK-06 | Quantités achetée / initiale / restante / consommée | Distinction affichée | M3§2 | P1 | — | En développement | D 🟡 (données présentes, calcul « consommée » à exposer) · C ❌ | Unitaires + E2E |
| STK-07 | FEFO | Date la plus proche, ouverts d'abord | M1§7, M2§5 | P0 | — | En développement | D ✅ · S 🟡 | — |
| STK-08 | Jamais de stock négatif | Base + domaine | M1§12, M3§7 | P0 | — | Testé et validé | D ✅ · S ✅ contrainte CHECK + sync.test (jamais négatif sous concurrence) | Intégration (tentative directe) |
| STK-09 | Emplacement par lot, déplacement partiel | — | M1§3 | P1 | — | En développement | D ✅ · C ❌ | — |

## 10. Mouvements et actions rapides

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| MVT-01 | Ajouter au stock | — | M1§6 | P0 | — | En développement | D ✅ · S ✅ (fumée) · C ❌ | E2E |
| MVT-02 | Retirer / consommer | — | M1§6 | P0 | — | En développement | D ✅ · S ✅ (fumée) · C ❌ | E2E |
| MVT-03 | Déclarer terminé | Avec ajout facultatif à la liste | M1§6 | P0 | SHOP-01 | En développement | D ✅ · C ❌ | E2E |
| MVT-04 | Signaler manquant | Ajout prioritaire à la liste, stock inchangé | M1§6 | P0 | SHOP-01 | En développement | D ✅ · C ❌ | E2E |
| MVT-05 | Modifier une quantité | Motif obligatoire, contrôle de concurrence | M1§6 | P0 | — | En développement | D ✅ · C ❌ | E2E |
| MVT-06 | Signaler ouvert | Isolement de l'unité ouverte | M1§6 | P0 | — | En développement | D ✅ · C ❌ | E2E |
| MVT-07 | Jeter / périmé | Motifs, lots périmés d'abord | M1§7 | P0 | — | En développement | D ✅ · C ❌ | E2E |
| MVT-08 | Mouvement historisé complet | Id, date, utilisateur, type, produit, avant, après, motif, source | M1§6, M3§7 | P0 | — | En développement | D ✅ · S 🟡 · C ❌ | — |
| MVT-09 | Aucune modification silencieuse ni suppression d'historique | — | M1§6, M3§7 | P0 | — | Développé | D ✅ par conception, audit ✅ | Audit |
| MVT-10 | Journal qui / quoi / quand | Activités du foyer | M1§2, M1§6 | P0 | — | En développement | D ✅ · C ❌ | E2E |
| MVT-11 | Annulation et correction | Mouvements compensatoires, une seule fois | M3§7 | P0 | — | En développement | D ✅ · C ❌ | E2E |
| MVT-12 | Saisie manuelle toujours possible | — | M1§6, M2§1 | P0 | C | À développer | C ❌ | E2E |

## 11. Scanner

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| SCAN-01 | Lecture 1D et 2D | EAN, UPC, Code 128, ITF, QR, DataMatrix, DataBar (zxing-wasm) | M2§3 | P0 | C | À développer | ❌ | Images de test + appareils réels |
| SCAN-02 | Identification GTIN | Clé de contrôle, normalisation | M2§1 | P0 | — | En développement | D ✅ · C ❌ | — |
| SCAN-03 | Recherche Open Food / Beauty / Products Facts | Proxy serveur, cache, User-Agent, 60 req/min | M2§1 | P0 | — | En développement | D ✅ · S ✅ services.test (réponses au format réel, cache, User-Agent, bascule OBF/OPF, indisponibilité) · C ❌ | Intégration (réponses simulées) |
| SCAN-04 | Nom, marque, photo, catégorie, format | — | M2§1 | P0 | SCAN-03 | En développement | D ✅ · S 🟡 photo · C ❌ | — |
| SCAN-05 | Association au catalogue / produits existants | Catalogue local hors ligne | M2§1 | P0 | CAT-05 | En développement | D ✅ codes · C ❌ | E2E |
| SCAN-06 | Produits ménagers et d'hygiène | OBF, OPF, création rapide | M2§1 | P0 | SCAN-03 | En développement | S ✅ services.test (Open Beauty Facts) · C ❌ | — |
| SCAN-07 | Mode Réception | +1, lot créé/complété, péremption | M2§2, M2§5 | P0 | SCAN-01 | En développement | D ✅ · C ❌ | E2E |
| SCAN-08 | Mode Consommation | −1, FEFO | M2§2, M2§5 | P0 | SCAN-01 | En développement | D ✅ · C ❌ | E2E |
| SCAN-09 | Mode Inventaire | Comptage, écarts, confirmation | M2§2, M2§5 | P0 | INV-06 | En développement | D ✅ · C ❌ | E2E |
| SCAN-10 | Quantité par scan modifiable | 1 par défaut | M2§2 | P0 | SCAN-01 | À développer | C ❌ | E2E |
| SCAN-11 | Analyse GS1 | GTIN, lot, DDM, date limite, poids, Digital Link | M2§3 | P0 | — | En développement | D ✅ (analyse) · C ❌ (lecture caméra) | Codes réels |
| SCAN-12 | Jamais de date dans un EAN classique | — | M2§3 | P0 | — | En développement | D ✅ | — |
| SCAN-13 | Traitement immédiat, une seule question | — | M2§6 | P0 | SCAN-01 | À développer | C ❌ | E2E |
| SCAN-14 | Confirmation discrète + Annuler | « +1 produit ajouté » | M2§6 | P0 | MVT-11 | À développer | D ✅ annulation · C ❌ | E2E |
| SCAN-15 | Mode scan continu | — | M2§6 | P0 | SCAN-01 | À développer | C ❌ | E2E |
| SCAN-16 | Anti-doublon de scan | Anti-rebond 2,5 s + détection d'audit | M2§7, M3§7 | P0 | — | En développement | D ✅ détection · C ❌ anti-rebond | Unitaires + E2E |
| SCAN-17 | Erreurs, codes inconnus, non référencés | Messages clairs, création rapide | M2§7 | P0 | — | En développement | S ✅ services.test (invalide, inconnu, indisponible) · C ❌ | E2E |
| SCAN-18 | Hors connexion | Catalogue local | M2§7 | P0 | SYNC-05 | À développer | C ❌ | E2E hors ligne |

## 12. OCR des dates

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| OCR-01 | Proposition de photographier l'étiquette | Si pas de date dans le code | M2§4 | P1 | SCAN-07 | À développer | C ❌ | E2E |
| OCR-02 | Moteur OCR local | Tesseract.js + français auto-hébergés | M2§4 | P1 | — | À développer | ❌ | Images réelles |
| OCR-03 | Reconnaissance DLC / DDM | Mentions et formats | M2§4 | P1 | — | En développement | D ✅ (analyse du texte) | Corpus d'étiquettes |
| OCR-04 | Affichage + confirmation obligatoire | — | M2§4 | P1 | OCR-02 | À développer | C ❌ | E2E |
| OCR-05 | Source « reconnue et confirmée » | `expirySource = ocr` | M3§8 | P1 | — | En développement | D ✅ | — |

## 13. Inventaires

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| INV-01 | Assistant d'inventaire initial | Par espaces | M3§1 | P1 | — | En développement | D ✅ sessions · C ❌ | E2E |
| INV-02 | Scan à la chaîne dans l'assistant | — | M3§1 | P1 | SCAN-01 | À développer | C ❌ | E2E |
| INV-03 | Modifier quantités, emplacements, dates avant validation | — | M3§1 | P1 | — | En développement | D ✅ · C ❌ | E2E |
| INV-04 | Pourcentage d'avancement | — | M3§1 | P1 | — | En développement | D 🟡 (fonction non testée) · C ❌ | Unitaires |
| INV-05 | Sauvegarde partielle et reprise | Synchronisée | M3§1 | P1 | — | En développement | D ✅ · C ❌ | E2E |
| INV-06 | Comparaison théorique / compté | Par emplacement, confirmation | M2§5, M3§7 | P0 | — | En développement | D ✅ · C ❌ | E2E |
| INV-07 | Conflit si le stock change pendant l'inventaire | — | M3§7 | P0 | — | En développement | D ✅ · S ✅ week.test · C ❌ | Intégration |
| INV-08 | Produits inconnus à résoudre avant validation | — | M3§1 | P1 | — | En développement | D ✅ · C ❌ | E2E |

## 14. Liste de courses, mode courses, réception

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| SHOP-01 | Liste partagée synchronisée | — | M1§5 | P0 | SYNC-* | En développement | D ✅ · S 🟡 · C ❌ | E2E 2 membres |
| SHOP-02 | Ajout manuel | — | M1§5 | P0 | — | En développement | D ✅ · C ❌ | E2E |
| SHOP-03 | Ajout depuis le stock | — | M1§5 | P0 | — | En développement | D ✅ · C ❌ | E2E |
| SHOP-04 | Ajout depuis les recommandations | — | M1§5 | P0 | ENG-* | En développement | D ✅ · C ❌ | E2E |
| SHOP-05 | Quantités, commentaires, priorités, catégories | Avec conflits par champ | M1§5 | P0 | — | En développement | D ✅ · C ❌ | E2E |
| SHOP-06 | Attribution à un membre | — | M1§5 | P1 | — | En développement | D ✅ · C ❌ | E2E |
| SHOP-07 | Acheté / non acheté | — | M1§5 | P0 | — | En développement | D ✅ · C ❌ | E2E |
| SHOP-08 | Achats partiels | — | M1§5 | P0 | — | En développement | D ✅ · C ❌ | E2E |
| SHOP-09 | Suppression réversible | — | M1§5 | P0 | — | En développement | D ✅ · C ❌ | E2E |
| SHOP-10 | Historique de la liste | — | M1§5 | P1 | — | En développement | D ✅ données · C ❌ | E2E |
| SHOP-11 | Regroupement des doublons, addition multi-membres | Alias d'identifiant | M1§5 | P0 | — | En développement | D ✅ · S ✅ sync.test (deux membres hors ligne) · C ❌ | Intégration (2 appareils hors ligne) |
| SHOP-12 | Mode courses téléphone | Grandes cases, rayons, quantités, navigation simple | M1§5, M1§11 | P0 | C | À développer | C ❌ | E2E mobile |
| SHOP-13 | Mise à jour instantanée chez les autres | — | M1§5 | P0 | SYNC-04 | En développement | S 🟡 · C ❌ | E2E 2 navigateurs |
| SHOP-14 | Anti-doublon / stock suffisant à l'ajout | Avertissement | M1§4 | P1 | ENG-* | En développement | D ✅ · C ❌ | E2E |
| SHOP-15 | Répartition entre magasins | — | M3§5 | P1 | STORE-01 | En développement | D ✅ champ · C ❌ | E2E |
| SHOP-16 | Mode courses par magasin puis rayon | Ordre des rayons par magasin | M3§5 | P1 | SHOP-12 | En développement | D 🟡 champ · C ❌ | E2E |
| SHOP-17 | Écran maintenu allumé | Wake Lock | M1§11 | P2 | SHOP-12 | À développer | C ❌ | Manuel |
| RCV-01 | Proposition de mise à jour du stock après achat | — | M1§5 | P0 | SHOP-07 | À développer | C ❌ | E2E |
| RCV-02 | Étape de réception | Quantités réelles, écarts, prix, dates, emplacement | M1§5 | P0 | — | En développement | D ✅ · C ❌ | E2E |
| RCV-03 | Reliquat d'achat partiel conservé | — | M1§5 | P0 | — | En développement | D ✅ · C ❌ | — |
| RCV-04 | Article libre → produit suivi | — | AUD | P1 | — | En développement | D 🟡 (non testé) · C ❌ | Unitaires |

## 15. Tickets de caisse et magasins

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| TKT-01 | Photo ou import d'un ticket | — | M3§4 | P1 | OCR-02 | À développer | C ❌ | E2E |
| TKT-02 | Lecture magasin, date, lignes, quantités, prix, total, promotions | — | M3§4 | P1 | OCR-02 | En développement | D ✅ (analyse du texte) · OCR ❌ | Corpus de tickets réels |
| TKT-03 | Écran de validation, correspondances incertaines signalées | — | M3§4 | P1 | CAT-10 | En développement | D ✅ rapprochement · C ❌ | E2E |
| TKT-04 | Après validation : réceptions, prix, dépenses, produits inconnus | — | M3§4 | P1 | — | En développement | D ✅ · S 🟡 · C ❌ | Intégration |
| TKT-05 | Jamais de stock depuis un OCR non vérifié | — | M3§4 | P0 | — | En développement | D ✅ (case explicite par ligne) | E2E |
| TKT-06 | Apprentissage des libellés par magasin | — | M3§4 | P2 | — | En développement | D ✅ · C ❌ | — |
| STORE-01 | Magasins : nom, adresse, notes | — | M3§5 | P1 | — | En développement | D ✅ · C ❌ | E2E |
| STORE-02 | Historique des achats par magasin | — | M3§5 | P1 | BUD-01 | En développement | D ✅ données · C ❌ | E2E |
| STORE-03 | Produits habituellement achetés par magasin | — | M3§5 | P2 | — | À développer | ❌ | Unitaires |
| STORE-04 | Plusieurs magasins | Création, archivage | M1§10, M3§5 | P1 | — | En développement | D ✅ · C ❌ | — |

## 16. Moteur d'approvisionnement

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| ENG-01 | Quantités disponibles | Utilisable vs périmé | M1§4 | P0 | STK-01 | En développement | D ✅ · C ❌ | — |
| ENG-02 | Stocks faibles | Seuil minimal | M1§4 | P0 | — | En développement | D ✅ · C ❌ | — |
| ENG-03 | Ruptures | — | M1§4 | P0 | — | En développement | D ✅ · C ❌ | — |
| ENG-04 | Jours d'autonomie | — | M1§4 | P0 | ENG-05 | En développement | D ✅ · C ❌ | — |
| ENG-05 | Analyse de la consommation | Pondérée, ruptures exclues | M1§4 | P0 | — | En développement | D ✅ · C ❌ | — |
| ENG-06 | Produits achetés régulièrement | Cadence | M1§4 | P1 | — | En développement | D ✅ · C ❌ | — |
| ENG-07 | Prévision des réapprovisionnements | Date conseillée | M1§4 | P0 | — | En développement | D ✅ · C ❌ | — |
| ENG-08 | Quantités recommandées | Idéale, couverture, conditionnement | M1§4 | P0 | — | En développement | D ✅ · C ❌ | — |
| ENG-09 | Bientôt périmés, risque de gaspillage | — | M1§4 | P0 | — | En développement | D ✅ · C ❌ | — |
| ENG-10 | Éviter les achats en double | Liste déduite, « déjà prévu » | M1§4 | P0 | — | En développement | D ✅ · C ❌ | — |
| ENG-11 | Adaptation aux habitudes réelles | Pondération récente | M1§4 | P0 | — | En développement | D ✅ | — |
| ENG-12 | Explication compréhensible | Phrase + détail | M1§4 | P0 | — | En développement | D ✅ (texte de l'exemple vérifié) · C ❌ | — |
| ENG-13 | Niveaux de confiance | — | M1§4 | P0 | — | En développement | D ✅ · C ❌ | — |
| ENG-14 | Repli sur les seuils | Sans historique suffisant | M1§4 | P0 | — | En développement | D ✅ | — |
| ENG-15 | Jamais de consommation inventée | — | M1§4 | P0 | — | En développement | D ✅ | — |
| ENG-16 | Qualité des données prise en compte | — | M3§8 | P0 | REL-01 | En développement | D ✅ | — |
| ENG-17 | Coût estimé des recommandations | Prix connu/estimé/inconnu | M3§6 | P1 | BUD-14 | En développement | D ✅ · C ❌ | — |
| ENG-18 | Calcul côté serveur | Pour notifications et récapitulatifs | M3§9 | P1 | NOTIF-12 | Testé et validé | S ✅ services.test (récapitulatifs calculés côté serveur) | Intégration |

## 17. Péremption et anti-gaspillage

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| EXP-01 | Surveillance des dates | Statuts par lot | M1§7 | P0 | — | En développement | D ✅ · C ❌ | E2E |
| EXP-02 | Bientôt périmés | — | M1§7 | P0 | — | En développement | D ✅ · C ❌ | — |
| EXP-03 | À consommer rapidement | Priorité FEFO | M1§7 | P0 | — | En développement | D ✅ · C ❌ | — |
| EXP-04 | Périmés | — | M1§7 | P0 | — | En développement | D ✅ · C ❌ | — |
| EXP-05 | Produits ouverts | Conservation après ouverture | M1§7, M1§10 | P0 | — | En développement | D ✅ · C ❌ | — |
| EXP-06 | Produits oubliés | Sans mouvement depuis N jours | M1§7 | P1 | — | En développement | D 🟡 (calculé, non testé) · C ❌ | Unitaires |
| EXP-07 | Lots à date proche prioritaires | FEFO | M1§7 | P0 | STK-07 | En développement | D ✅ | — |
| EXP-08 | Tableau de bord anti-gaspillage | Pertes, valeur, produits jetés | M1§7 | P1 | — | En développement | D ✅ statistiques · C ❌ | E2E |
| EXP-09 | Distinction DLC / DDM | — | M2§4 | P1 | — | En développement | D ✅ · C ❌ | — |

## 18. Dépenses et budget

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| BUD-01 | Enregistrement des achats | Produit, quantité, prix, magasin, date, membre | M1§8 | P0 | — | En développement | D ✅ · S 🟡 · C ❌ | E2E |
| BUD-02 | Dépenses hebdomadaires | — | M1§8 | P1 | — | En développement | D ✅ · C ❌ | — |
| BUD-03 | Dépenses mensuelles | — | M1§8 | P1 | — | En développement | D ✅ · C ❌ | — |
| BUD-04 | Dépenses annuelles | — | M3§6 | P1 | — | En développement | D ✅ · C ❌ | — |
| BUD-05 | Par catégorie | — | M3§6 | P1 | — | En développement | D 🟡 (non testé) · C ❌ | Unitaires |
| BUD-06 | Par magasin | — | M3§6 | P1 | — | En développement | D 🟡 (non testé) · C ❌ | Unitaires |
| BUD-07 | Budget mensuel | — | M1§8 | P1 | HH-08 | En développement | D ✅ · C ❌ | — |
| BUD-08 | Budget prévisionnel / projection | Au rythme réel | M1§8 | P1 | — | En développement | D ✅ · C ❌ | — |
| BUD-09 | Produits les plus coûteux | — | M1§8, M3§6 | P1 | — | En développement | D 🟡 (non testé) · C ❌ | Unitaires |
| BUD-10 | Évolution des dépenses | Graphique interactif | M1§8 | P1 | UX-04 | En développement | D ✅ séries · C ❌ | — |
| BUD-11 | Évolution des prix | — | M3§6 | P2 | — | En développement | D ✅ · C ❌ | — |
| BUD-12 | Comparaison des prix par magasin | €/kg, €/L, €/unité | M1§8, M1§10 | P2 | — | En développement | D ✅ · C ❌ | — |
| BUD-13 | Budget moyen et panier moyen | — | M3§6 | P2 | — | En développement | D ✅ · C ❌ | — |
| BUD-14 | Coût estimé des prochains achats | Connu / estimé / inconnu | M3§6 | P1 | — | En développement | D ✅ · C ❌ | — |
| BUD-15 | Aucun prix inventé | — | M1§8, M3§6 | P0 | — | En développement | D ✅ | — |
| BUD-16 | Historique des achats | — | M1§8 | P1 | — | En développement | D ✅ données · C ❌ | E2E |
| BUD-17 | Dépenses inhabituelles | Détection | M3§9 | P2 | — | En développement | D 🟡 (non testé) | Unitaires |

## 19. Tableau de bord

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| DASH-01 | Indicateurs clés | Produits, faibles, épuisés, à acheter, bientôt périmés | M1§9 | P1 | ENG-* | À développer | D ✅ données · C ❌ | E2E |
| DASH-02 | Liste de courses actuelle | — | M1§9 | P1 | SHOP-01 | À développer | C ❌ | E2E |
| DASH-03 | Derniers mouvements | — | M1§9 | P1 | MVT-10 | À développer | C ❌ | E2E |
| DASH-04 | Dépenses du mois | Avec budget | M1§9 | P1 | BUD-07 | À développer | C ❌ | E2E |
| DASH-05 | Prévisions d'approvisionnement | — | M1§9 | P1 | ENG-07 | À développer | C ❌ | E2E |
| DASH-06 | « Ce que votre maison doit prévoir » | Synthèse des recommandations | M1§9 | P1 | ENG-* | À développer | D ✅ · C ❌ | E2E |
| DASH-07 | Personnalisation | Widgets masquables, réordonnables, par membre | M1§9 | P2 | — | En développement | D ✅ préférences · C ❌ | E2E |

## 20. Notifications

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| NOTIF-01 | Centre de notifications | — | M3§9 | P1 | — | En développement | D ✅ · C ❌ | E2E |
| NOTIF-02 | Stocks critiques | — | M3§9 | P1 | — | En développement | D ✅ | — |
| NOTIF-03 | Produits épuisés | — | M3§9 | P1 | — | En développement | D ✅ | — |
| NOTIF-04 | Bientôt périmés | — | M3§9 | P1 | — | En développement | D ✅ | — |
| NOTIF-05 | Produits à acheter | — | M3§9 | P1 | — | En développement | D ✅ | — |
| NOTIF-06 | Courses non terminées | Achetés non réceptionnés | M3§9 | P1 | — | En développement | D 🟡 (non testé) | Unitaires |
| NOTIF-07 | Modifications importantes | Par d'autres membres | M3§9, M1§2 | P1 | — | En développement | S ✅ services.test (alerte immédiate des autres membres) · C ❌ | Intégration |
| NOTIF-08 | Dépenses inhabituelles | — | M3§9 | P2 | BUD-17 | En développement | D 🟡 | Unitaires |
| NOTIF-09 | Inventaires à vérifier | — | M3§9 | P1 | REL-01 | En développement | D 🟡 | Unitaires |
| NOTIF-10 | Personnalisation par membre | Types, alertes masquées | M3§9 | P1 | — | En développement | D ✅ · C ❌ | E2E |
| NOTIF-11 | Déduplication | Clé stable, journal d'envoi | M3§9 | P1 | — | En développement | D ✅ · S ✅ services.test (un envoi par jour et par membre) · C ❌ | Intégration |
| NOTIF-12 | Récapitulatif quotidien / hebdomadaire | Web Push à l'heure choisie | M3§9 | P2 | NOTIF-13 | En développement | S ✅ services.test (heure choisie, préférences, anti-doublon ; défaut d’heure corrigé) · C ❌ service worker | Intégration (envoi simulé) |
| NOTIF-13 | Web Push | VAPID local, iPhone (PWA installée), Android, PC | M3§9 | P2 | FND-06 | En développement | S ✅ · C 🟡 service worker (réception, clic) + abonnement dans Paramètres ; essais sur appareils réels à faire | Manuel sur appareils |
| NOTIF-14 | Fil d'activité partagé du foyer | « Notifications partagées » | M1§2 | P1 | MVT-10 | En développement | D ✅ · C ❌ | E2E |

## 21. Niveaux de fiabilité et cohérence

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| REL-01 | Fiabilité des quantités | Comptée, scannée, saisie, approximative, calculée | M3§8 | P0 | — | En développement | D ✅ · C ❌ | — |
| REL-02 | Fiabilité des dates | GS1, saisie, OCR confirmée, estimée, inconnue | M3§8 | P0 | — | En développement | D ✅ · C ❌ | — |
| REL-03 | Fiabilité de la consommation | Observée / achats / manuelle / aucune + confiance | M3§8 | P0 | — | En développement | D ✅ · C ❌ | — |
| REL-04 | Fiabilité des prix | Connu / estimé / inconnu | M3§6 | P0 | — | En développement | D ✅ · C ❌ | — |
| REL-05 | Affichage clair des incertitudes | Jamais une estimation présentée comme exacte | M3§8 | P0 | C | À développer | C ❌ | E2E + revue |
| REL-06 | Moteur tenant compte de la qualité | — | M3§8 | P0 | — | En développement | D ✅ | — |
| AUD-01 | Quantité négative, Σ mouvements ≠ lot, arithmétique | — | M3§7 | P0 | — | En développement | D ✅ · S 🟡 · C ❌ | — |
| AUD-02 | Produit ajouté deux fois / doublons | — | M3§7 | P0 | — | En développement | D ✅ | — |
| AUD-03 | Mouvements identiques rapprochés | — | M3§7 | P0 | — | En développement | D ✅ | — |
| AUD-04 | Écart théorique / physique | — | M3§7 | P0 | INV-06 | En développement | D ✅ | — |
| AUD-05 | Consommation sur stock nul | — | M3§7 | P0 | — | En développement | D ✅ | — |
| AUD-06 | Dates incohérentes | Avant l'achat, > 10 ans, dépassée à réception | M3§7 | P1 | — | En développement | D 🟡 (non testé) | Unitaires |
| AUD-07 | Contrôle d'intégrité serveur | SQLite + règles métier | M1§12 | P0 | — | Testé et validé | S ✅ week.test (contrôle chaque soir), data.test | Intégration |
| AUD-08 | Interface de contrôle et de correction | — | M3§7 | P1 | C | À développer | C ❌ | E2E |

## 22. Sauvegardes, export, import

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| BAK-01 | Sauvegardes automatiques | Quotidiennes + avant opérations sensibles | M1§12, M3§10 | P0 | — | Testé et validé | S ✅ sauvegarde automatique créée au démarrage réel ; data.test | Intégration |
| BAK-02 | Versions et rotation | 14 jours + 12 mois | M3§10 | P0 | BAK-01 | Testé et validé | S ✅ data.test (rotation) | Unitaires (rotation) |
| BAK-03 | Vérification de chaque sauvegarde | integrity_check, FK, lecture | M3§10 | P0 | BAK-01 | Testé et validé | S ✅ data.test (fichier corrompu détecté ; un seul fichier autonome) | Intégration (fichier corrompu) |
| BAK-04 | Restauration complète | Sauvegarde préalable, nouvelle époque | M3§10 | P0 | BAK-03 | Testé et validé | S ✅ data.test (restauration complète réservée à l’hébergeur, sauvegarde préalable, nouvelle époque) | Intégration |
| BAK-05 | Restauration d'un seul foyer | Sans affecter les autres familles | M4, C7 | P0 | BAK-03 | En développement | S ✅ data.test (un foyer restauré, l’autre intact) · C ❌ | Intégration |
| BAK-06 | Export complet JSON | Avec photos | M1§12, M3§10 | P0 | — | En développement | S ✅ data.test (aller-retour, photos) · C ❌ | Aller-retour |
| BAK-07 | Export CSV | Inventaire, achats, mouvements | M1§12 | P1 | — | En développement | S ✅ data.test (BOM, séparateur « ; ») · C ❌ | Intégration |
| BAK-08 | Import complet | Nouveau foyer, identifiants régénérés | M1§12, M3§10 | P0 | — | En développement | S ✅ data.test + isolation.test (identifiants régénérés) · C ❌ | Aller-retour |
| BAK-09 | Preuve de restauration | Sauvegarde → restauration → données identiques | M3§10 | P0 | BAK-04 | Testé et validé | S ✅ data.test « PREUVE : sauvegarde → modifications → restauration → données identiques » | — |
| BAK-10 | Interface sauvegardes / export / import | — | M1§12 | P1 | C | À développer | C ❌ | E2E |
| BAK-11 | Export ≠ sauvegarde automatique | Les deux existent et sont distingués | M3§10 | P0 | — | Testé et validé | Documenté (MASTER_SPEC §14.2) ; sauvegardes automatiques et exports distincts et testés | — |

## 23. Design et expérience utilisateur

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| UX-01 | Design haut de gamme non générique | — | M1§11 | P0 | — | En développement | C 🟡 design system (lin & forêt), coquille et écrans des phases 1-2 vérifiés en captures | Revue visuelle (captures) |
| UX-02 | Typographie, hiérarchie, couleurs, cartes, icônes | — | M1§11 | P0 | UX-01 | En développement | C 🟡 typographie Manrope, cartes, icônes Lucide — en cours | Revue |
| UX-03 | Animations subtiles | — | M1§11 | P1 | — | À développer | ❌ | Revue |
| UX-04 | Graphiques interactifs | — | M1§11 | P1 | — | À développer | ❌ | E2E |
| UX-05 | Mode clair et sombre | — | M1§11 | P0 | — | En développement | C ✅ thème clair/sombre/auto (captures vérifiées) ; à étendre aux modules suivants | Captures |
| UX-06 | Optimisation téléphone | — | M1§11 | P0 | — | En développement | C 🟡 mobile d’abord (onglets, feuilles, cibles ≥ 44 px) — en cours | E2E mobile |
| UX-07 | Navigation 6 rubriques | Accueil, Inventaire, Courses, Prévisions, Famille, Paramètres | M1§11 | P0 | — | En développement | C ✅ navigation 6 rubriques + Scanner ; Inventaire, Courses, Prévisions en construction | E2E |
| UX-08 | Mode courses optimisé magasin | — | M1§11 | P0 | SHOP-12 | À développer | ❌ | E2E mobile |
| UX-09 | Scanner accessible partout | — | M2 | P0 | SCAN-01 | À développer | ❌ | E2E |
| UX-10 | Accessibilité | Contrastes, cibles ≥ 44 px | AUD | P1 | — | À développer | ❌ | Audit axe |
| UX-11 | Chaque bouton fonctionne | — | M1§12 | P0 | — | À développer | ❌ | E2E exhaustif |
| UX-12 | Gestion des erreurs lisible | Messages français, pas d'écran blanc | M1§12 | P0 | — | En développement | D/S ✅ messages · C ❌ | E2E |

## 24. Fonctionnalités avancées

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| ADV-01 | Recettes | Ingrédients liés aux produits | M1§10 | P3 | CAT-01 | En développement | D 🟡 (créer/cuisiner, non testé) · C ❌ | Unitaires + E2E |
| ADV-02 | Recettes réalisables avec le stock | — | M1§10 | P3 | ADV-01 | À développer | ❌ | Unitaires |
| ADV-03 | Ingrédients manquants → liste | — | M1§10 | P3 | ADV-01 | À développer | ❌ | Unitaires |
| ADV-04 | Planification des repas | — | M1§10 | P4 | ADV-01, D5 | Reporté | À spécifier (D5) | — |
| ADV-05 | Gestion des restes | — | M1§10 | P4 | D5 | Reporté | À spécifier (D5) | — |
| ADV-06 | Tâches ménagères | — | M1§10 | P4 | D5 | Reporté | À spécifier (D5) | — |
| ADV-07 | Suggestions périodiques de réapprovisionnement | À partir de la cadence | M1§10 | P3 | ENG-06 | À développer | D ✅ cadence · ❌ suggestions | Unitaires |
| ADV-08 | Chiffrement de bout en bout | Confidentialité vis-à-vis de l'hébergeur | AUD (D4) | P4 | D4 | Reporté | Incompatible avec le moteur côté serveur | — |
| ADV-09 | PostgreSQL + RLS (option) | Pour de grandes instances | M4§6 (C8) | P4 | — | Reporté | — | — |

## 25. Tests, documentation, déploiement

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| TST-01 | Tests unitaires du domaine | — | M1§12 | P0 | — | Testé et validé | 76 tests verts (unités, commandes, moteur, GS1, OCR, statistiques, audit, notifications, semaine) | — |
| TST-02 | Tests d'intégration serveur | Comptes, foyers, sync, idempotence, concurrence, conflits | M1§12 | P0 | — | Testé et validé | `server/test/*.test.ts` : 59 tests (comptes, foyers, sync, isolation, données, services, semaine) | — |
| TST-03 | Tests d'isolation multi-foyers | Scénario A1/A2/B1/B2 | M4§8 | P0 | ISO-* | Testé et validé | = ISO-08 | — |
| TST-04 | Semaine familiale simulée | Domaine ✅ ; pile complète (2 membres, 2 appareils, hors ligne) ❌ | M3§11 | P0 | SYNC-* | En développement | Domaine ✅ (shared/test/week.test.ts) · pile serveur ✅ (server/test/week.test.ts : 3 appareils, hors ligne, renvois) · interface ❌ | — |
| TST-05 | Tests de bout en bout | Parcours, temps réel, hors ligne, mobile, chaque bouton | M1§12 | P0 | C | En développement | `e2e/foundations.spec.ts` : 6 parcours (temps réel, hors ligne, bascule, retrait, lecture seule, démarrage sans réseau) | — |
| TST-06 | Audit global | Cohérence, simplicité, design, rapidité… | M3§11 | P0 | — | En développement | 1er audit fait (PROJECT_PLAN §1) ; à refaire à chaque phase | — |
| DOC-01 | PROJECT_PLAN.md | — | M1§13, M5 | P0 | — | Développé | Version 2.1 (phase 1) | — |
| DOC-02 | MASTER_SPEC.md | — | M5 | P0 | — | Développé | Créé | — |
| DOC-03 | FEATURE_TRACKER.md | — | M5 | P0 | — | Développé | Ce document | — |
| DOC-04 | Guide de déploiement gratuit | Docker, Raspberry Pi/NAS, Tailscale/Cloudflare | M1§1 | P0 | DEP-01 | À développer | ❌ | Installation réelle |
| DOC-05 | Guide utilisateur | Pour transmettre l'application à d'autres familles | M4§9 | P1 | — | À développer | ❌ | — |
| DEP-01 | Image Docker / compose | — | M1§1 | P0 | — | Développé | Dockerfile + docker-compose écrits ; construction de l’image impossible ici (Docker Hub : 429 trop de requêtes) ; disposition de production vérifiée hors conteneur (dépendances de production seules, démarrage, application servie) | Démarrage du conteneur |
| DEP-02 | Script de réinitialisation de mot de passe | Côté serveur | M4§1 | P1 | D2 | Testé et validé | CLI `lien-reinitialisation`, `utilisateurs`, `sauvegarde` exécutée réellement | — |

---

## Synthèse des statuts

| Statut | Nombre |
|---|---|
| Testé et validé | 56 |
| Développé | 26 |
| En développement | 173 |
| À développer | 37 |
| À spécifier | 0 |
| Reporté | 5 |
| Bloqué | 0 |
| **Total** | **297** |

*(Calculé automatiquement à partir des lignes du tableau.)*
