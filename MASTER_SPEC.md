# HOMEOS — Cahier des charges central (MASTER_SPEC)

> **Document de référence officiel du projet.** Tout ce que HOMEOS doit pouvoir faire est décrit ici.
> État réel de chaque fonctionnalité : `FEATURE_TRACKER.md`. Organisation et étapes : `PROJECT_PLAN.md`.
>
> Version 1.0 — 17/11/2026 — consolidation des messages M1 à M5.

---

## 0. Sources, conventions et règles de mise à jour

### 0.1 Sources consolidées
Toutes les demandes formulées depuis le début du projet sont **accessibles et ont été reprises intégralement**. Aucune n'a été perdue.

| Réf. | Message | Contenu principal |
|---|---|---|
| **M1** | « Projet HOMEOS — application intelligente de gestion familiale des stocks et des courses » | Concept, contraintes (0 €, PWA, hors ligne…), foyer et membres, inventaire, moteur d'approvisionnement, liste de courses, actions rapides, péremption, dépenses, tableau de bord, fonctionnalités avancées, design, fiabilité, méthode. |
| **M2** | « Fonctionnalité prioritaire : scanner intelligent universel » | Reconnaissance automatique, 3 modes de scan, GS1, OCR des dates, mouvements automatisés, fluidité, fiabilité. |
| **M3** | « Dernière phase d'enrichissement » | Inventaire initial guidé, quantités partielles, catalogue avancé, tickets de caisse, multi-magasins, budget avancé, cohérence des stocks, niveaux de fiabilité, notifications, sauvegarde/sécurité, audit global, semaine familiale simulée. |
| **M4** | « Architecture multi-foyers » | Plateforme pour un nombre illimité de familles, comptes, création de foyer, invitations (e-mail, lien, code), 3 rôles, plusieurs foyers par utilisateur, isolation absolue, synchronisation, tests d'isolation obligatoires. |
| **M5** | « Consolidation intégrale » | Création de ce document, du tracker et du plan ; audit ; arbitrage des contradictions ; processus de mise à jour. |

Les références du type `M3§7` renvoient au message M3, section 7.

### 0.2 Classes de priorité
| Code | Classe | Signification |
|---|---|---|
| **P0** | Indispensable | Sans elle, HOMEOS ne remplit pas sa mission ou n'est pas fiable/sûr. |
| **P1** | Importante | Attendue dès la première version utilisable par la famille. |
| **P2** | Complémentaire | Enrichit fortement l'usage, peut suivre la première version. |
| **P3** | Avancée | Modules additionnels (recettes, suggestions périodiques…). |
| **P4** | Future | Inscrite et conservée, à spécifier et planifier plus tard. |

**Une fonctionnalité non développée n'est pas abandonnée.** Elle reste dans ce document et dans le tracker.

