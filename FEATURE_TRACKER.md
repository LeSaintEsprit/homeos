# HOMEOS — Matrice de traçabilité (FEATURE_TRACKER)

> État **réel et vérifié** de chaque fonctionnalité. Référence fonctionnelle : `MASTER_SPEC.md`. Organisation : `PROJECT_PLAN.md`.
> Dernière mise à jour : 18/11/2026 — fin de la phase 15 (fonctionnalités avancées).

## Légende

**Statuts** : `À spécifier` · `À développer` · `En développement` · `Développé` · `Testé et validé` · `Bloqué` · `Reporté`.

Règle (R11) : une fonctionnalité visible par l'utilisateur n'est « Testée et validée » que si **toutes ses couches** existent et que son fonctionnement réel a été vérifié (tests automatisés + parcours de bout en bout). Une interface seule ne compte pas, une logique seule non plus.

**Avancement par couche** : **D** = domaine partagé (`packages/shared`) · **S** = serveur/API (`packages/server`) · **C** = client/interface (`packages/web`) · **T** = tests.
✅ fait et vérifié par des tests · 🟡 écrit mais non vérifié (ou vérifié partiellement) · ❌ absent · — sans objet.

**Priorités** : P0 Indispensable · P1 Importante · P2 Complémentaire · P3 Avancée · P4 Future.
**Origine** : M1 cahier initial · M2 scanner · M3 enrichissement · M4 multi-foyers · M5 consolidation · AUD constat de l'audit.

**Constat global (fin de phase 15)** : 180 tests unitaires/intégration et 70 parcours de bout en bout ; semaine familiale complète par l'interface, robot « chaque bouton » (24 écrans), accessibilité WCAG 2.1 AA, performances sur un gros foyer, licences contrôlées, image Docker vérifiée depuis zéro, recettes et suggestions périodiques. Restent : essais sur appareils réels (iPhone, Android, ordinateur), mise en ligne sur le serveur gratuit, et quelques finitions listées « En développement ».

---

## 1. Fondations et contraintes

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| FND-01 | Budget 0 € | Aucune dépendance payante indispensable | M1§1, M3§12, M5§5 | P0 | — | Testé et validé | Audit automatique `node scripts/check-licenses.mjs` : 170 dépendances livrées, toutes libres et gratuites ; aucun service payant ni clé requise | — |
| FND-02 | Open source | Technologies libres privilégiées | M1§1 | P0 | — | Testé et validé | Même audit : MIT, Apache-2.0, ISC, BSD, OFL, MIT-0 uniquement (outils de test exclus de la livraison) ; licence du projet à choisir (D6) | — |
| FND-03 | Vérification des services gratuits | Limites vérifiées avant intégration | M1§1 | P0 | — | Testé et validé | Supabase écarté (pas de sauvegarde, pause 7 j) ; OFF : 100 req/min, User-Agent, testé sur une fiche réelle ; Cloudflare Tunnel gratuit ≤ 50 utilisateurs | — |
| FND-04 | Sans IA générative | Règles déterministes, statistiques | M1§4, M3§12, M5§5 | P0 | — | Testé et validé | Moteur purement algorithmique (règles, moyennes, médianes) ; audit des dépendances : aucune bibliothèque ni service d’IA générative ; OCR Tesseract (reconnaissance de caractères) | — |
| FND-05 | Interface en français | Tous les textes en français | M1§1 | P0 | UX | Testé et validé | Tous les écrans en français · E2E `a11y.spec` : aucun libellé anglais courant ni texte technique sur 22 écrans, thèmes clair et sombre ; robot « chaque bouton » sur 24 écrans et leurs fenêtres | — |
| FND-06 | PWA installable | Installation PC/iPhone/Android, cache hors ligne | M1§1, M4§7 | P0 | C | Développé | C ✅ manifeste, icônes, service worker ; démarrage sans réseau vérifié (`e2e/foundations.spec.ts`) · installation sur appareil réel non vérifiée ici | Lighthouse PWA, installation réelle |
| FND-07 | Architecture monorepo partagée | Même logique métier client/serveur | M1§12 | P0 | — | Testé et validé | D ✅ S ✅ — logique partagée exécutée côté serveur (toutes les suites serveur) | — |

## 2. Comptes utilisateurs

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| ACC-01 | Inscription | Compte personnel (e-mail, mot de passe, nom) | M1§2, M4§1 | P0 | ACC-11 | Testé et validé | S ✅ auth.test · C ✅ `e2e/foundations.spec.ts` | Intégration + E2E |
| ACC-02 | Connexion | Session par cookie sécurisé | M4§1 | P0 | — | Testé et validé | S ✅ · C ✅ · E2E `accounts.spec` : connexion, mauvais mot de passe expliqué, retour sur son foyer | — |
| ACC-03 | Déconnexion | Suppression de la session | M4§1 | P0 | — | Testé et validé | S ✅ · C ✅ · E2E : déconnexion confirmée, bases locales effacées (vérifié dans IndexedDB). Défaut corrigé : la déconnexion ne se terminait jamais (base locale encore ouverte) | — |
| ACC-04 | Récupération du mot de passe | Lien à usage unique / SMTP facultatif / commande serveur | M4§1 | P0 | D2 | Testé et validé | S ✅ · CLI ✅ · C ✅ · E2E : page « mot de passe oublié » sans serveur d’e-mail, lien généré par l’hébergeur, nouveau mot de passe, lien à usage unique | — |
| ACC-05 | Gestion du profil | Nom, couleur, préférences | M1§2, M4§1 | P0 | — | Testé et validé | S ✅ · C ✅ · E2E : nom affiché modifié, vu par l’autre membre | — |
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
| HH-09 | Suppression d'un foyer | Double confirmation + sauvegarde préalable | AUD | P1 | BAK-01 | Testé et validé | S ✅ households.test · C ✅ Paramètres › Données : nom exact exigé, sauvegarde préalable, bascule sur un autre foyer ; récupérable seul par l’hébergeur (data.test) · `e2e/data.spec.ts` | Intégration |
| HH-10 | Nombre illimité de foyers | Une instance, plusieurs familles | M4 | P0 | ISO-* | Testé et validé | S ✅ isolation.test · C ✅ création, import et restauration créent autant de foyers que voulu, sélecteur de foyer · `e2e/data.spec.ts` · `e2e/foundations.spec.ts` | Tests d'isolation |

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
| MEM-08 | Droits membre | Stocks, produits, scans, liste, achats, statistiques | M4§4 | P0 | MEM-06 | Testé et validé | D ✅ · S ✅ · C ✅ actions réservées masquées · E2E : un membre ne voit ni restauration ni suppression du foyer ; lecture seule sans aucune action | — |
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
| MULTI-05 | Aucun mélange (listes, stocks, notifications) | Y compris notifications push | M4§5 | P0 | NOTIF-* | Testé et validé | S ✅ · C ✅ · E2E `multihousehold.spec` : stocks, liste, prévisions, alertes, cloche et dépenses d’un foyer jamais visibles dans l’autre ; notifications push nommées et étiquetées par foyer (services.test) | — |

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
| ISO-10 | Transparence vis-à-vis de l'hébergeur | Information des foyers hébergés | AUD | P1 | D4 | Testé et validé | C ✅ Paramètres › Mes données personnelles : l’hébergeur peut techniquement accéder à la base, données séparées par foyer, seuls échanges extérieurs (codes-barres inconnus vers Open Food Facts, notifications chiffrées) · E2E `accounts.spec` | — |
| ISO-11 | En-têtes de sécurité, CSP, anti-CSRF | — | M3§10 | P0 | — | Testé et validé | S ✅ auth.test (CSRF) ; en-têtes présents sur toutes les réponses | Intégration |

## 7. Synchronisation et hors ligne

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| SYNC-01 | Opérations idempotentes | `opId`, résultat enregistré atomiquement | M1§12, M3§7 | P0 | — | Testé et validé | S ✅ sync.test (rejeu, rejet mémorisé), week.test (renvois réseau) | Rejeu, coupure réseau |
| SYNC-02 | Succès seulement après confirmation | Outbox persistante | M1§12 | P0 | SYNC-05 | Testé et validé | S ✅ · C ✅ `e2e/foundations.spec.ts` (en attente hors ligne → confirmé au retour ; envoi refusé par le serveur → rien de visible chez l’autre membre tant que non confirmé) | Intégration + E2E |
| SYNC-03 | Pull incrémental paginé | Curseur `seq` | M1§12 | P0 | — | Testé et validé | S ✅ sync.test (pagination, pierres tombales, curseur) | Pagination, pierres tombales |
| SYNC-04 | Temps réel | SSE + repli périodique | M1§5 | P0 | — | Testé et validé | S ✅ · C ✅ `e2e/foundations.spec.ts` (arrivée d’un membre, renommage vus en direct) | Intégration + E2E 2 membres |
| SYNC-05 | Réplique locale + prédiction | IndexedDB par foyer, même logique métier | M1§1 | P0 | D | Testé et validé | D ✅ · C ✅ une action n’est affichée qu’après son écriture dans la base locale : rechargement immédiat sans perte (`e2e/foundations.spec.ts`) | Unitaires + E2E |
| SYNC-06 | Hors connexion | App + données + file d'attente | M1§1, M3§10 | P0 | SYNC-05 | Testé et validé | C ✅ `e2e/foundations.spec.ts` (modification hors ligne ; ouverture de l’application sans réseau) | E2E hors ligne |
| SYNC-07 | Conflits | Par champ, stock attendu, fusion, alias | M1§12 | P0 | — | Testé et validé | D/S ✅ · C ✅ conflit signalé, saisie en cours préservée, choix « Garder ma valeur » / « Garder l'autre » dans le volet de synchronisation · E2E `shopping.spec` | — |
| SYNC-08 | Indicateur de synchronisation | Synchronisé / en attente / hors ligne / problème | M1§12 | P0 | SYNC-02 | Testé et validé | C ✅ `e2e/foundations.spec.ts` (état synchronisé / hors ligne) | E2E |
| SYNC-09 | Connexions simultanées | Transactions sérialisées | M1§12 | P0 | — | Testé et validé | S ✅ sync.test (consommations simultanées), week.test | Concurrence |
| SYNC-10 | Resynchronisation après restauration | Changement d'époque | M3§10 | P0 | BAK-04 | Testé et validé | S ✅ · C ✅ · E2E `data.spec` : restauration complète puis resynchronisation des appareils | — |
| SYNC-11 | iPhone, Android, Windows, navigateurs | — | M4§7 | P0 | C | En développement | Chromium (ordinateur et mobile émulé) ✅ ; WebKit/Safari iPhone indisponible dans cet environnement de test : à vérifier sur appareil | E2E (WebKit, Chromium, mobile) |
| SYNC-12 | Purge locale d'un foyer quitté | — | M4§8, AUD | P0 | MEM-11 | Testé et validé | C ✅ `e2e/foundations.spec.ts` (retrait) ; déconnexion et foyer quitté purgent aussi | E2E |
| SYNC-13 | Rétention des opérations traitées | Purge sûre de `processed_ops` | AUD | P2 | — | Testé et validé | S ✅ refus des opérations trop anciennes ; purge quotidienne testée (sync.test) : seules les opérations hors délai sont oubliées, et leur rejeu est refusé, jamais réappliqué | — |

## 8. Catalogue

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| CAT-01 | Fiche produit complète | Tous les champs de M1§3 | M1§3 | P0 | — | Testé et validé | D/S ✅ · C ✅ formulaire complet (création/modification) · `e2e/inventory.spec.ts` | E2E |
| CAT-02 | Catégories personnalisables | 9 par défaut | M1§3 | P0 | — | Développé | D ✅ · C ✅ Paramètres → Catalogue (même composant que les emplacements, testé) | E2E |
| CAT-03 | Emplacements personnalisables | 9 par défaut dont Cuisine | M1§3, M3§1 | P0 | — | Testé et validé | D ✅ · C ✅ `e2e/inventory.spec.ts` (nouvel emplacement disponible dans les fiches) | E2E |
| CAT-04 | Photo facultative | Redimensionnée côté client, isolée | M1§3 | P1 | — | Développé | S ✅ · C ✅ photo redimensionnée (640 px) puis envoyée ; affichée et mise en cache hors ligne — non couverte E2E | Intégration |
| CAT-05 | Plusieurs codes-barres par produit | Avec format, marque, quantité par scan | M3§3 | P0 | — | Testé et validé | D ✅ · C ✅ · E2E `catalog.spec` : deux codes pour un produit, recherche par code | — |
| CAT-06 | Formats d'emballage | Conditionnement (1 paquet = 500 g) | M3§3 | P0 | — | Développé | D ✅ · C ✅ « Conditionnement d’achat » + saisie dans l’unité de conditionnement | — |
| CAT-07 | Variantes | Famille de produits | M3§3 | P2 | — | Développé | D ✅ · C ✅ champ « Famille (variantes) » ; utilisé pour proposer les doublons | E2E |
| CAT-08 | Marques différentes | Marque par code | M3§3 | P1 | CAT-05 | En développement | D ✅ · C 🟡 marque du produit ; marque par code via le scanner (phase 4) | — |
| CAT-09 | Produits personnalisés | Sans code-barres | M3§3 | P0 | — | Testé et validé | D ✅ · C ✅ `e2e/inventory.spec.ts` (produits sans code-barres) | — |
| CAT-10 | Alias et noms alternatifs | Dont libellés de tickets appris | M3§3 | P1 | — | Testé et validé | D ✅ · C ✅ · E2E : nom alternatif retrouvé par la recherche | — |
| CAT-11 | Détection des doublons probables | Sans fusion automatique | M3§3, M1§12 | P0 | — | Testé et validé | D ✅ · C ✅ `e2e/inventory.spec.ts` (alerte à la saisie, aucune fusion automatique) | — |
| CAT-12 | Fusion validée | Conserve l'historique, conversion vérifiée | M3§3 | P1 | CAT-11 | Testé et validé | D ✅ · S ✅ · C ✅ · E2E : fusion après confirmation, stocks additionnés, ancien nom retrouvable | — |
| CAT-13 | Validation d'identité incertaine | Question lors du scan | M3§3, M2§1 | P0 | SCAN-05 | Développé | C ✅ « Est-ce l’un de vos produits ? » (association explicite, jamais automatique) — non couvert E2E | E2E |
| CAT-14 | Archivage / restauration | — | AUD | P1 | — | Testé et validé | D ✅ · C ✅ · E2E : archivé → masqué, listé dans « Produits archivés », restauré avec son stock. Défaut corrigé : la fiche d’un produit archivé avec stock plantait | — |
| CAT-15 | Magasin habituel | Par produit | M1§3 | P1 | STORE-01 | Développé | D ✅ · C ✅ | — |
| CAT-16 | Commentaires | — | M1§3 | P1 | — | Développé | D ✅ · C ✅ | — |
| CAT-17 | Consommation moyenne affichée | Calculée, avec sa source | M1§3 | P0 | ENG-05 | Développé | D ✅ · C ✅ carte « Analyse » (débit, source, confiance, autonomie) — à vérifier avec historique réel (phase 6) | E2E |
| CAT-18 | Historique des mouvements par produit | — | M1§3 | P0 | MVT-08 | Testé et validé | D ✅ · C ✅ `e2e/inventory.spec.ts` (historique par action, auteur, avant → après, motif) | E2E |

## 9. Stocks, lots, unités

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| STK-01 | Lots multiples | Quantités et dates différentes | M1§3, M1§7 | P0 | — | Testé et validé | D ✅ · C ✅ `e2e/inventory.spec.ts` (lots distincts, dates, sources) | E2E |
| STK-02 | Quantités partielles | 0,5 bouteille, 250 g, 300 ml, 1,5 kg | M3§2 | P0 | — | Testé et validé | D ✅ · C ✅ `e2e/inventory.spec.ts` (0,5 bouteille) | E2E |
| STK-03 | Quantité approximative | « Environ la moitié » | M3§2, M3§8 | P0 | — | Testé et validé | D ✅ · C ✅ `e2e/inventory.spec.ts` (« ≈ 1,5 bouteille » affiché partout) | — |
| STK-04 | Unités et conversions | g/kg, ml/cl/L, comptage, conditionnements | M1§3, M3§2 | P0 | — | Développé | D ✅ · C ✅ choix des unités compatibles dans chaque action | — |
| STK-05 | Aucune conversion incompatible | Sans information fiable | M3§2 | P0 | — | En développement | D ✅ · S 🟡 | Intégration |
| STK-06 | Quantités achetée / initiale / restante / consommée | Distinction affichée | M3§2 | P1 | — | En développement | D 🟡 · C 🟡 restante / initiale affichées par lot ; consommée et achetée à exposer | Unitaires + E2E |
| STK-07 | FEFO | Date la plus proche, ouverts d'abord | M1§7, M2§5 | P0 | — | Testé et validé | D ✅ · C ✅ sélection automatique « date la plus proche d’abord » ou lot choisi | — |
| STK-08 | Jamais de stock négatif | Base + domaine | M1§12, M3§7 | P0 | — | Testé et validé | D ✅ · S ✅ contrainte CHECK + sync.test (jamais négatif sous concurrence) | Intégration (tentative directe) |
| STK-09 | Emplacement par lot, déplacement partiel | — | M1§3 | P1 | — | Testé et validé | D ✅ · C ✅ · E2E : déplacement partiel, lot scindé entre deux emplacements, total inchangé | — |