### 0.3 Processus pour chaque nouvelle demande (M5§8)
1. Identifier les exigences concernées (nouvelles, modifiées, impactées).
2. Mettre à jour ce document (nouvelle section ou précision, sans supprimer l'existant).
3. Mettre à jour `FEATURE_TRACKER.md` (nouvelles lignes, statuts).
4. Mettre à jour `PROJECT_PLAN.md` si l'ordre ou les dépendances changent.
5. Vérifier les conséquences sur les fonctionnalités existantes et consigner toute contradiction en §16.

Une nouvelle demande **ne remplace jamais automatiquement** les précédentes : seules les précisions explicites qui modifient une décision antérieure l'emportent, et elles sont tracées en §16.

---

## 1. Vision

HOMEOS est le **système central de gestion des stocks et des achats** d'un foyer — et, plus largement, une **plateforme multi-foyers** que l'on peut transmettre à sa sœur, à des amis ou à d'autres familles (M4§9). Ce n'est pas une simple liste de courses mais un **système intelligent d'approvisionnement familial** (M1).

À tout moment, chaque foyer doit savoir (M1, objectif final) : ce qu'il possède ; où se trouvent les produits ; ce qui est bientôt terminé ; ce qui manque ; ce qu'il faut acheter, en quelles quantités et quand ; ce qu'il dépense ; ce qui risque de périmer.

Objectifs mesurables : faire gagner du temps, éviter les oublis, réduire le gaspillage, éviter les achats inutiles et en double, réduire les saisies manuelles inutiles et les erreurs de stock, **représenter aussi fidèlement que possible la réalité de la maison** (M3§12). Toutes les recommandations sont **explicables et fondées sur les données disponibles**.

---

## 2. Contraintes et décisions non négociables

| # | Règle | Origine |
|---|---|---|
| R1 | Budget de développement : **0 €**. Aucune dépendance payante indispensable, aucun abonnement. | M1§1, M3§12, M5§5 |
| R2 | Technologies **open source** privilégiées ; limites des services gratuits **vérifiées avant intégration**. | M1§1 |
| R3 | **Aucune IA générative.** Fonctions « intelligentes » = règles déterministes, statistiques, algorithmes classiques, données réelles. | M1§4, M3§12, M5§5 |
| R4 | Interface **en français**. | M1§1 |
| R5 | Utilisable sur **iPhone, Android, PC Windows, navigateur** ; **PWA installable**. | M1§1, M4§7 |
| R6 | **Plusieurs foyers indépendants**, données privées par foyer, plusieurs utilisateurs par foyer, un utilisateur peut appartenir à plusieurs foyers. | M4, M5§5 |
| R7 | Synchronisation entre membres ; **fonctionnement hors connexion** quand c'est possible. | M1§1, M3§10, M4§7 |
| R8 | **Ne jamais sacrifier la fiabilité des données** pour simplifier le développement. | M1§1 |
| R9 | **Ne jamais inventer** une consommation, une date de péremption ou un prix. | M1§4, M1§8, M2§7 |
| R10 | Le **design et l'expérience utilisateur** sont des priorités majeures ; pas d'interface générique ou « administrative ». | M1§11, M5§5 |
| R11 | Une fonctionnalité n'est terminée **qu'après vérification de son fonctionnement réel** (pas parce que son interface existe). | M1§13, M3§12, M5§4 |
| R12 | Ne pas ajouter de fonctionnalités artificiellement : fiabilité, cohérence et UX d'abord. | M3§12 |

---

## 3. Architecture technique

### 3.1 Choix retenu et justification
**Serveur auto-hébergeable Node.js (Fastify) + SQLite, client PWA React hors ligne, logique métier partagée.**

| Option | Verdict | Raison |
|---|---|---|
| Supabase (gratuit) | Écarté | Pas de sauvegarde automatique, mise en pause après 7 jours d'inactivité, 500 Mo (vérifié). Incompatible avec R8. |
| Firebase (Spark) | Écarté | Propriétaire, quotas, verrouillage. |
| PostgreSQL + Row Level Security | Possible plus tard | Nécessite un serveur PostgreSQL à héberger : plus lourd pour un Raspberry Pi/NAS. L'isolation est assurée autrement (§6), y compris au niveau base (clés étrangères composites, §6.3). |
| **Node.js + SQLite + PWA** | **Retenu** | 0 €, données chez l'hébergeur en un fichier, transactions ACID, sauvegardes simples et vérifiables, une seule logique métier client/serveur. |

Hébergement gratuit : ordinateur toujours allumé / Raspberry Pi / NAS (Docker) + accès distant via **Tailscale** (réseau privé) ou **Cloudflare Tunnel** (HTTPS public, offre Zero Trust gratuite jusqu'à 50 utilisateurs — vérifié). Une seule instance peut accueillir **plusieurs familles** ; chaque famille peut aussi héberger sa propre instance.

### 3.2 Structure
```
homeos/
├─ packages/shared   Domaine pur : types, unités, validation (zod), commandes, moteur, péremption,
│                    statistiques, audit, notifications, GS1, OCR (analyse de texte). Aucune I/O.
├─ packages/server   Fastify + better-sqlite3 : comptes, foyers, invitations, rôles, sync, SSE,
│                    sauvegardes, export/import, photos, codes-barres (proxy), Web Push.
├─ packages/web      PWA React + Vite : réplique IndexedDB par foyer, outbox, interface.
├─ e2e/              Tests Playwright (parcours, temps réel, hors ligne, isolation, mobile).
└─ docs/             Déploiement, sauvegarde/restauration, guide utilisateur.
```

### 3.3 Technologies (toutes gratuites)
TypeScript ; Fastify 5 ; SQLite (better-sqlite3, WAL, `synchronous=FULL`, FK, CHECK) ; zod ; React 19 ; react-router 7 ; Vite 8 ; vite-plugin-pwa (Workbox) ; idb (IndexedDB) ; Lucide (icônes) ; police Manrope auto-hébergée ; **zxing-wasm** (codes 1D/2D, GS1) ; **Tesseract.js** + modèle français auto-hébergés (OCR) ; **web-push** (VAPID) ; Vitest ; Playwright. Bases produits : **Open Food Facts, Open Beauty Facts, Open Products Facts** (ODbL ; 100 requêtes/min en lecture ; User-Agent personnalisé obligatoire ; HTTP 503 au-delà — vérifié, API testée sur une fiche réelle).

### 3.4 Modèle d'exécution
- Le client n'écrit jamais l'état confirmé : il émet des **opérations** (intentions métier).
- Les **mêmes handlers** (`packages/shared/src/commands`) s'exécutent côté client (prédiction) et côté serveur (application dans une transaction SQLite).
- Les mouvements de stock sont des **deltas** (commutatifs) ; les modifications de fiches utilisent des **versions par champ**.

---

## 4. Architecture multi-foyers (fondation)

### 4.1 Concepts
- **Utilisateur** : une personne, un compte personnel (jamais de compte commun, M4§1).
- **Foyer** : espace privé et isolé ; possède inventaire, produits, emplacements, lots, mouvements, liste de courses, achats, historique, dépenses, paramètres, notifications, recommandations (M4).
- **Appartenance** (`members`) : lien utilisateur ↔ foyer avec un **rôle** ; un utilisateur peut avoir plusieurs appartenances.
- **Administrateur du serveur** (hébergeur) : distinct des administrateurs de foyer ; gère les sauvegardes de l'instance. Voir §16 (D4) pour la transparence vis-à-vis des familles hébergées.

### 4.2 Données rattachées au foyer
Chaque enregistrement métier porte `householdId` : produits, codes-barres, lots, emplacements, catégories, magasins, mouvements, achats/dépenses, tickets, listes de courses, sessions d'inventaire, recettes, activités/historique, notifications (préférences et journal), photos. Aucune donnée n'est partagée entre deux foyers **par défaut**. Exception documentée : le **cache public des fiches produits** (données Open Food Facts) est commun à l'instance, sans aucune information sur le foyer qui a scanné (voir ISO-09).

### 4.3 Sélection du foyer actif
- Sélecteur toujours accessible ; **nom (et avatar) du foyer actif affichés en permanence** (M4§5).
- Changer de foyer bascule **toute** l'application : réplique locale, liste, notifications, recommandations. Les répliques locales sont **séparées par foyer** (une base IndexedDB par couple utilisateur/foyer) ; aucun écran n'agrège plusieurs foyers.

---

## 5. Comptes, foyers, membres et autorisations

### 5.1 Comptes utilisateurs (M4§1)
- Inscription (e-mail, mot de passe ≥ 8 caractères, nom), connexion, déconnexion.
- **Récupération du mot de passe** : décision D2 (§16.2) — SMTP facultatif en libre-service, sinon lien à usage unique généré par l'administrateur du serveur ou par une commande sur le serveur.
- Profil : nom, couleur, préférences ; modification des informations personnelles (nom, e-mail, mot de passe — le changement de mot de passe déconnecte les autres appareils).
- Mots de passe hachés (scrypt + sel), sessions par cookie `HttpOnly`/`SameSite=Lax`/`Secure` (HTTPS), limitation des tentatives.
- **Protection des données personnelles** (M3§10) : export de ses données, suppression de son compte (anonymisation de l'historique : les mouvements restent attribués à « ancien membre »).
- Chaque action est **attribuée à son auteur** (mouvements, activités, achats, articles de liste).

### 5.2 Création d'un foyer (M4§2)
Après inscription : **« Créer un foyer »** ou **« Rejoindre un foyer avec une invitation »**. À la création : nom ; photo ou avatar facultatif ; paramètres initiaux (fréquence des courses, marge de sécurité, alertes de péremption, budget mensuel) ; **devise** ; **préférences de notifications**. Le créateur devient automatiquement **administrateur**. Catégories et emplacements par défaut créés (personnalisables).

### 5.3 Invitations (M4§3, M1§2)
Trois méthodes : **code** (10 caractères sans ambiguïté), **lien** (`/invitation/CODE`, partageable par SMS/WhatsApp/QR) et **e-mail** (voir D2). Règles définies par l'administrateur : rôle attribué, durée de validité (1–30 jours), nombre d'utilisations, révocation. Après acceptation, le nouveau membre **retrouve immédiatement** toutes les données du foyer (synchronisation initiale).

### 5.4 Rôles (M4§4) — décision : trois rôles
| Capacité | Administrateur | Membre | Lecture seule |
|---|:-:|:-:|:-:|
| Consulter stocks, listes, statistiques | ✔ | ✔ | ✔ |
| Gérer produits, stocks, scans, liste, achats, inventaires | ✔ | ✔ | ✖ |
| Modifier les paramètres du foyer | ✔ | ✖ | ✖ |
| Inviter, retirer des membres, changer les rôles | ✔ | ✖ | ✖ |
| Exporter les données du foyer | ✔ | ✔ | ✖ |
| Importer, supprimer le foyer | ✔ | ✖ | ✖ |
| Modifier son propre profil et ses préférences | ✔ | ✔ | ✔ |

Règles : le foyer garde **toujours au moins un administrateur** ; le dernier administrateur ne peut ni partir ni se rétrograder. Architecture **extensible** : chaque opération est associée à une **permission nommée** (`stock.write`, `shopping.write`, `catalog.write`, `household.settings`, `members.manage`, `data.export`, `data.import`…), et chaque rôle à un ensemble de permissions ; des permissions fines par membre pourront être ajoutées sans refonte.

### 5.5 Retrait d'un membre (M4§8)
Effet **immédiat** : toute requête suivante est refusée (vérification d'appartenance à chaque requête), la connexion temps réel reçoit un événement `revoked` et se ferme, l'application supprime la réplique locale de ce foyer sur l'appareil.

---

## 6. Sécurité et isolation des données

### 6.1 Principes (M4§6)
1. **Jamais de confiance** dans un `householdId` envoyé par le client : le foyer est désigné par l'URL **et** l'appartenance active de l'utilisateur est vérifiée côté serveur à chaque requête (`requireMember`). Un foyer dont on n'est pas membre répond 404 (aucune révélation d'existence).
2. **Couche d'accès unique filtrée** : toute lecture/écriture métier passe par `SqlStore(householdId)` ; chaque requête SQL inclut `householdId = ?`.
3. **Identifiants d'entités jamais trusted** : une référence vers une entité d'un autre foyer est introuvable (rejet) ; une tentative de créer une entité avec l'identifiant d'une entité d'un autre foyer est refusée par la base (`ON CONFLICT … WHERE householdId = excluded.householdId`).
4. **Isolation au niveau base** : clés étrangères vers le foyer (`ON DELETE CASCADE`), et — fondation à compléter — **clés étrangères composites `(householdId, id)`** pour qu'un lot, un mouvement ou un code ne puisse **physiquement** pas référencer un produit d'un autre foyer (équivalent structurel du RLS pour SQLite).
5. Photos, fichiers, exports, notifications, journaux d'envoi : **toujours** filtrés par foyer.
6. Aucun filtrage purement visuel n'est considéré comme une protection.

### 6.2 Autres mesures
Anti-CSRF (en-tête obligatoire + vérification d'origine), CSP stricte, `nosniff`, `frame-ancestors 'none'`, cookies sécurisés, limitation des tentatives (connexion, inscription, invitations), validation stricte de toutes les entrées (zod), erreurs serveur génériques (aucune fuite d'information), journal des actions.

### 6.3 Tests obligatoires d'isolation (M4§8)
Maison A (A1, A2, produits, liste) et Maison B (B1, B2, autres produits, autre liste). Vérifier : A1 et A2 voient A ; B1 et B2 voient B ; A1 ne peut pas accéder à B (lecture, écriture, photos, export, SSE, invitations) ; B1 ne peut pas accéder à A ; un membre retiré perd immédiatement ses droits ; un utilisateur multi-foyers passe de l'un à l'autre sans mélange ; **accès directs par API** ; **falsification de l'identifiant du foyer** (URL, charge utile, identifiants d'entités, alias, fusion, import).

---

## 7. Catalogue, inventaire et règles de gestion des stocks

### 7.1 Catégories et emplacements (M1§3, M3§1)
Catégories par défaut : Alimentation, Boissons, Produits frais, Produits surgelés, Épicerie, Hygiène, Entretien, Consommables, Autres produits domestiques (servent aussi de **rayons**). Emplacements par défaut : Cuisine, Réfrigérateur, Congélateur, Placards, Cellier, Garage, Buanderie, Salle de bain, Autres ; tous personnalisables (ajout, renommage, icône, archivage).

### 7.2 Fiche produit (M1§3, M3§3)
Nom ; marque ; famille (variantes) ; alias et noms alternatifs ; catégorie ; photo facultative ; unité de stock ; conditionnement (ex. 1 paquet = 500 g) ; seuil minimal ; quantité idéale ; emplacement par défaut ; magasin habituel ; conservation après ouverture ; conservation habituelle (suggestion uniquement) ; consommation estimée manuelle (facultative, étiquetée comme telle) ; suivi du réapprovisionnement ; commentaires ; **plusieurs codes-barres** (chacun avec son format, sa marque et la quantité qu'il représente). Affichés depuis les données : quantité disponible, lots, dates, prix enregistrés, **consommation moyenne calculée**, historique des mouvements.

### 7.3 Lots (M1§3, M3§2)
Chaque entrée de stock crée un **lot** : quantité restante (≥ 0), quantité initiale, date de péremption et sa **source**, type **DLC/DDM**, numéro de lot, date d'achat, ouverture, emplacement, prix unitaire, magasin, **source et fiabilité de la quantité** (comptée, scannée, reçue, saisie, approximative), date du dernier comptage. Quantités distinguées : **achetée** (achat), **initiale** (lot), **restante** (lot), **consommée** (Σ sorties du lot).

### 7.4 Règles de gestion des stocks
| # | Règle |
|---|---|
| S1 | Le stock d'un produit = Σ des lots ; le stock **utilisable** exclut les lots périmés. |
| S2 | **Aucune quantité négative** (contrainte base + domaine). Une sortie supérieure au stock retire ce qui reste, marque le mouvement `shortfall` et avertit (inventaire conseillé). |
| S3 | **Toute variation de stock est un mouvement** horodaté, attribué, typé, avec quantité avant/après, motif, source. **Aucune modification silencieuse.** |
| S4 | L'historique n'est **jamais supprimé** ; une erreur se corrige par **annulation compensatoire** (mouvement `revert` lié à l'original, une seule fois) ou par correction motivée. |
| S5 | Sorties en **FEFO** : lots non périmés d'abord, date effective la plus proche (min(DLC, ouverture + conservation après ouverture)), lots ouverts en priorité. Pertes « périmé » : lots périmés d'abord. |
| S6 | **Quantités décimales** partout (0,5 bouteille, 250 g, 300 ml, 1,5 kg) ; quantités approximatives signalées. |
| S7 | Conversions **uniquement** au sein d'une même famille d'unités (masse, volume, comptage) ou via le **conditionnement déclaré** du produit. Jamais de conversion entre unités incompatibles sans information fiable. Changer l'unité de stock d'un produit qui a un historique est interdit. |
| S8 | Ouvrir une unité d'un lot de plusieurs unités **isole l'unité ouverte** dans son propre lot. |
| S9 | Une correction d'inventaire porte la **quantité attendue** : si le stock a changé entre-temps, **conflit** non appliqué, l'utilisateur tranche. |
| S10 | **Aucun ajout ni retrait de stock sans action explicite** de l'utilisateur (scan dans le mode correspondant, action manuelle, validation d'une réception, d'un ticket ou d'un inventaire). Cocher un article « acheté » ne modifie pas le stock. |
| S11 | Un même code-barres n'appartient qu'à un produit par foyer. |
| S12 | Deux produits ne sont **jamais fusionnés automatiquement** ; la fusion est validée par l'utilisateur et conserve tout l'historique (conversion d'unités vérifiée). |

### 7.5 Actions rapides (M1§6)
Ajouter au stock ; retirer ; consommer ; déclarer terminé (avec ajout facultatif à la liste) ; signaler manquant (ajout prioritaire à la liste, sans toucher au stock, avec alerte si le stock théorique diffère) ; modifier une quantité (avec motif : inventaire physique, consommation non enregistrée, erreur de saisie, perte) ; signaler ouvert ; déplacer ; jeter (périmé, abîmé, autre) ; annuler une action. La **saisie manuelle reste toujours possible** (M1§6, M2§1).

---

## 8. Scanner intelligent universel (M2)

### 8.1 Lecture
Caméra du téléphone ou de l'ordinateur ; codes **1D** (EAN-13/8, UPC-A/E, Code 128, ITF) et **2D** (QR, DataMatrix, GS1 DataBar) via zxing-wasm auto-hébergé ; lecture continue, retour haptique/sonore discret ; saisie manuelle du code possible.

### 8.2 Identification
1. Normalisation GTIN (clé de contrôle, GTIN-14→13, UPC-A→EAN-13).
2. **Catalogue local du foyer** (codes associés) — fonctionne **hors connexion**.
3. Sinon, via le serveur (cache) : Open Food Facts → Open Beauty Facts (hygiène) → Open Products Facts (entretien/ménager) : nom, marque, photo, catégorie, format.
4. Si le nom trouvé ressemble à un produit existant : **question de validation** (« Associer à “Lait demi-écrémé” ? ») — jamais d'association automatique.
5. Code inconnu partout : création rapide avec **seulement les champs indispensables**.

### 8.3 Données GS1 (M2§3)
GS1-128, GS1 DataMatrix, GS1 QR, **GS1 Digital Link** : (01) GTIN, (10) n° de lot, (15) DDM, (17) date limite, (310n)/(320n) poids net, (392n) prix. Dates « 00 » = dernier jour du mois, fenêtre de siècle GS1. **Un code-barres classique n'est jamais supposé contenir une date.** Codes magasin à poids variable (préfixe 2) identifiés et non interprétés.

### 8.4 Trois modes (M2§2, M2§5)
| Mode | Effet d'un scan | Règles |
|---|---|---|
| **Réception** | +1 conditionnement (quantité du code) | Lot créé, ou complété si même produit + même date + même n° de lot dans la session ; date issue du GS1 si présente, sinon proposition OCR, sinon date inconnue. |
| **Consommation** | −1 | FEFO ; historique conservé. |
| **Inventaire** | +1 au comptage | Ajoute une ligne de comptage à une session ; écarts présentés ; **correction seulement après confirmation**. |

Un scan = **1 unité par défaut**, quantité modifiable très rapidement (+/−, ½, saisie).

### 8.5 Fluidité (M2§6)
Traitement **immédiat** si tout est connu ; sinon **une seule question** (la date ? quel produit ?) ; confirmation discrète « **+1 Lait ajouté** » / « **−1 Lait consommé** » avec **Annuler** ; **mode continu** sans revenir au menu.

### 8.6 Fiabilité (M2§7)
Jamais de date inventée ; aucun mouvement sans scan dans le mode correspondant (ou action explicite) ; **anti-doublon** (même code relu en moins de 2,5 s ignoré et signalé ; `opId` unique par scan ; détection d'audit des mouvements identiques rapprochés) ; erreurs de lecture, codes invalides, inconnus et non référencés gérés avec un message clair.

### 8.7 OCR des dates (M2§4)
Si la date n'est pas dans le code : proposer de **photographier l'étiquette** ; OCR local (Tesseract.js, français) ; reconnaissance des mentions **DLC** (« à consommer jusqu'au », « use by ») et **DDM** (« à consommer de préférence avant », « DLUO », « best before ») et des formats JJ/MM/AA(AA), JJ.MM, MM/AAAA, mois en lettres ; corrections des confusions OCR ; **affichage de la date détectée et confirmation obligatoire** ; source enregistrée « reconnue et confirmée ».

---

## 9. Inventaires (M3§1, M2§5)

### 9.1 Inventaire initial guidé
Assistant parcourant les espaces (Cuisine, Réfrigérateur, Congélateur, Placards, Cellier, Salle de bain, Buanderie, Garage, espaces personnalisés) ; **scan à la chaîne** ou recherche ; quantités (y compris approximatives), emplacements et dates **modifiables avant validation** ; **pourcentage d'avancement** ; **sauvegarde automatique et reprise** (session synchronisée, reprenable sur un autre appareil) ; validation finale avec récapitulatif.

### 9.2 Inventaire correctif / vérification
Comparaison **par emplacement** du stock théorique (lots situés dans les espaces inventoriés) et du compté ; écarts listés ; correction **après confirmation** ; conflit si le stock a bougé pendant l'inventaire ; lignes de produits inconnus à résoudre avant validation ; les lots vérifiés passent au niveau de fiabilité « compté ».

---

## 10. Liste de courses, mode courses, réception, magasins

### 10.1 Liste collaborative (M1§5)
Ajout manuel / depuis le stock / depuis les recommandations / depuis une recette ; quantités, unités, commentaires, priorités (normale, haute, urgente), rayon (catégorie), magasin, attribution à un membre ; statut acheté / partiel / non acheté ; suppression (réversible) ; historique. **Doublons regroupés automatiquement** et **quantités additionnées** quand plusieurs membres ajoutent le même produit (contributeurs conservés). Avertissement si le stock est déjà suffisant ou si l'article est déjà listé.

### 10.2 Mode courses (M1§5, M1§11, M3§5)
Plein écran pour téléphone : **grandes cases**, très lisible, **regroupement par magasin puis par rayon** (ordre des rayons propre à chaque magasin), quantités visibles, navigation simple, progression, écran maintenu allumé, **mise à jour instantanée** chez les autres membres, prix saisissable en option.

### 10.3 Réception (M1§5)
À la fin des courses, HOMEOS **propose** de mettre à jour l'inventaire : étape de réception confirmant les **quantités réellement achetées**, les écarts, le prix, le magasin, les dates, l'emplacement ; création des lots, des mouvements « achat » et des dépenses ; le reliquat d'un achat partiel reste dans la liste ; un article libre peut devenir un produit suivi.

### 10.4 Magasins (M3§5)
Nom, adresse facultative, notes, couleur, ordre des rayons ; historique des achats ; **produits habituellement achetés** ; répartition de la liste entre magasins.

---

## 11. Tickets de caisse (M3§4)
Photo ou import d'image → OCR → reconnaissance du **magasin, date, produits, quantités, prix unitaires, prix total, promotions/remises** (articles au poids compris) ; contrôle de cohérence (Σ lignes − remises ≈ total) ; **écran de validation** associant chaque ligne à une référence (alias appris par magasin = sûr ; nom identique = probable ; ressemblance = **incertain, signalé** ; aucun = produit inconnu à créer ou ignorer). Après validation seulement : mouvements de réception (lignes cochées), prix enregistrés, dépenses, apprentissage des libellés. **Jamais d'ajout de stock depuis un OCR non vérifié.**

---

## 12. Moteur intelligent d'approvisionnement (M1§4, M3§8)

### 12.1 Calculs
1. **Stock utilisable** (hors périmés) et stock total.
2. **Consommation observée** : sorties `consume`, `finish` et corrections « consommation non enregistrée » sur 120 jours, **pondérées exponentiellement** (demi-vie 30 jours), en **excluant les périodes de rupture** ; mouvements annulés ignorés.
3. **Cadence d'achat** : réapprovisionnements regroupés par jour → intervalle médian, régularité (coefficient de variation ≤ 0,5), quantité habituelle, prochain achat probable ; débit déduit des achats (≥ 3 achats sur ≥ 21 jours).
4. **Confiance** : élevée (≥ 6 relevés sur ≥ 30 j) ; moyenne (≥ 3 sur ≥ 14 j) ; faible ; aucune. Sources par priorité : observée (≥ moyenne) → achats (≥ moyenne) → estimation manuelle saisie → observée faible → aucune.
5. **Autonomie** = stock utilisable / débit → date de rupture estimée.
6. **Risque de gaspillage** : simulation FEFO au rythme estimé.
7. **Qualité des données** : quantité approximative, consommations sur stock insuffisant, absence de comptage depuis longtemps → confiance plafonnée et mention dans l'explication ; alerte « inventaire à vérifier ».

### 12.2 Règles de recommandation
| Déclencheur | Urgence |
|---|---|
| Stock utilisable épuisé | Maintenant |
| Stock ≤ seuil minimal | Maintenant |
| Rupture prévue avant `fréquence des courses + marge` (débit fiable) | Maintenant si ≤ marge, sinon Bientôt |
| Achat régulier attendu avant la prochaine course (sans débit fiable) | À prévoir |

Quantité = max(quantité idéale, débit × (fréquence + horizon)) − stock utilisable − **quantité déjà dans la liste**, arrondie au **conditionnement d'achat**. Sans aucune donnée : un conditionnement, en le disant. Si la liste couvre déjà le besoin : « déjà prévu ». **Sans historique suffisant, seuls les seuils configurés sont utilisés** ; aucune consommation n'est inventée.

### 12.3 Explications
Chaque recommandation affiche une phrase complète (« *Acheter 2 bouteilles de lait : le stock actuel devrait être épuisé dans environ 3 jours.* »), un détail (objectif, quantité déjà listée, consommation et sa source, qualité du stock), un **niveau de confiance**, une date conseillée et un **coût estimé** (prix connu/estimé/inconnu).

---

## 13. Péremption, dépenses, tableau de bord, notifications

### 13.1 Péremption et anti-gaspillage (M1§7)
Statuts par lot : périmé, aujourd'hui, urgent (≤ 2 j), bientôt (≤ 7 j), ok, date inconnue ; DLC vs DDM ; produits ouverts ; **produits oubliés** (aucun mouvement depuis N jours, plus court pour le réfrigérateur) ; « à consommer en priorité » ; tableau de bord anti-gaspillage (pertes en nombre et en valeur — valorisées uniquement avec les prix enregistrés —, motifs, produits les plus jetés, valeur des produits à sauver dans le délai « bientôt », risque de gaspillage). Une DDM dépassée est présentée comme « souvent encore consommable, à vérifier », une DLC dépassée comme à ne plus consommer. Les quantités « à risque » ne sont calculées qu'avec une consommation fiable. Le calendrier des ruptures ne contient que des produits à consommation fiable (ou à achats réguliers) : aucun produit sans données n'est extrapolé.

### 13.2 Dépenses et budget (M1§8, M3§6)
Achats enregistrés (produit, quantité, prix, remise, magasin, date, membre, ticket). Dépenses **hebdomadaires, mensuelles, annuelles, par catégorie, par magasin** ; **évolution** des dépenses et des **prix** ; **produits les plus coûteux** ; **budget mensuel** défini, **projection** de fin de mois au rythme réel ; **budget moyen** (mois) et **panier moyen** ; **comparaison des prix** unitaires (€/kg, €/L, €/unité) par magasin ; **coût estimé des prochains achats**. Distinction systématique **prix connu / estimé / inconnu**. **Aucun prix inventé.** Dépenses inhabituelles détectées.

### 13.3 Tableau de bord (M1§9)
Indicateurs (produits, stocks faibles, épuisés, à acheter, bientôt périmés), liste de courses actuelle, derniers mouvements, dépenses du mois et budget, prévisions d'approvisionnement, section centrale **« Ce que votre maison doit prévoir »** ; **personnalisable** (widgets affichables/masquables et réordonnables, par membre).

### 13.4 Notifications (M1§2, M3§9)
**Centre de notifications** : stocks critiques, produits épuisés, bientôt périmés, à acheter, courses non terminées, modifications importantes, dépenses inhabituelles, inventaires à vérifier, anomalies de données ; fil d'activité partagé du foyer. **Personnalisation par membre** (types désactivés, alertes masquées). **Déduplication** par clé stable. **Récapitulatif quotidien ou hebdomadaire** (Web Push, heure choisie) plutôt que des alertes multiples ; alertes immédiates facultatives pour les événements importants. Strictement **par foyer**.

### 13.5 Niveaux de fiabilité (M3§8)
| Information | Niveaux affichés |
|---|---|
| Quantité | Comptée · Scannée/Reçue · Saisie · Approximative · Calculée (déduite des mouvements depuis le dernier comptage) |
| Date | Lue dans le code (GS1) · Saisie · Reconnue (OCR) et confirmée · Estimée · Inconnue |
| Consommation | Observée (confiance) · Déduite des achats · Estimation manuelle · Aucune donnée |
| Prix | Connu · Estimé · Inconnu |

**Jamais une estimation présentée comme exacte** (badge, « ≈ », libellé) ; le moteur en tient compte.

### 13.6 Contrôle de cohérence (M3§7)
Détection (sans correction automatique) : quantité négative ; Σ mouvements ≠ lot ; arithmétique avant/après ; produit ajouté deux fois / doublons probables ; mouvements identiques à quelques secondes ; écart théorique/physique ; consommation sur stock nul ; dates incohérentes (avant l'achat, > 10 ans, déjà dépassée à la réception) ; inventaires en suspens ; références cassées. Chaque anomalie mène à une action de correction (annuler, corriger, fusionner, inventorier).

---

## 14. Synchronisation, hors ligne, sauvegardes

### 14.1 Synchronisation (M1§12, M4§7)
- Outbox IndexedDB : une opération reste « en attente » **tant que le serveur ne l'a pas confirmée** ; indicateur visible (synchronisé / en attente (n) / hors ligne / problème).
- Idempotence par `opId` (résultat enregistré dans la même transaction que les écritures) ; ordre des opérations d'un appareil conservé.
- Une opération restée hors ligne **plus de 150 jours** est refusée (message explicite) ; le journal d'idempotence est conservé 180 jours : une opération ne peut donc jamais être appliquée deux fois.
- Pull incrémental paginé (curseur `seq`), temps réel par SSE, repli au retour au premier plan / en ligne / toutes les 60 s ; **époque** (`epoch`) : resynchronisation complète après restauration.
- Conflits : deltas commutatifs ; correction de stock avec quantité attendue ; versions par champ (fusion des champs non concurrents, choix utilisateur pour les autres) ; fusion des doublons de liste avec alias d'identifiant ; « déjà acheté par X ».
- Résultats : appliqué, appliqué avec avertissements, conflit, rejeté — tous visibles.
- **Saisie en cours protégée** : une modification reçue en arrière-plan (confirmation du serveur, action d'un autre membre) ne réinitialise jamais un formulaire ouvert ; la version de référence servant à détecter les conflits est celle affichée à l'ouverture du formulaire.
- Plateformes : iPhone (Safari, PWA installée), Android (Chrome), Windows (Edge/Chrome), navigateurs récents.
- **Jamais de synchronisation entre foyers** ; données locales d'un foyer quitté supprimées.

### 14.2 Sauvegardes et restauration (M1§12, M3§10)
- **Sauvegardes automatiques** quotidiennes (API de sauvegarde en ligne SQLite), **versionnées** (14 quotidiennes + 12 mensuelles), avant chaque import, restauration ou suppression de foyer.
- **Chaque sauvegarde est vérifiée** (réouverture, `integrity_check`, clés étrangères, lecture des tables) et documentée (taille, empreinte SHA-256, comptages).
- **Restauration** : serveur complet (administrateur du serveur uniquement, sauvegarde préalable, nouvelle époque) ; **restauration d'un seul foyer** par un administrateur de ce foyer, sans affecter les autres familles : les données du foyer à la date choisie sont recréées dans un **nouveau foyer** « (restauré du JJ/MM/AAAA) », avec ses membres et leurs rôles ; l'original n'est jamais écrasé.
- Chaque sauvegarde est un **fichier autonome** (journal SQLite classique, sans fichiers annexes), accompagné d'une fiche JSON.
- **Export complet** JSON (avec photos) et CSV (inventaire, achats, mouvements) ; **import complet** (nouveau foyer, identifiants régénérés, contrôle d'intégrité).
- **Un export n'est pas une sauvegarde automatique** ; les deux existent.
- **Test automatisé** : sauvegarde → restauration → données identiques.

---

## 15. Design et expérience utilisateur (M1§11, M2§6)
- Produit **professionnel et haut de gamme** : moderne, épuré, typographie soignée, hiérarchie visuelle excellente, couleurs cohérentes, cartes élégantes, icônes professionnelles, animations subtiles, **graphiques interactifs**, **mode clair et sombre**.
- **Mobile d'abord** ; bureau avec barre latérale.
- Navigation : **Accueil, Inventaire, Courses, Prévisions, Famille, Paramètres** ; **bouton Scanner** accessible partout ; sélecteur de foyer et nom du foyer actif toujours visibles.
- Mode courses spécialement optimisé pour le magasin ; scanner fluide (§8.5).
- Formulaires minimaux, questions uniquement nécessaires, valeurs par défaut intelligentes, annulation possible, messages d'erreur clairs en français.
- Accessibilité : contrastes suffisants, cibles tactiles ≥ 44 px, textes lisibles.
- Les notifications éphémères ne masquent jamais une action : quand une fiche ou le mode courses est ouvert, elles s'affichent en haut de l'écran.
- **Chaque bouton fonctionne** ; chaque modification est enregistrée (vérifié par tests E2E).

---

## 16. Contradictions, arbitrages et décisions à valider

### 16.1 Arbitrages effectués (dernière précision explicite prioritaire, exigences compatibles conservées)
| # | Contradiction | Décision |
|---|---|---|
| C1 | Conception initiale à 4 rôles (propriétaire/admin/membre/lecture) ↔ M4§4 : **3 rôles** | **3 rôles** (M4 prévaut). Le « créateur » devient un attribut, plus un rôle. Protection : au moins un administrateur. Code à adapter. |
| C2 | M1§2 « plusieurs foyers *à terme* » ↔ M4 : multi-foyers **dès les fondations** | M4 prévaut ; l'architecture était déjà multi-foyers, l'isolation est renforcée (§6). |
| C3 | Proposer une date via la durée de conservation habituelle ↔ « ne jamais inventer une date » (M2§7) | Simple **suggestion explicite**, acceptée par l'utilisateur et marquée **estimée** ; sinon date inconnue. |
| C4 | Actions rapides « ajouter/retirer » (M1§6) ↔ « jamais d'ajout/consommation sans scan dans le mode correspondant » (M2§7) | Règle S10 : **aucune variation sans action explicite** de l'utilisateur ; la saisie manuelle reste toujours possible (M1§6, M2§1). |
| C5 | « Proposer de mettre à jour automatiquement l'inventaire après achat » (M1§5) ↔ « jamais d'ajout automatique non vérifié » (M3§4) | HOMEOS **propose**, l'utilisateur **confirme** en une étape (réception, « tout réceptionner »). |
| C6 | Notifications « partagées » (M1§2) ↔ « personnalisées par membre » (M3§9) | Fil d'activité partagé du foyer + préférences individuelles pour les alertes et récapitulatifs. |
| C7 | Restauration d'une sauvegarde serveur ↔ plateforme multi-familles (M4) | Restauration complète réservée à l'hébergeur, avec avertissement ; ajout de la **restauration d'un seul foyer**. |
| C8 | « Row Level Security si SQL » (M4§6) ↔ SQLite sans RLS | Isolation par couche d'accès obligatoire + vérification serveur + **clés étrangères composites** + tests d'isolation. PostgreSQL/RLS reste une option future. |

### 16.2 Décisions validées (17/11/2026 — « je te fais confiance, vas-y »)
Les propositions par défaut ont été adoptées. Elles restent modifiables.

| # | Sujet | Décision retenue |
|---|---|---|
| **D1** | **Inscription sur la plateforme** | Le premier compte de l'instance est libre (il devient administrateur du serveur). Ensuite, inscription **sur code** : soit une **invitation de foyer** (rejoindre un foyer existant), soit une **invitation plateforme** (créer son propre foyer), générée par l'administrateur du serveur **ou par tout administrateur de foyer**. Mode « inscription ouverte » activable par configuration (`HOMEOS_REGISTRATION=open`). |
| **D2** | **E-mails sans service payant** | **SMTP facultatif** avec votre propre boîte (gratuit) pour : invitation par e-mail, « mot de passe oublié » en libre-service. Sans SMTP : l'invitation par e-mail ouvre l'application de messagerie de l'appareil avec un message pré-rempli (lien `mailto:`) ; la réinitialisation se fait par un **lien à usage unique (24 h)** généré par **l'administrateur du serveur** (interface ou commande sur le serveur). **Précision de sécurité** : un administrateur de foyer ne peut **pas** générer ce lien, car il pourrait ainsi prendre le contrôle d'un compte qui appartient aussi à d'autres foyers. |
| **D3** | **Suppression d'un foyer** | Tout administrateur du foyer, avec double confirmation (saisie du nom) et sauvegarde automatique préalable. |
| **D4** | **Confidentialité vis-à-vis de l'hébergeur** | Isolation stricte entre familles dans l'application ; **information claire** des foyers hébergés : la personne qui héberge l'instance peut techniquement accéder à la base. Chiffrement de bout en bout reporté (P4). Alternative documentée : une instance par famille. |
| **D5** | **Repas, restes, tâches ménagères** | Inscrits en P4, à spécifier ensemble avant développement. |

Règles complémentaires découlant de D1/D2 :
- Une invitation de foyer peut être **réservée à une adresse e-mail** : seul un compte avec cette adresse peut l'accepter.
- « Mot de passe oublié » répond toujours le même message, que l'adresse existe ou non (aucune énumération des comptes).
- Une réinitialisation déconnecte tous les appareils du compte.

---

## 17. Fonctionnalités avancées (M1§10)
Recettes (ingrédients liés aux produits, portions) ; **recettes réalisables avec le stock** ; **ingrédients manquants → liste** ; « cuisiner » (déduction des ingrédients du stock, FEFO) ; planification des repas ; gestion des restes ; gestion des produits ouverts (déjà au cœur, §7.5) ; tâches ménagères ; comparaison des prix (§13.2) ; plusieurs magasins (§10.4) ; plusieurs foyers (§4) ; **suggestions de réapprovisionnement périodiques** (cadence d'achat). Ces modules **ne doivent pas compromettre** les fonctionnalités principales : chacun est un type d'entité + des commandes, sans toucher au cœur.

---

## 18. Modèle de données (référence)

Tables d'entités synchronisées (toutes : `id` PK, `householdId` FK → foyer, `version`) :
`households` (nom, devise, avatar, paramètres, versions par champ) · `members` (utilisateur, nom, e-mail, rôle, couleur, actif, préférences) · `categories` · `locations` (type frigo/congélateur/placard/autre) · `stores` (adresse, notes, ordre des rayons) · `products` · `productCodes` (code unique par foyer, quantité par scan, format, marque, source) · `lots` (`CHECK quantity ≥ 0`) · `movements` (avant/après, source, drapeaux, annulation) · `shoppingItems` · `purchases` (montants en centimes, `null` = prix inconnu) · `receipts` · `inventorySessions` · `activities` · `recipes`.

Tables serveur : `users`, `sessions` (hachage du jeton), `invitations`, `processed_ops` (idempotence), `id_aliases`, `tombstones`, `photos` (par foyer), `barcode_cache` (public), `push_subscriptions`, `notification_log`, `meta` (`seq`, `epoch`, version de schéma).

Invariants (vérifiés par le contrôle d'intégrité et les tests) : quantités ≥ 0 ; quantité d'un lot = Σ de ses mouvements ; `avant + variation = après` ; un `opId` appliqué une fois ; un code par produit et par foyer ; une annulation unique ; aucune référence inter-foyers.

---

## 19. Tests nécessaires (M1§12, M3§11, M4§8)
- **Unitaires (domaine)** : unités et conversions ; FEFO ; quantités partielles et approximatives ; ouverture ; déplacement ; annulation ; conflits ; fusion de liste ; achats partiels ; réception ; codes multiples ; fusion de produits ; inventaires ; tickets ; moteur (pondération, ruptures, confiance, seuils, liste, conditionnement, cadence, qualité, gaspillage) ; GS1 ; OCR dates et tickets ; statistiques ; audit ; notifications.
- **Intégration (serveur)** : comptes, sessions, limitation ; foyers, invitations, rôles, retrait ; push/pull, idempotence (rejeu), concurrence, ordre hors ligne, alias ; export/import ; sauvegarde → restauration ; push ; proxy codes-barres (simulé).
- **Isolation multi-foyers** : scénario A1/A2/B1/B2 complet (§6.3).
- **Semaine familiale simulée** : réception, ajouts, consommation, ouvertures, modifications, liste, achat, mise à jour du stock, péremption, inventaire correctif — **au niveau domaine et sur la pile complète** (deux membres, deux appareils, hors ligne partiel), invariants vérifiés chaque jour.
- **Bout en bout (Playwright)** : parcours complet ; deux membres en temps réel ; hors ligne puis reconnexion ; mobile (iPhone/Android émulés) ; changement de foyer sans mélange ; chaque bouton.
- **Audit global** périodique : cohérence, simplicité, design, rapidité, scanner, lots, synchronisation, calculs, recommandations, conservation des données.

---

## 20. Feuille de route
Voir `PROJECT_PLAN.md` (phases, dépendances, critères de sortie) et `FEATURE_TRACKER.md` (état de chaque fonctionnalité).