## 10. Mouvements et actions rapides

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| MVT-01 | Ajouter au stock | — | M1§6 | P0 | — | Testé et validé | D/S ✅ · C ✅ stock initial et action « Ajouter » (achat facultatif, prix, magasin, date) · `e2e/inventory.spec.ts` | E2E |
| MVT-02 | Retirer / consommer | — | M1§6 | P0 | — | Testé et validé | D/S ✅ · C ✅ `e2e/inventory.spec.ts` (feuille et « −1 » rapide) | E2E |
| MVT-03 | Déclarer terminé | Avec ajout facultatif à la liste | M1§6 | P0 | SHOP-01 | Testé et validé | D ✅ · C ✅ · E2E : stock à zéro et article ajouté à la liste | — |
| MVT-04 | Signaler manquant | Ajout prioritaire à la liste, stock inchangé | M1§6 | P0 | SHOP-01 | Testé et validé | D ✅ · C ✅ · E2E : stock enregistré inchangé, article en priorité haute dans la liste | — |
| MVT-05 | Modifier une quantité | Motif obligatoire, contrôle de concurrence | M1§6 | P0 | — | Testé et validé | D ✅ · C ✅ `e2e/inventory.spec.ts` (quantité réelle, approximative, motif) | E2E |
| MVT-06 | Signaler ouvert | Isolement de l'unité ouverte | M1§6 | P0 | — | Testé et validé | D ✅ · C ✅ `e2e/inventory.spec.ts` (unité ouverte isolée) | E2E |
| MVT-07 | Jeter / périmé | Motifs, lots périmés d'abord | M1§7 | P0 | — | Testé et validé | D ✅ · C ✅ `e2e/inventory.spec.ts` | E2E |
| MVT-08 | Mouvement historisé complet | Id, date, utilisateur, type, produit, avant, après, motif, source | M1§6, M3§7 | P0 | — | Testé et validé | D ✅ · C ✅ `e2e/inventory.spec.ts` | — |
| MVT-09 | Aucune modification silencieuse ni suppression d'historique | — | M1§6, M3§7 | P0 | — | Développé | D ✅ par conception, audit ✅ | Audit |
| MVT-10 | Journal qui / quoi / quand | Activités du foyer | M1§2, M1§6 | P0 | — | Testé et validé | D ✅ · C ✅ historique par produit (`e2e/inventory.spec.ts`) et journal du foyer (Famille) | E2E |
| MVT-11 | Annulation et correction | Mouvements compensatoires, une seule fois | M3§7 | P0 | — | Testé et validé | D ✅ · C ✅ `e2e/inventory.spec.ts` (« Annuler » dans la notification et dans l’historique) | E2E |
| MVT-12 | Saisie manuelle toujours possible | — | M1§6, M2§1 | P0 | C | Testé et validé | C ✅ `e2e/inventory.spec.ts` | E2E |

## 11. Scanner

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| SCAN-01 | Lecture 1D et 2D | EAN, UPC, Code 128, ITF, QR, DataMatrix, DataBar (zxing-wasm) | M2§3 | P0 | C | Développé | C ✅ zxing-wasm auto-hébergé (wasm précaché, hors ligne) ; décodage réel vérifié sur images EAN-13, GS1 DataMatrix, GS1-128, QR Digital Link (`packages/web/test/decode.test.ts` + import de photo dans `e2e/scanner.spec.ts`) ; caméra vérifiée avec le périphérique simulé de Chromium — à essayer sur téléphones réels | Images de test + appareils réels |
| SCAN-02 | Identification GTIN | Clé de contrôle, normalisation | M2§1 | P0 | — | Testé et validé | D ✅ · C ✅ `e2e/scanner.spec.ts` | — |
| SCAN-03 | Recherche Open Food / Beauty / Products Facts | Proxy serveur, cache, User-Agent, 60 req/min | M2§1 | P0 | — | Développé | D ✅ · S ✅ (format de réponse réel, cache, bascule OBF/OPF) · C ✅ fiche « Nouveau code-barres » ; service Open Food Facts injoignable au moment des essais en direct : dégradation vérifiée (saisie du nom proposée) | Intégration (réponses simulées) |
| SCAN-04 | Nom, marque, photo, catégorie, format | — | M2§1 | P0 | SCAN-03 | Développé | D/S ✅ · C ✅ nom, marque, format, catégorie et photo pré-remplis quand la fiche existe | — |
| SCAN-05 | Association au catalogue / produits existants | Catalogue local hors ligne | M2§1 | P0 | CAT-05 | Testé et validé | D ✅ · C ✅ `e2e/scanner.spec.ts` (code reconnu dans le catalogue local au scan suivant) | E2E |
| SCAN-06 | Produits ménagers et d'hygiène | OBF, OPF, création rapide | M2§1 | P0 | SCAN-03 | Développé | S ✅ · C ✅ (bases Beauty/Products interrogées ; création rapide pour les produits non référencés) | — |
| SCAN-07 | Mode Réception | +1, lot créé/complété, péremption | M2§2, M2§5 | P0 | SCAN-01 | Testé et validé | D ✅ · C ✅ `e2e/scanner.spec.ts` (+1, lot complété pour même produit/date/lot, date lue dans le code) | E2E |
| SCAN-08 | Mode Consommation | −1, FEFO | M2§2, M2§5 | P0 | SCAN-01 | Testé et validé | D ✅ · C ✅ `e2e/scanner.spec.ts` | E2E |
| SCAN-09 | Mode Inventaire | Comptage, écarts, confirmation | M2§2, M2§5 | P0 | INV-06 | Testé et validé | D ✅ · C ✅ `e2e/scanner.spec.ts` (comptage par emplacement, écarts, correction après validation) | E2E |
| SCAN-10 | Quantité par scan modifiable | 1 par défaut | M2§2 | P0 | SCAN-01 | Développé | C ✅ « Par scan » : −/+ et raccourcis ½, 1, 6 — non couvert E2E | E2E |
| SCAN-11 | Analyse GS1 | GTIN, lot, DDM, date limite, poids, Digital Link | M2§3 | P0 | — | Testé et validé | D ✅ · C ✅ `e2e/scanner.spec.ts` (photo d’un GS1 DataMatrix : date limite et n° de lot) | Codes réels |
| SCAN-12 | Jamais de date dans un EAN classique | — | M2§3 | P0 | — | Testé et validé | D ✅ · C ✅ (un EAN classique ne crée jamais de date) | — |
| SCAN-13 | Traitement immédiat, une seule question | — | M2§6 | P0 | SCAN-01 | Testé et validé | C ✅ `e2e/scanner.spec.ts` (une seule question : la date, seulement pour un produit habituellement daté ; « Date inconnue » possible) | E2E |
| SCAN-14 | Confirmation discrète + Annuler | « +1 produit ajouté » | M2§6 | P0 | MVT-11 | Testé et validé | C ✅ `e2e/scanner.spec.ts` (« +1 … » / « −1 … », son et vibration, Annuler) | E2E |
| SCAN-15 | Mode scan continu | — | M2§6 | P0 | SCAN-01 | Testé et validé | C ✅ `e2e/scanner.spec.ts` (enchaînement des scans sans quitter l’écran) | E2E |
| SCAN-16 | Anti-doublon de scan | Anti-rebond 2,5 s + détection d'audit | M2§7, M3§7 | P0 | — | Développé | D ✅ détection d’audit · C ✅ anti-rebond caméra 2,5 s (non testable sans caméra réelle) | Unitaires + E2E |
| SCAN-17 | Erreurs, codes inconnus, non référencés | Messages clairs, création rapide | M2§7 | P0 | — | Testé et validé | S ✅ · C ✅ `e2e/scanner.spec.ts` (code inconnu) ; code invalide et lecture impossible signalés | E2E |
| SCAN-18 | Hors connexion | Catalogue local | M2§7 | P0 | SYNC-05 | Développé | C ✅ reconnaissance par le catalogue local (aucun appel réseau) — non couvert E2E hors ligne | E2E hors ligne |

## 12. OCR des dates

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| OCR-01 | Proposition de photographier l'étiquette | Si pas de date dans le code | M2§4 | P1 | SCAN-07 | Testé et validé | C ✅ « Lire la date sur une photo » dans la question de date du scanner et les fiches « Ajouter » / « Date » de l’inventaire · `e2e/ocr.spec.ts` | E2E |
| OCR-02 | Moteur OCR local | Tesseract.js + français auto-hébergés | M2§4 | P1 | — | Testé et validé | C ✅ Tesseract.js 7 + modèle français (LSTM, 0,7 Mo) servis par HOMEOS sous /engines/ocr (aucun CDN, aucune image envoyée), chargés à la demande, hors précache, puis conservés ; fonctionne sous la politique de sécurité du serveur · `e2e/ocr.spec.ts` (lecture réelle d’images dans Chromium) ; à essayer sur téléphones réels | Images réelles |
| OCR-03 | Reconnaissance DLC / DDM | Mentions et formats | M2§4 | P1 | — | Testé et validé | D ✅ scan.test · C ✅ DLC/DDM indiquées sur chaque proposition · `e2e/ocr.spec.ts` | Corpus d'étiquettes |
| OCR-04 | Affichage + confirmation obligatoire | — | M2§4 | P1 | OCR-02 | Testé et validé | C ✅ dates proposées avec le texte lu ; rien n’est rempli ni enregistré sans choix puis validation · `e2e/ocr.spec.ts` | E2E |
| OCR-05 | Source « reconnue et confirmée » | `expirySource = ocr` | M3§8 | P1 | — | Testé et validé | D ✅ · C ✅ lot marqué « date reconnue et confirmée » (redevient « saisie » si la date est retouchée) · `e2e/ocr.spec.ts` | — |

## 13. Inventaires

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| INV-01 | Assistant d'inventaire initial | Par espaces | M3§1 | P1 | — | Testé et validé | D ✅ · C ✅ Inventaires › Nouvel inventaire : initial guidé (tous les espaces) ou contrôle (espaces choisis), espace par espace · `e2e/inventories.spec.ts` | E2E |
| INV-02 | Scan à la chaîne dans l'assistant | — | M3§1 | P1 | SCAN-01 | Testé et validé | C ✅ « Scanner ici » ouvre le scanner en mode Inventaire sur la session et l’espace, scans cumulés sur une seule ligne, retour à l’inventaire · `e2e/inventories.spec.ts` (trois scans d’une vraie image de code-barres) | E2E |
| INV-03 | Modifier quantités, emplacements, dates avant validation | — | M3§1 | P1 | — | Testé et validé | C ✅ chaque ligne modifiable ou retirable avant validation (quantité, unité, « environ », date) · `e2e/inventories.spec.ts` | E2E |
| INV-04 | Pourcentage d'avancement | — | M3§1 | P1 | — | Testé et validé | D ✅ commands.test (`sessionProgress`) · C ✅ barre d’avancement, statut par espace (à faire, en cours, terminé, ignoré) · `e2e/inventories.spec.ts` | Unitaires |
| INV-05 | Sauvegarde partielle et reprise | Synchronisée | M3§1 | P1 | — | Testé et validé | D ✅ · C ✅ comptage enregistré au fil de l’eau, repris par un autre membre sur son appareil, avancement vu en direct · `e2e/inventories.spec.ts` | E2E |
| INV-06 | Comparaison théorique / compté | Par emplacement, confirmation | M2§5, M3§7 | P0 | — | Testé et validé | D ✅ · C ✅ écran « Écarts et validation » (enregistré → compté, écart), produits attendus non comptés listés, « Absent » = 0, produits laissés de côté non modifiés · `e2e/inventories.spec.ts` · `e2e/scanner.spec.ts` | E2E |
| INV-07 | Conflit si le stock change pendant l'inventaire | — | M3§7 | P0 | — | Testé et validé | D ✅ commands.test (conflit à la validation ; `movedSinceCount`) · S ✅ · C ✅ produit modifié après son comptage signalé (qui, combien) et non corrigé par défaut ; conflits à la validation listés avec « Recompter » · `e2e/inventories.spec.ts` | Intégration |
| INV-08 | Produits inconnus à résoudre avant validation | — | M3§1 | P1 | — | Testé et validé | D ✅ · C ✅ « Nouveaux produits à créer », validation bloquée tant qu’ils ne sont pas créés · `e2e/inventories.spec.ts` | E2E |

## 14. Liste de courses, mode courses, réception

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| SHOP-01 | Liste partagée synchronisée | — | M1§5 | P0 | SYNC-* | Testé et validé | D ✅ · S ✅ · C ✅ onglets Liste / Réception / Historique · `e2e/shopping.spec.ts` (deux membres, temps réel) | E2E 2 membres |
| SHOP-02 | Ajout manuel | — | M1§5 | P0 | — | Testé et validé | C ✅ barre d’ajout : suggestions du catalogue, quantité et unité affichées seulement après saisie · `e2e/shopping.spec.ts` | E2E |
| SHOP-03 | Ajout depuis le stock | — | M1§5 | P0 | — | Testé et validé | C ✅ bouton « Ajouter à la liste » de la fiche produit (quantité recommandée ou 1 conditionnement) + « Terminé » / « Manquant » · `e2e/shopping.spec.ts` (fiche produit) | E2E |
| SHOP-04 | Ajout depuis les recommandations | — | M1§5 | P0 | ENG-* | Testé et validé | C ✅ carte « À prévoir selon vos stocks » avec explication, ajout un par un ou « Tout ajouter », jamais automatique · `e2e/shopping.spec.ts` | E2E |
| SHOP-05 | Quantités, commentaires, priorités, catégories | Avec conflits par champ | M1§5 | P0 | — | Testé et validé | C ✅ fiche article : quantité/unité, priorité, rayon, magasin, commentaire ; formulaire chargé à l’ouverture, conflits par champ signalés · `e2e/shopping.spec.ts` (priorité, commentaire, rayon, conflit à deux membres) | E2E |
| SHOP-06 | Attribution à un membre | — | M1§5 | P1 | — | Testé et validé | C ✅ « Confié à » + avatar du membre sur la ligne · `e2e/shopping.spec.ts` (vu en direct par l’autre membre) | E2E |
| SHOP-07 | Acheté / non acheté | — | M1§5 | P0 | — | Testé et validé | C ✅ case à cocher (liste et mode courses) · `e2e/shopping.spec.ts` | E2E |
| SHOP-08 | Achats partiels | — | M1§5 | P0 | — | Testé et validé | C ✅ quantité prise en magasin, badge « x pris », reliquat · `e2e/shopping.spec.ts` | E2E |
| SHOP-09 | Suppression réversible | — | M1§5 | P0 | — | Testé et validé | C ✅ « Retirer » puis « Remettre » depuis l’historique · `e2e/shopping.spec.ts` | E2E |
| SHOP-10 | Historique de la liste | — | M1§5 | P1 | — | Testé et validé | C ✅ historique : achats rangés (quantité, membre, magasin, prix) et articles retirés · `e2e/shopping.spec.ts` | E2E |
| SHOP-11 | Regroupement des doublons, addition multi-membres | Alias d'identifiant | M1§5 | P0 | — | Testé et validé | D ✅ · S ✅ sync.test · C ✅ message « déjà dans la liste (ajouté par …) », « n demandes » · `e2e/shopping.spec.ts` | Intégration (2 appareils hors ligne) |
| SHOP-12 | Mode courses téléphone | Grandes cases, rayons, quantités, navigation simple | M1§5, M1§11 | P0 | C | Testé et validé | C ✅ plein écran, cases de 44 px, lignes de 76 px, progression, ajout d’un article pris en plus (coche l’existant au lieu de dupliquer) · `e2e/shopping.spec.ts` (profil Pixel 7) ; à essayer sur téléphones réels | E2E mobile |
| SHOP-13 | Mise à jour instantanée chez les autres | — | M1§5 | P0 | SYNC-04 | Testé et validé | C ✅ ajout, fusion, attribution et « Pris par … » vus en direct · `e2e/shopping.spec.ts` (deux navigateurs) | E2E 2 navigateurs |
| SHOP-14 | Anti-doublon / stock suffisant à l'ajout | Avertissement | M1§4 | P1 | ENG-* | Testé et validé | D ✅ engine.test (stock suffisant) · C ✅ avertissement sous la saisie · `e2e/shopping.spec.ts` (« Déjà 1 paquet dans la liste ») | E2E |
| SHOP-15 | Répartition entre magasins | — | M3§5 | P1 | STORE-01 | Testé et validé | C ✅ magasin par article, regroupement « Magasin », filtre du mode courses (articles des autres magasins masqués et comptés) · shopping.test · `e2e/shopping.spec.ts` | E2E |
| SHOP-16 | Mode courses par magasin puis rayon | Ordre des rayons par magasin | M3§5 | P1 | SHOP-12 | Testé et validé | D ✅ `groupByAisle`, `moveAisle` (shopping.test) · C ✅ ordre des rayons modifiable par magasin, suivi par le mode courses · `e2e/shopping.spec.ts` | E2E |
| SHOP-17 | Écran maintenu allumé | Wake Lock | M1§11 | P2 | SHOP-12 | Développé | C ✅ Screen Wake Lock pendant le mode courses, réacquis au retour sur l’onglet, indication à l’écran ; non vérifiable sans navigateur réel (Safari iOS ≥ 16.4, Chrome Android) — essai manuel à faire | Manuel |
| RCV-01 | Proposition de mise à jour du stock après achat | — | M1§5 | P0 | SHOP-07 | Testé et validé | C ✅ bandeau « n article(s) acheté(s) à ranger », « Terminer et ranger les achats » ouvre la réception ; le stock n’est jamais modifié par une simple coche · `e2e/shopping.spec.ts` | E2E |
| RCV-02 | Étape de réception | Quantités réelles, écarts, prix, dates, emplacement | M1§5 | P0 | — | Testé et validé | D ✅ · C ✅ quantité réellement rapportée, écart affiché, prix total facultatif, magasin, emplacement, date (saisie ou proposée d’après la conservation habituelle, marquée « estimée »), produit existant / créé / dépense seule, « Pas acheté », « Tout ranger » · `e2e/shopping.spec.ts` (partiel, écart, création du produit) | E2E |
| RCV-03 | Reliquat d'achat partiel conservé | — | M1§5 | P0 | — | Testé et validé | D ✅ · C ✅ · E2E `shopping.spec` : achat partiel, le reliquat reste à acheter | — |
| RCV-04 | Article libre → produit suivi | — | AUD | P1 | — | Testé et validé | D ✅ · C ✅ réception d’un article libre : « créer le produit » par défaut, ou produit existant, ou dépense seule · E2E `family-week.spec` (pain) | — |

## 15. Tickets de caisse et magasins

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| TKT-01 | Photo ou import d'un ticket | — | M3§4 | P1 | OCR-02 | Testé et validé | C ✅ Courses › Ticket (aussi depuis Dépenses) : photo, import d’image ou saisie à la main · `e2e/ocr.spec.ts` | E2E |
| TKT-02 | Lecture magasin, date, lignes, quantités, prix, total, promotions | — | M3§4 | P1 | OCR-02 | Testé et validé | D ✅ scan.test (dont le texte réellement lu, ligne de quantité avant ou après l’article rattachée seulement si le montant concorde) · C ✅ magasin, date, total, lignes, quantités, poids, remises, contrôle de la somme · `e2e/ocr.spec.ts` | Corpus de tickets réels |
| TKT-03 | Écran de validation, correspondances incertaines signalées | — | M3§4 | P1 | CAT-10 | Testé et validé | C ✅ chaque ligne : Sûr / Probable / À vérifier / Inconnu, choix du produit, nouveau produit ou dépense seule, ligne modifiable, supprimable, ajoutable · `e2e/ocr.spec.ts` | E2E |
| TKT-04 | Après validation : réceptions, prix, dépenses, produits inconnus | — | M3§4 | P1 | — | Testé et validé | D ✅ · S ✅ · C ✅ achats et dépenses enregistrés, lignes cochées mises en stock, produits créés, nouveau magasin créé · `e2e/ocr.spec.ts` | Intégration |
| TKT-05 | Jamais de stock depuis un OCR non vérifié | — | M3§4 | P0 | — | Testé et validé | D ✅ · C ✅ correspondance « à vérifier » jamais mise en stock sans confirmation explicite ; rien n’est enregistré avant « Enregistrer le ticket » · `e2e/ocr.spec.ts` | E2E |
| TKT-06 | Apprentissage des libellés par magasin | — | M3§4 | P2 | — | Testé et validé | D ✅ · C ✅ libellé associé appris pour le magasin : « Sûr » au ticket suivant · `e2e/ocr.spec.ts` | — |
| STORE-01 | Magasins : nom, adresse, notes | — | M3§5 | P1 | — | Testé et validé | C ✅ page Magasins (création, nom, adresse, notes, couleur) · `e2e/shopping.spec.ts` | E2E |
| STORE-02 | Historique des achats par magasin | — | M3§5 | P1 | BUD-01 | Testé et validé | D ✅ `storeSummary` (shopping.test : passages, prix inconnus exclus, panier moyen sur passages chiffrés) · C ✅ fiche magasin · `e2e/shopping.spec.ts` (achat réceptionné visible avec son prix) | E2E |
| STORE-03 | Produits habituellement achetés par magasin | — | M3§5 | P2 | — | Développé | D ✅ `storeSummary.usual` (≥ 2 achats, shopping.test) · C ✅ « Produits habituels » avec ajout à la liste — non couvert E2E | Unitaires |
| STORE-04 | Plusieurs magasins | Création, archivage | M1§10, M3§5 | P1 | — | Testé et validé | C ✅ création (Courses › Magasins), archivage (Paramètres › Catalogue) · `e2e/shopping.spec.ts` | — |

## 16. Moteur d'approvisionnement

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| ENG-01 | Quantités disponibles | Utilisable vs périmé | M1§4 | P0 | STK-01 | Testé et validé | D ✅ · C ✅ stock utilisable (lots périmés exclus) dans les explications et la vue Péremption · `e2e/forecast.spec.ts` | — |
| ENG-02 | Stocks faibles | Seuil minimal | M1§4 | P0 | — | Testé et validé | D ✅ · C ✅ « il reste 2 rouleaux, sous le seuil minimal de 4 rouleaux » · `e2e/forecast.spec.ts` | — |
| ENG-03 | Ruptures | — | M1§4 | P0 | — | Testé et validé | D ✅ · C ✅ « le stock est épuisé », à acheter maintenant · `e2e/forecast.spec.ts` | — |
| ENG-04 | Jours d'autonomie | — | M1§4 | P0 | ENG-05 | Testé et validé | D ✅ · C ✅ « épuisé dans environ 4 jours », calendrier « rupture prévue dans n j » · `e2e/forecast.spec.ts` | — |
| ENG-05 | Analyse de la consommation | Pondérée, ruptures exclues | M1§4 | P0 | — | Testé et validé | D ✅ engine.test · C ✅ consommation affichée avec sa source et sa confiance (« Pourquoi ? ») · `e2e/forecast.spec.ts` | — |
| ENG-06 | Produits achetés régulièrement | Cadence | M1§4 | P1 | — | Développé | D ✅ engine.test (cadence) · C ✅ groupe « Achats habituels à prévoir » et « achat habituel attendu » dans le calendrier — non couvert E2E (il faut plusieurs semaines d’achats) | — |
| ENG-07 | Prévision des réapprovisionnements | Date conseillée | M1§4 | P0 | — | Testé et validé | D ✅ · C ✅ « d’ici le … » et calendrier des ruptures par semaine (6 semaines) · overview.test · `e2e/forecast.spec.ts` | — |
| ENG-08 | Quantités recommandées | Idéale, couverture, conditionnement | M1§4 | P0 | — | Testé et validé | D ✅ · C ✅ « Acheter 6 bouteilles… », arrondi au conditionnement · `e2e/forecast.spec.ts` | — |
| ENG-09 | Bientôt périmés, risque de gaspillage | — | M1§4 | P0 | — | Testé et validé | D ✅ overview.test (quantités à risque seulement si consommation fiable) · C ✅ vue Péremption (sections par urgence, « risque de gaspillage ») · `e2e/forecast.spec.ts` | — |
| ENG-10 | Éviter les achats en double | Liste déduite, « déjà prévu » | M1§4 | P0 | — | Testé et validé | D ✅ quantité déjà prévue déduite des recommandations · C ✅ la recommandation disparaît une fois l’article dans la liste ; fiche produit « Dans la liste de courses : … » · `e2e/shopping.spec.ts` | — |
| ENG-11 | Adaptation aux habitudes réelles | Pondération récente | M1§4 | P0 | — | Testé et validé | D ✅ engine.test (pondération récente, ruptures exclues) ; pas d’écran propre, effet visible dans les recommandations | — |
| ENG-12 | Explication compréhensible | Phrase + détail | M1§4 | P0 | — | Testé et validé | D ✅ · C ✅ phrase + « Pourquoi ? » (objectif, stock et sa fiabilité, consommation dite une seule fois, base du prix) · `e2e/forecast.spec.ts` | — |
| ENG-13 | Niveaux de confiance | — | M1§4 | P0 | — | Testé et validé | D ✅ · C ✅ badge Fiable / Assez fiable / Indicatif / Sans données sur chaque recommandation et événement du calendrier · `e2e/forecast.spec.ts` | — |
| ENG-14 | Repli sur les seuils | Sans historique suffisant | M1§4 | P0 | — | Testé et validé | D ✅ · C ✅ produit sans historique : seuil utilisé et dit (« Pas assez d’historique : seuils du foyer utilisés ») · `e2e/forecast.spec.ts` | — |
| ENG-15 | Jamais de consommation inventée | — | M1§4 | P0 | — | Testé et validé | D ✅ · C ✅ produit sans seuil ni historique : aucune recommandation, absent du calendrier, signalé dans « Pour des prévisions plus justes » · `e2e/forecast.spec.ts` | — |
| ENG-16 | Qualité des données prise en compte | — | M3§8 | P0 | REL-01 | Testé et validé | D ✅ engine.test (quantité approximative → confiance abaissée et signalée) · C ✅ fiabilité du stock dans « Pourquoi ? » | — |
| ENG-17 | Coût estimé des recommandations | Prix connu/estimé/inconnu | M3§6 | P1 | BUD-14 | Testé et validé | D ✅ · C ✅ « ≈ 2,40 € » d’après un achat enregistré, « prix inconnu » sinon, total estimé + nombre sans prix · `e2e/forecast.spec.ts` | — |
| ENG-18 | Calcul côté serveur | Pour notifications et récapitulatifs | M3§9 | P1 | NOTIF-12 | Testé et validé | S ✅ services.test (récapitulatifs calculés côté serveur) | Intégration |

## 17. Péremption et anti-gaspillage

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| EXP-01 | Surveillance des dates | Statuts par lot | M1§7 | P0 | — | Testé et validé | D ✅ · C ✅ vue Péremption : date dépassée, aujourd’hui, urgent, bientôt · overview.test · `e2e/forecast.spec.ts` | E2E |
| EXP-02 | Bientôt périmés | — | M1§7 | P0 | — | Testé et validé | C ✅ section « D’ici n jours » · `e2e/forecast.spec.ts` | — |
| EXP-03 | À consommer rapidement | Priorité FEFO | M1§7 | P0 | — | Testé et validé | C ✅ « à consommer bientôt, dont n en urgence », Consommer depuis la vue · `e2e/forecast.spec.ts` | — |
| EXP-04 | Périmés | — | M1§7 | P0 | — | Testé et validé | C ✅ section « Date dépassée » (DLC : ne plus consommer ; DDM : vérifier) · `e2e/forecast.spec.ts` | — |
| EXP-05 | Produits ouverts | Conservation après ouverture | M1§7, M1§10 | P0 | — | Développé | D ✅ overview.test (date effective = ouverture + conservation) · C ✅ badge « Ouvert … », section « Autres produits ouverts » (sans doublon avec les sections par date) — non couvert E2E | — |
| EXP-06 | Produits oubliés | Sans mouvement depuis N jours | M1§7 | P1 | — | Développé | D ✅ overview.test (sans mouvement depuis 90 j, 10 j au réfrigérateur) · C ✅ section « Peut-être oubliés » — non couvert E2E | Unitaires |
| EXP-07 | Lots à date proche prioritaires | FEFO | M1§7 | P0 | STK-07 | En développement | D ✅ | — |
| EXP-08 | Tableau de bord anti-gaspillage | Pertes, valeur, produits jetés | M1§7 | P1 | — | Testé et validé | D ✅ overview.test (motifs, valorisation aux prix connus) · C ✅ onglet Pertes : nombre, valeur jetée, valeur à sauver, produits les plus jetés, motifs, 30 j / 3 mois / 12 mois · `e2e/forecast.spec.ts` | E2E |
| EXP-09 | Distinction DLC / DDM | — | M2§4 | P1 | — | Testé et validé | C ✅ DLC / DDM sur chaque lot, DDM dépassée « souvent encore consommable » · `e2e/forecast.spec.ts` | — |

## 18. Dépenses et budget

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| BUD-01 | Enregistrement des achats | Produit, quantité, prix, magasin, date, membre | M1§8 | P0 | — | Testé et validé | D ✅ · S ✅ · C ✅ à la réception des courses et saisie libre (produit facultatif, quantité, prix total facultatif, remise, magasin, date, catégorie) ; modification et suppression confirmée · `e2e/expenses.spec.ts` | E2E |
| BUD-02 | Dépenses hebdomadaires | — | M1§8 | P1 | — | Testé et validé | D ✅ stats.test · C ✅ colonnes par semaine (périodes « Ce mois », « 3 mois »), bornées à la période du filtre · `e2e/expenses.spec.ts` | — |
| BUD-03 | Dépenses mensuelles | — | M1§8 | P1 | — | Testé et validé | D ✅ · C ✅ colonnes par mois (« 12 mois »), ligne de budget · `e2e/expenses.spec.ts` (12 colonnes) | — |
| BUD-04 | Dépenses annuelles | — | M3§6 | P1 | — | Testé et validé | D ✅ · C ✅ colonnes par année (« Tout », jusqu’à 10 ans) — même composant que BUD-02/03 | — |
| BUD-05 | Par catégorie | — | M3§6 | P1 | — | Testé et validé | D ✅ · C ✅ barres classées, une teinte, valeur au bout, vue tableau (montant, part, nombre) · `e2e/expenses.spec.ts` | Unitaires |
| BUD-06 | Par magasin | — | M3§6 | P1 | — | Testé et validé | D ✅ · C ✅ barres classées par magasin + vue tableau (part en %) · `e2e/expenses.spec.ts` · fiche magasin (phase 5) | Unitaires |
| BUD-07 | Budget mensuel | — | M1§8 | P1 | HH-08 | Testé et validé | D ✅ · C ✅ budget défini dans Paramètres, jauge, reste ou dépassement · `e2e/expenses.spec.ts` | — |
| BUD-08 | Budget prévisionnel / projection | Au rythme réel | M1§8 | P1 | — | Testé et validé | D ✅ · C ✅ projection fin de mois au rythme réel (à partir du 5), alerte si le budget serait dépassé · `e2e/expenses.spec.ts` | — |
| BUD-09 | Produits les plus coûteux | — | M1§8, M3§6 | P1 | — | Testé et validé | D ✅ stats.test · C ✅ « Produits les plus coûteux » sur la période (barres classées + tableau) | Unitaires |
| BUD-10 | Évolution des dépenses | Graphique interactif | M1§8 | P1 | UX-04 | Testé et validé | D ✅ · C ✅ graphique interactif (info-bulle au survol et au clavier, vue tableau), un seul filtre de période pour toute la page · `e2e/expenses.spec.ts` | — |
| BUD-11 | Évolution des prix | — | M3§6 | P2 | — | Testé et validé | D ✅ · C ✅ courbe du prix payé par unité, produit au choix (≥ 2 prix enregistrés), réticule et navigation au clavier, tableau des achats · `e2e/expenses.spec.ts` | — |
| BUD-12 | Comparaison des prix par magasin | €/kg, €/L, €/unité | M1§8, M1§10 | P2 | — | Testé et validé | D ✅ · C ✅ tableau moyen / plus bas / dernier par magasin, « le moins cher » signalé · `e2e/expenses.spec.ts` | — |
| BUD-13 | Budget moyen et panier moyen | — | M3§6 | P2 | — | Testé et validé | D ✅ · C ✅ panier moyen (passages des 90 derniers jours), moyenne des 3 derniers mois · `e2e/expenses.spec.ts` | — |
| BUD-14 | Coût estimé des prochains achats | Connu / estimé / inconnu | M3§6 | P1 | — | Testé et validé | D ✅ · C ✅ « Prochains achats prévus » : liste de courses et recommandations, prix estimés ou inconnus distingués | — |
| BUD-15 | Aucun prix inventé | — | M1§8, M3§6 | P0 | — | Testé et validé | D ✅ · C ✅ achat sans prix affiché « prix inconnu », jamais estimé dans les dépenses passées, compté à part · `e2e/expenses.spec.ts` | — |
| BUD-16 | Historique des achats | — | M1§8 | P1 | — | Testé et validé | C ✅ liste par jour sur la période (magasin, membre, origine : courses/ticket, remise), « Afficher plus » · `e2e/expenses.spec.ts` | E2E |
| BUD-17 | Dépenses inhabituelles | Détection | M3§9 | P2 | — | Testé et validé | D ✅ stats.test (dans la devise du foyer) · C ✅ affichées sur la page Dépenses et dans les notifications · `e2e/expenses.spec.ts` | Unitaires |

## 19. Tableau de bord

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| DASH-01 | Indicateurs clés | Produits, faibles, épuisés, à acheter, bientôt périmés | M1§9 | P1 | ENG-* | Testé et validé | C ✅ produits suivis, stocks faibles, épuisés, à acheter, bientôt périmés ; chaque indicateur ouvre la vue filtrée · `e2e/dashboard.spec.ts` | E2E |
| DASH-02 | Liste de courses actuelle | — | M1§9 | P1 | SHOP-01 | Testé et validé | C ✅ articles à acheter, coût estimé (connu/estimé/inconnu), accès au mode courses · `e2e/dashboard.spec.ts` | E2E |
| DASH-03 | Derniers mouvements | — | M1§9 | P1 | MVT-10 | Développé | C ✅ six dernières actions avec le membre et l’heure, lien vers le journal — non vérifié en E2E (affichage simple du journal déjà testé) | E2E |
| DASH-04 | Dépenses du mois | Avec budget | M1§9 | P1 | BUD-07 | Développé | D ✅ `budgetStatus` (stats.test) · C ✅ dépensé (prix connus), achats sans prix comptés à part, budget, projection, lien pour définir un budget — vérifié visuellement, non couvert E2E | E2E |
| DASH-05 | Prévisions d'approvisionnement | — | M1§9 | P1 | ENG-07 | Testé et validé | C ✅ recommandations « maintenant » et « avant les prochaines courses » avec fiabilité et ajout direct · `e2e/dashboard.spec.ts` | E2E |
| DASH-06 | « Ce que votre maison doit prévoir » | Synthèse des recommandations | M1§9 | P1 | ENG-* | Testé et validé | D ✅ · C ✅ bloc central (achats à prévoir + lots à consommer), ajout à la liste depuis l’accueil · `e2e/dashboard.spec.ts` | E2E |
| DASH-07 | Personnalisation | Widgets masquables, réordonnables, par membre | M1§9 | P2 | — | Testé et validé | D ✅ `resolveDashboard`, `moveWidget`, `toggleWidget` (dashboard.test) · C ✅ afficher/masquer/réordonner, enregistré par membre et par foyer, suit le compte sur tous les appareils · `e2e/dashboard.spec.ts` (rechargement, autre membre non affecté) | E2E |

## 20. Notifications

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| NOTIF-01 | Centre de notifications | — | M3§9 | P1 | — | Testé et validé | C ✅ page Notifications (alertes par gravité, activité du foyer) + cloche avec pastille dans la barre du haut · `e2e/dashboard.spec.ts` | E2E |
| NOTIF-02 | Stocks critiques | — | M3§9 | P1 | — | Testé et validé | D ✅ · C ✅ « stock critique » · `e2e/dashboard.spec.ts` | — |
| NOTIF-03 | Produits épuisés | — | M3§9 | P1 | — | Testé et validé | D ✅ stats.test · C ✅ « épuisé » (même affichage que NOTIF-02) | — |
| NOTIF-04 | Bientôt périmés | — | M3§9 | P1 | — | Testé et validé | D ✅ · C ✅ « périme aujourd’hui », quantité concernée, DDM signalée · `e2e/dashboard.spec.ts` | — |
| NOTIF-05 | Produits à acheter | — | M3§9 | P1 | — | Testé et validé | D ✅ · C ✅ « n produits à acheter » (information, lien vers Prévisions) | — |
| NOTIF-06 | Courses non terminées | Achetés non réceptionnés | M3§9 | P1 | — | Testé et validé | D ✅ stats.test (achat coché non rangé depuis plus de 12 h → lien vers la réception) · C ✅ même affichage | Unitaires |
| NOTIF-07 | Modifications importantes | Par d'autres membres | M3§9, M1§2 | P1 | — | Testé et validé | D ✅ stats.test (chacun averti des modifications des autres, jamais des siennes) · S ✅ services.test (push immédiat) · C ✅ marquée « nouvelle » jusqu’à consultation du centre · `e2e/dashboard.spec.ts` (signalement de Bob vu en direct par Nicolas) | Intégration |
| NOTIF-08 | Dépenses inhabituelles | — | M3§9 | P2 | BUD-17 | Développé | D ✅ stats.test (alerte produite, lien existant) · C ✅ même affichage ; écran Dépenses en phase 9 | Unitaires |
| NOTIF-09 | Inventaires à vérifier | — | M3§9 | P1 | REL-01 | Testé et validé | D ✅ stats.test (stock approximatif ou à vérifier) · C ✅ même affichage | Unitaires |
| NOTIF-10 | Personnalisation par membre | Types, alertes masquées | M3§9 | P1 | — | Testé et validé | D ✅ · C ✅ types désactivables dans Paramètres (lien direct depuis le centre), masquage d’une alerte, « Tout masquer », « Tout réafficher » · `e2e/dashboard.spec.ts` | E2E |
| NOTIF-11 | Déduplication | Clé stable, journal d'envoi | M3§9 | P1 | — | Testé et validé | D ✅ clés stables (une alerte masquée revient si la situation change) · S ✅ services.test · C ✅ · `e2e/dashboard.spec.ts` | Intégration |
| NOTIF-12 | Récapitulatif quotidien / hebdomadaire | Web Push à l'heure choisie | M3§9 | P2 | NOTIF-13 | Testé et validé | S ✅ services.test (heure choisie, préférences, une fois par jour, **un récapitulatif par foyer** sans remplacement mutuel, foyer nommé, lien vers le foyer) · C ✅ réglages dans Paramètres, notification de test · `e2e/push.spec.ts` (affichage sur l’appareil) ; réception sur téléphone réel à confirmer par l’utilisateur | Intégration (envoi simulé) |
| NOTIF-13 | Web Push | VAPID local, iPhone (PWA installée), Android, PC | M3§9 | P2 | FND-06 | Développé | S ✅ VAPID local, abonnement, envoi, anti-doublon, nettoyage des abonnements expirés · C ✅ service worker : message → notification (titre avec le foyer, étiquette, lien), clic → ouverture sur le bon foyer · `e2e/push.spec.ts` (livraison par le protocole de débogage de Chromium) · bouton « Envoyer une notification de test » ; abonnement réel impossible ici (service push du navigateur injoignable) : **à vérifier sur iPhone (PWA installée, iOS ≥ 16.4), Android et ordinateur** | Manuel sur appareils |
| NOTIF-14 | Fil d'activité partagé du foyer | « Notifications partagées » | M1§2 | P1 | MVT-10 | Testé et validé | D ✅ · C ✅ onglet « Activité du foyer » et journal de la page Famille · `e2e/dashboard.spec.ts` | E2E |

## 21. Niveaux de fiabilité et cohérence

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| REL-01 | Fiabilité des quantités | Comptée, scannée, saisie, approximative, calculée | M3§8 | P0 | — | En développement | D ✅ · C 🟡 « ≈ », source de la quantité, date de comptage par lot, fiabilité du stock dans les explications ; à étendre au tableau de bord (phase 7) | — |
| REL-02 | Fiabilité des dates | GS1, saisie, OCR confirmée, estimée, inconnue | M3§8 | P0 | — | En développement | D ✅ · C 🟡 source de la date par lot, date « estimée » signalée, DLC/DDM ; à étendre au tableau de bord (phase 7) | — |
| REL-03 | Fiabilité de la consommation | Observée / achats / manuelle / aucune + confiance | M3§8 | P0 | — | Testé et validé | D ✅ · C ✅ « (observé, confiance élevée) », badges de confiance · `e2e/forecast.spec.ts` | — |
| REL-04 | Fiabilité des prix | Connu / estimé / inconnu | M3§6 | P0 | — | Testé et validé | D ✅ · C ✅ prix connu (saisi) / « ≈ » estimé (base indiquée) / « prix inconnu », dans Courses et Prévisions · `e2e/shopping.spec.ts` · `e2e/forecast.spec.ts` | — |
| REL-05 | Affichage clair des incertitudes | Jamais une estimation présentée comme exacte | M3§8 | P0 | C | Développé | C ✅ composants communs (`ui/Reliability.tsx`) : confiance, date estimée, prix estimé ; « ≈ » pour les quantités approximatives — à appliquer au tableau de bord (phase 7) | E2E + revue |
| REL-06 | Moteur tenant compte de la qualité | — | M3§8 | P0 | — | En développement | D ✅ | — |
| AUD-01 | Quantité négative, Σ mouvements ≠ lot, arithmétique | — | M3§7 | P0 | — | Testé et validé | D ✅ stats.test · S ✅ contrôle nocturne · C ✅ écran Contrôle de cohérence, action « Recompter » | — |
| AUD-02 | Produit ajouté deux fois / doublons | — | M3§7 | P0 | — | Testé et validé | D ✅ stats.test · C ✅ « Comparer et fusionner » ouvre la fusion avec le doublon proposé en premier (jamais automatique) · `e2e/inventories.spec.ts` | — |
| AUD-03 | Mouvements identiques rapprochés | — | M3§7 | P0 | — | Testé et validé | D ✅ stats.test · C ✅ « Annuler le doublon » (mouvement compensé, historique conservé) · `e2e/inventories.spec.ts` | — |
| AUD-04 | Écart théorique / physique | — | M3§7 | P0 | INV-06 | Testé et validé | D ✅ stats.test (consommation sur stock insuffisant) · C ✅ « Recompter » lance un inventaire de contrôle des espaces du produit | — |
| AUD-05 | Consommation sur stock nul | — | M3§7 | P0 | — | Testé et validé | D ✅ stats.test · C ✅ même écran (anomalie « consommé alors que le stock était insuffisant ») | — |
| AUD-06 | Dates incohérentes | Avant l'achat, > 10 ans, dépassée à réception | M3§7 | P1 | — | Testé et validé | D ✅ stats.test (date avant l’achat, à plus de 10 ans — refusée à la saisie, repérée si importée —, inventaire en suspens) · C ✅ même écran, dates au format français | Unitaires |
| AUD-07 | Contrôle d'intégrité serveur | SQLite + règles métier | M1§12 | P0 | — | Testé et validé | S ✅ week.test (contrôle chaque soir), data.test | Intégration |
| AUD-08 | Interface de contrôle et de correction | — | M3§7 | P1 | C | Testé et validé | C ✅ écran Contrôle de cohérence (Inventaire › Contrôle, pastille du nombre d’anomalies), anomalies par gravité avec action ; rien n’est corrigé sans l’utilisateur · `e2e/inventories.spec.ts` | E2E |

## 22. Sauvegardes, export, import

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| BAK-01 | Sauvegardes automatiques | Quotidiennes + avant opérations sensibles | M1§12, M3§10 | P0 | — | Testé et validé | S ✅ sauvegarde automatique créée au démarrage réel ; data.test | Intégration |
| BAK-02 | Versions et rotation | 14 jours + 12 mois | M3§10 | P0 | BAK-01 | Testé et validé | S ✅ data.test (rotation) | Unitaires (rotation) |
| BAK-03 | Vérification de chaque sauvegarde | integrity_check, FK, lecture | M3§10 | P0 | BAK-01 | Testé et validé | S ✅ data.test (fichier corrompu détecté ; un seul fichier autonome) | Intégration (fichier corrompu) |
| BAK-04 | Restauration complète | Sauvegarde préalable, nouvelle époque | M3§10 | P0 | BAK-03 | Testé et validé | S ✅ data.test · C ✅ « Tout restaurer » (hébergeur), confirmation RESTAURER, sauvegarde de sécurité, resynchronisation des appareils · `e2e/data.spec.ts` | Intégration |
| BAK-05 | Restauration d'un seul foyer | Sans affecter les autres familles | M4, C7 | P0 | BAK-03 | Testé et validé | S ✅ data.test (par un administrateur du foyer ; par l’hébergeur pour un foyer supprimé, sans y entrer sauf foyer orphelin) · C ✅ « Revenir à une version précédente » et « Foyers… » · `e2e/data.spec.ts` | Intégration |
| BAK-06 | Export complet JSON | Avec photos | M1§12, M3§10 | P0 | — | Testé et validé | S ✅ data.test · C ✅ export complet avec ou sans photos, fichier téléchargé et relu · `e2e/data.spec.ts` | Aller-retour |
| BAK-07 | Export CSV | Inventaire, achats, mouvements | M1§12 | P1 | — | Testé et validé | S ✅ data.test · C ✅ inventaire, achats, mouvements · `e2e/data.spec.ts` | Intégration |
| BAK-08 | Import complet | Nouveau foyer, identifiants régénérés | M1§12, M3§10 | P0 | — | Testé et validé | S ✅ data.test + isolation.test · C ✅ import d’un fichier → nouveau foyer actif, l’original intact · `e2e/data.spec.ts` | Aller-retour |
| BAK-09 | Preuve de restauration | Sauvegarde → restauration → données identiques | M3§10 | P0 | BAK-04 | Testé et validé | S ✅ data.test « PREUVE : sauvegarde → modifications → restauration → données identiques » | — |
| BAK-10 | Interface sauvegardes / export / import | — | M1§12 | P1 | C | Testé et validé | C ✅ Paramètres › Données (intégrité, export, import, version précédente, suppression) et Administration (sauvegardes vérifiées, création, téléchargement, foyers d’une sauvegarde, restauration complète) ; droits respectés (membre : ni restauration ni suppression) · `e2e/data.spec.ts` | E2E |
| BAK-11 | Export ≠ sauvegarde automatique | Les deux existent et sont distingués | M3§10 | P0 | — | Testé et validé | Documenté (MASTER_SPEC §14.2) ; sauvegardes automatiques et exports distincts et testés | — |

## 23. Design et expérience utilisateur

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| UX-01 | Design haut de gamme non générique | — | M1§11 | P0 | — | Développé | C ✅ design system « lin & forêt » sur tous les écrans, revu par captures (téléphone et ordinateur, clair et sombre) à chaque phase ; avis de la famille à recueillir | Revue visuelle (captures) |
| UX-02 | Typographie, hiérarchie, couleurs, cartes, icônes | — | M1§11 | P0 | UX-01 | Développé | C ✅ typographie Manrope, hiérarchie, cartes, icônes Lucide, couleurs validées (contrastes WCAG AA, palette des graphiques vérifiée) ; avis de la famille à recueillir | Revue |
| UX-03 | Animations subtiles | — | M1§11 | P1 | — | Développé | C ✅ animations discrètes (apparition, montée des fenêtres, toasts, chargement) ; désactivées si l’appareil demande moins d’animations | Revue |
| UX-04 | Graphiques interactifs | — | M1§11 | P1 | — | Testé et validé | C ✅ `ui/Charts.tsx` : colonnes, barres classées, courbe ; teinte validée par script pour les deux thèmes, info-bulles au survol et au clavier, vue tableau sur chaque graphique · `e2e/expenses.spec.ts` | E2E |
| UX-05 | Mode clair et sombre | — | M1§11 | P0 | — | Testé et validé | C ✅ thème clair/sombre/auto ; tous les écrans audités dans les deux thèmes (contrastes WCAG AA, axe) | — |
| UX-06 | Optimisation téléphone | — | M1§11 | P0 | — | Testé et validé | C ✅ tous les parcours de bout en bout s’exécutent sur un téléphone émulé (Pixel 7) ; débordements corrigés (en-têtes, barre d’ajout, onglets) | — |
| UX-07 | Navigation 6 rubriques | Accueil, Inventaire, Courses, Prévisions, Famille, Paramètres | M1§11 | P0 | — | Testé et validé | C ✅ 6 rubriques (Accueil, Inventaire, Courses, Prévisions, Famille, Paramètres) + Scanner + Notifications, toutes construites et parcourues en E2E | E2E |
| UX-08 | Mode courses optimisé magasin | — | M1§11 | P0 | SHOP-12 | Testé et validé | Voir SHOP-12 · `e2e/shopping.spec.ts` | E2E mobile |
| UX-09 | Scanner accessible partout | — | M2 | P0 | SCAN-01 | Développé | C ✅ bouton Scanner (téléphone : bouton flottant ; ordinateur : barre latérale) | E2E |
| UX-10 | Accessibilité | Contrastes, cibles ≥ 44 px | AUD | P1 | — | Testé et validé | C ✅ audit axe-core WCAG 2.1 A/AA sur 22 écrans + fenêtres, thèmes clair et sombre : aucune violation grave. Défauts corrigés : contrastes (texte secondaire, avertissement, succès, danger, accent), boutons-icônes sans nom, nom accessible du sélecteur de foyer | — |
| UX-11 | Chaque bouton fonctionne | — | M1§12 | P0 | — | Testé et validé | E2E `buttons.spec` : 24 écrans (dont recettes), chaque bouton, onglet et lien interne actionné, puis chaque bouton des fenêtres ouvertes — plus de 800 actions, aucune erreur JavaScript, aucun écran d’erreur, aucun texte technique | — |
| UX-12 | Gestion des erreurs lisible | Messages français, pas d'écran blanc | M1§12 | P0 | — | Testé et validé | D/S ✅ · C ✅ messages en français, refus expliqués, écran de secours (« Vos données ne sont pas affectées ») au lieu d’un écran blanc · E2E (mauvais mot de passe, conflit, lien expiré) | — |

## 24. Fonctionnalités avancées

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| ADV-01 | Recettes | Ingrédients liés aux produits | M1§10 | P3 | CAT-01 | Testé et validé | D ✅ créer, modifier, archiver, cuisiner (déduction FEFO, annulable) · C ✅ Inventaire › Recettes : liste, fiche (parts ajustables), saisie avec produits proposés depuis l’inventaire · recipes.test + E2E `recipes.spec` (2 parcours) + robot « chaque bouton » | — |
| ADV-02 | Recettes réalisables avec le stock | — | M1§10 | P3 | ADV-01 | Testé et validé | D ✅ `checkRecipe` : stock réel par ingrédient, unités converties, lots périmés exclus (DDM dépassée utilisable), rapprochement par nom/nom alternatif, ingrédient non suivi « à vérifier » (jamais supposé présent), classement réalisables puis anti-gaspillage · C ✅ statuts, filtres « Réalisables » et « Anti-gaspi » · unitaires + E2E | — |
| ADV-03 | Ingrédients manquants → liste | — | M1§10 | P3 | ADV-01 | Testé et validé | D ✅ manquants arrondis à l’achat, déduction de ce qui est déjà dans la liste · C ✅ « Ajouter N manquants à la liste » (source « recette », commentaire), bouton désactivé une fois couverts · unitaires + E2E | — |
| ADV-04 | Planification des repas | — | M1§10 | P4 | ADV-01, D5 | Reporté | À spécifier (D5) | — |
| ADV-05 | Gestion des restes | — | M1§10 | P4 | D5 | Reporté | À spécifier (D5) | — |
| ADV-06 | Tâches ménagères | — | M1§10 | P4 | D5 | Reporté | À spécifier (D5) | — |
| ADV-07 | Suggestions périodiques de réapprovisionnement | À partir de la cadence | M1§10 | P3 | ENG-06 | Testé et validé | D ✅ rythme des courses (dernier achat + intervalle du foyer) → rappel « Prochaines courses : N produits à prévoir » la veille, un par période, jamais sans achat enregistré, jamais d’ajout automatique · C ✅ cloche, centre de notifications, récapitulatifs push (canaux existants) ; « Tout ajouter » depuis Courses · unitaires | — |
| ADV-08 | Chiffrement de bout en bout | Confidentialité vis-à-vis de l'hébergeur | AUD (D4) | P4 | D4 | Reporté | Incompatible avec le moteur côté serveur | — |
| ADV-09 | PostgreSQL + RLS (option) | Pour de grandes instances | M4§6 (C8) | P4 | — | Reporté | — | — |

## 25. Tests, documentation, déploiement

| ID | Fonctionnalité | Description | Origine | Prio | Dépendances | État | Avancement réel | Tests nécessaires |
|---|---|---|---|---|---|---|---|---|
| TST-01 | Tests unitaires du domaine | — | M1§12 | P0 | — | Testé et validé | 76 tests verts (unités, commandes, moteur, GS1, OCR, statistiques, audit, notifications, semaine) | — |
| TST-02 | Tests d'intégration serveur | Comptes, foyers, sync, idempotence, concurrence, conflits | M1§12 | P0 | — | Testé et validé | `server/test/*.test.ts` : 59 tests (comptes, foyers, sync, isolation, données, services, semaine) | — |
| TST-03 | Tests d'isolation multi-foyers | Scénario A1/A2/B1/B2 | M4§8 | P0 | ISO-* | Testé et validé | = ISO-08 | — |
| TST-04 | Semaine familiale simulée | Domaine ✅ ; pile complète (2 membres, 2 appareils, hors ligne) ❌ | M3§11 | P0 | SYNC-* | Testé et validé | Domaine ✅ · pile serveur ✅ · interface ✅ `family-week.spec` : 2 membres, 2 appareils, inventaire guidé, liste partagée, coupure réseau, courses avec prix, péremption, contrôle de cohérence, journal | — |
| TST-05 | Tests de bout en bout | Parcours, temps réel, hors ligne, mobile, chaque bouton | M1§12 | P0 | C | Testé et validé | `e2e/*.spec.ts` : 70 parcours en 18 fichiers (téléphone émulé), dont 3 sur instances fraîches lancées par les tests | — |
| TST-06 | Audit global | Cohérence, simplicité, design, rapidité… | M3§11 | P0 | — | Testé et validé | Audit global de la phase 13 (PROJECT_PLAN, bilan) ; performances mesurées sur 1 000 produits / 50 000 mouvements | — |
| DOC-01 | PROJECT_PLAN.md | — | M1§13, M5 | P0 | — | Développé | Version 2.15 (fin de la phase 15) | — |
| DOC-02 | MASTER_SPEC.md | — | M5 | P0 | — | Développé | Créé | — |
| DOC-03 | FEATURE_TRACKER.md | — | M5 | P0 | — | Développé | Ce document | — |
| DOC-04 | Guide de déploiement gratuit | Docker, Raspberry Pi/NAS, Tailscale/Cloudflare | M1§1 | P0 | DEP-01 | Développé | `docs/DEPLOIEMENT.md` : matériel, Docker (étapes exécutées réellement, miroir mirror.gcr.io en cas de limite Docker Hub), réglages, accès HTTPS gratuit (Tailscale, Funnel ; Cloudflare Tunnel = domaine payant ; tunnels rapides sans temps réel), sauvegardes hors machine, restauration, mise à jour, commandes. Étapes Tailscale/Cloudflare non exécutables ici | Installation réelle |
| DOC-05 | Guide utilisateur | Pour transmettre l'application à d'autres familles | M4§9 | P1 | — | Développé | `docs/GUIDE_UTILISATEUR.md` : installation sur téléphone, rôles, premier inventaire, gestes, scanner, courses, prévisions, dépenses, hors ligne et conflits, données ; libellés vérifiés dans le code de l’interface | — |
| DEP-01 | Image Docker / compose | — | M1§1 | P0 | — | Testé et validé | Image construite réellement (98 Mo compressée) et lancée depuis zéro : installation neuve (dossier de données absent → créé et confié au compte non privilégié ; défaut trouvé et corrigé : le premier démarrage plantait), parcours navigateur (premier compte, foyer, produit), inscription sans invitation refusée, commandes d’administration (y compris lancées en root, sans fichier root laissé), redémarrage sans perte, sonde de santé « healthy », `docker compose up` ; journaux limités (rotation, requêtes journalisées seulement sur demande) | — |
| DEP-02 | Script de réinitialisation de mot de passe | Côté serveur | M4§1 | P1 | D2 | Testé et validé | CLI `lien-reinitialisation`, `utilisateurs`, `sauvegarde` exécutée réellement | — |

---

## Synthèse des statuts

| Statut | Nombre |
|---|---|
| Testé et validé | 236 |
| Développé | 48 |
| En développement | 8 |
| À développer | 0 |
| À spécifier | 0 |
| Reporté | 5 |
| Bloqué | 0 |
| **Total** | **297** |

*(Calculé automatiquement à partir des lignes du tableau.)*
