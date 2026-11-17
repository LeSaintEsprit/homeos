# HOMEOS — Plan de projet

> Système familial de gestion des stocks domestiques et d'approvisionnement intelligent.
> Budget : 0 €. 100 % open source. Auto-hébergeable. PWA installable (PC, iPhone, Android).

---

## 1. Décisions d'architecture

### 1.1 Choix retenu : serveur auto-hébergé Node.js + SQLite, client PWA hors ligne

| Option étudiée | Verdict | Raison |
|---|---|---|
| Supabase (offre gratuite) | ❌ écarté | Pas de sauvegarde automatique sur l'offre gratuite, projet mis en pause après 7 jours d'inactivité, base limitée à 500 Mo. Incompatible avec « ne jamais sacrifier la fiabilité des données ». |
| Firebase (Spark) | ❌ écarté | Service propriétaire, verrouillage, quotas journaliers, pas d'export SQL simple. |
| PocketBase | ⚠️ possible | Bon produit, mais logique métier (stocks, conflits) à écrire en hooks JS limités ; moins de contrôle sur le protocole de synchronisation. |
| **Node.js + SQLite + PWA** | ✅ retenu | Aucune dépendance externe, données chez vous (un seul fichier), transactions ACID, sauvegardes triviales, logique métier partagée client/serveur. |

**Hébergement gratuit recommandé** (détails dans `docs/DEPLOIEMENT.md`) :
1. Un ordinateur toujours allumé / Raspberry Pi / NAS à la maison (Docker) ;
2. Accès depuis l'extérieur via **Tailscale** (réseau privé, aucune exposition publique) ou **Cloudflare Tunnel** (HTTPS public, offre gratuite Zero Trust jusqu'à 50 utilisateurs).

### 1.2 Vue d'ensemble

```
┌──────────────────────── Téléphone / PC (PWA) ─────────────────────────┐
│ React UI ── store réactif ── Vue = État confirmé + Opérations en attente│
│                                   │                    │               │
│                          IndexedDB (réplique)    IndexedDB (outbox)     │
│                                   ▲                    │ push (lots)   │
│        Service Worker (cache hors ligne de l'app)      ▼               │
└───────────────────────────────────┼──── HTTPS ─────────┼───────────────┘
                                    │ pull (curseur seq) │
┌───────────────────────────────────┴────────────────────┴───────────────┐
│ Serveur Fastify                                                        │
│  /api/auth  /api/households  /sync/push  /sync/pull  /events (SSE)     │
│  Handlers de commandes PARTAGÉS (@homeos/shared) ── SQLite (WAL, FK)    │
│  Sauvegardes automatiques quotidiennes (VACUUM INTO) + rotation         │
└────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Monorepo

```
homeos/
├─ packages/shared   Domaine pur TypeScript (aucune I/O) : unités, entités, validation (zod),
│                    handlers de commandes, moteur d'approvisionnement, péremption, statistiques.
├─ packages/server   Fastify 5 + better-sqlite3 : auth, foyers, invitations, sync, SSE,
│                    export/import, sauvegardes, contrôle d'intégrité, proxy codes-barres.
├─ packages/web      React 19 + Vite 8 + vite-plugin-pwa : interface, réplique locale, outbox.
├─ e2e/              Tests Playwright de bout en bout (multi-utilisateurs, hors ligne).
└─ docs/             Déploiement, sauvegarde/restauration.
```

---

## 2. Modèle de synchronisation (cœur de la fiabilité)

### 2.1 Principes
1. **Le serveur est l'autorité.** Le client ne modifie jamais directement l'état confirmé : il émet des **opérations** (intentions métier : « consommer 1 L de lait »).
2. **Les mêmes handlers** (`packages/shared/src/commands`) s'exécutent :
   - côté client, sur une copie en mémoire, pour l'affichage immédiat (prédiction optimiste) ;
   - côté serveur, dans une **transaction SQLite**, pour l'application réelle.
3. **Les mouvements de stock sont des deltas** (−1, +6…) : deux personnes qui consomment en même temps ne s'écrasent jamais, leurs mouvements s'additionnent.
4. **Idempotence** : chaque opération porte un `opId` (UUID). Le serveur enregistre le résultat dans `processed_ops` *dans la même transaction* que l'application. Un renvoi (réseau coupé avant la réponse) renvoie le résultat mémorisé sans ré-appliquer.
5. **Une synchronisation n'est réussie qu'après confirmation** : l'opération reste dans l'outbox IndexedDB tant que le serveur n'a pas répondu `applied`. L'indicateur de synchronisation affiche le nombre d'opérations en attente.
6. **Ordre garanti** : les opérations d'un appareil sont envoyées dans l'ordre et appliquées séquentiellement.

### 2.2 Versions et curseur
- Compteur global monotone `seq` (table `meta`), incrémenté à chaque écriture d'entité dans la transaction (annulé avec elle en cas d'erreur).
- Chaque entité porte `version = seq` de sa dernière écriture ; les suppressions laissent une **pierre tombale** (`tombstones`).
- `pull?since=N` renvoie toutes les entités du foyer avec `version > N` (paginé, trié par version), puis le client avance son curseur.
- Temps réel : le serveur notifie via **Server-Sent Events** (`{seq}`), le client tire les changements. Repli : pull au retour au premier plan, au retour en ligne et toutes les 60 s.

### 2.3 Conflits
| Cas | Traitement |
|---|---|
| Consommations simultanées | Deltas commutatifs → aucun conflit. |
| Consommation supérieure au stock réel (deux personnes prennent la dernière bouteille hors ligne) | Le serveur retire ce qui reste, journalise l'écart et renvoie un **avertissement** visible. Jamais de stock négatif (contrainte `CHECK`). |
| Correction d'inventaire (« il en reste 4 ») alors que le stock a changé entre-temps | L'opération porte la quantité `attendue`. Si elle diffère de la valeur serveur → **conflit** non appliqué, l'utilisateur choisit. |
| Modification concurrente d'un même champ (seuil, nom…) | Versions par champ (`fv`). Les champs non concurrents fusionnent ; les champs en conflit ne sont pas écrasés et l'utilisateur tranche (« garder ma valeur » / « garder celle de Marie »). |
| Même produit ajouté deux fois à la liste | Fusion automatique, quantités additionnées, contributeurs conservés, alias d'identifiant pour les opérations suivantes. |
| Article coché par deux personnes | Le second reçoit « déjà acheté par X ». |

### 2.4 Résultats d'opération
`applied` · `applied` + `warnings[]` · `conflict` (non appliquée, détails) · `rejected` (validation/permission). Les conflits et rejets apparaissent dans **Paramètres → Synchronisation** et en notification.

---

## 3. Modèle de données (SQLite)

Toutes les tables métier ont `id TEXT PK`, `householdId` (FK), `version INTEGER` (+ index `(householdId, version)`). Quantités en `REAL` arrondies à 1e-6 dans l'unité de stock du produit ; **montants en centimes (INTEGER)**.

### Comptes (serveur uniquement)
- `users(id, email UNIQUE, name, passwordHash scrypt, createdAt)`
- `sessions(tokenHash PK, userId, createdAt, expiresAt, lastSeenAt, userAgent)`
- `invitations(id, householdId, code UNIQUE, role, createdBy, expiresAt, maxUses, uses, revokedAt)`
- `processed_ops(opId PK, householdId, userId, type, result JSON, at)`
- `id_aliases(householdId, type, fromId, toId)` — redirections après fusion
- `tombstones(householdId, type, id, version)`
- `photos(id, householdId, mime, data BLOB, createdAt)`
- `barcode_cache(code PK, data JSON, fetchedAt)` — cache des fiches Open Food/Beauty/Products Facts (y compris « introuvable », 7 jours)

### Entités synchronisées
| Entité | Champs principaux |
|---|---|
| `households` | name, currency, settings JSON (fréquence des courses, marge de sécurité, alertes péremption, budget mensuel, seuils « oubliés »), fv |
| `members` | userId, name, email, role (`owner`/`admin`/`member`/`viewer`), color, active, prefs JSON (tableau de bord, **préférences de notification**, alertes ignorées) |
| `categories` | name, icon, color, sort, archived — sert aussi de **rayon** en mode courses |
| `locations` | name, icon, kind (`fridge`/`freezer`/`pantry`/`other`), sort, archived |
| `stores` | name, **address, notes, categoryOrder** (ordre des rayons propre au magasin), color, sort, archived |
| `products` | name, brand, **family** (regroupement de variantes), **aliases** JSON (noms alternatifs, libellés de tickets), categoryId, locationId, unit, minQty, idealQty, packUnit, packSize, photoId, defaultStoreId, notes, trackStock, openShelfLifeDays, defaultShelfLifeDays, manualDailyUse, archived, fv |
| `productCodes` | productId, **code GTIN/EAN** (unique par foyer), packQty (quantité en unité de stock par scan), label (format : « bouteille 1 L », « pack de 6 »), brand, source (`off`/`obf`/`opf`/`manual`) — **plusieurs codes par produit** |
| `lots` | productId, quantity (`CHECK ≥ 0`), initialQuantity, expiryDate, **expirySource** (`manual`/`gs1`/`ocr`/`estimated`/null), **batchNumber**, purchaseDate, openedAt, locationId, unitPriceCents, storeId, **qtySource** (`count`/`scan`/`manual`/`receipt`/`shopping`/`import`), **qtyApprox**, depletedAt, note |
| `movements` | productId, lotId, type, delta, **quantityBefore**, quantityAfter, inputQty, inputUnit, reason, note, **source** (`manual`/`scan`/`shopping`/`receipt`/`inventory`/`recipe`/`import`), **flags** (`shortfall`…), **revertOf / revertedBy**, userId, occurredAt, recordedAt, opId — **jamais supprimés** |
| `shoppingItems` | productId?, name, categoryId, **storeId**, quantity, unit, priority, comment, assignedTo, status (`pending`/`partial`/`purchased`/`done`/`removed`), purchasedQty, priceCents, requests JSON, source, purchasedBy/At, receivedAt |
| `purchases` | productId?, name, categoryId, quantity, unit, totalCents (null = prix inconnu), **discountCents**, storeId, userId, date, shoppingItemId, lotId, **receiptId** |
| `receipts` | storeId, date, totalCents, lines JSON (libellé, quantité, prix, remise, produit associé, confiance), appliedAt, createdBy |
| `inventorySessions` | kind (`initial`/`check`), status (`open`/`applied`/`cancelled`), title, locations JSON (avancement par espace), lines JSON (produit, code, quantité comptée, unité, emplacement, date + source, lot), createdBy, appliedAt |
| `activities` | userId, type, summary, entityType, entityId, at, opId, important |
| `recipes` | name, servings, ingredients JSON, instructions, tags, archived |

Tables serveur ajoutées : `push_subscriptions` (Web Push), `notification_log` (anti-doublon des envois), `meta.epoch` (identifiant de génération de la base, change après une restauration → resynchronisation complète des appareils).

### Invariants vérifiés (contrôle d'intégrité + tests)
1. `lot.quantity ≥ 0` ; 2. `lot.quantity = Σ movements.delta` du lot ; 3. aucune entité ne référence un autre foyer ;
4. `movement.quantityAfter = quantityBefore + delta` ; 5. un `opId` n'est appliqué qu'une fois ; 6. un code-barres n'appartient qu'à un produit par foyer ; 7. une annulation ne s'applique qu'une fois (`revertedBy`).

---

## 4. Fonctionnalités

### Lot 1 — Foyer & membres
Comptes e-mail/mot de passe (scrypt), sessions par cookie HttpOnly, création de foyer avec catégories/emplacements par défaut, **invitations par code ou lien** (partage WhatsApp/SMS/QR, aucun e-mail requis), rôles, retrait, départ, multi-foyers, journal d'activité « qui a fait quoi, quand ».

### Lot 2 — Inventaire
Produits complets (cf. modèle), **lots multiples** avec dates différentes, emplacements/catégories/magasins personnalisables, photo (redimensionnée côté client), détection des doublons à la création (nom normalisé, code-barres).

### Lot 3 — Mouvements de stock
Ajouter, consommer (FEFO : lot à la date la plus proche d'abord, lots ouverts en priorité), terminé, jeté/périmé, correction d'inventaire (avec motif), ouvert, déplacement, signaler manquant. Conversion d'unités (g/kg, ml/cl/L, conditionnements « 1 paquet = 500 g »). Chaque mouvement est journalisé ; aucune modification silencieuse de quantité.

### Lot 4 — Liste de courses collaborative
Ajout manuel / depuis le stock / depuis les recommandations, fusion des doublons et addition des quantités, priorités, commentaires, attribution, achats partiels, suppression, historique. **Mode courses** plein écran : grandes cases, regroupement par rayon, écran maintenu allumé, mise à jour en direct.

### Lot 5 — Réception
Après les courses : confirmation des quantités réellement achetées, prix, magasin, dates de péremption, emplacement → création des lots, mouvements `purchase` et dépenses. Le reliquat d'un achat partiel reste sur la liste.

### Lot 6 — Moteur d'approvisionnement (déterministe, explicable)
Voir §5.

### Lot 7 — Péremption & anti-gaspillage
DLC/DDM par lot, durée de conservation après ouverture, statuts (périmé, aujourd'hui, urgent ≤ 2 j, bientôt ≤ N j), produits ouverts, produits oubliés (sans mouvement depuis N jours, plus court pour le frigo), risque de gaspillage (consommation prévue < quantité avant la date), statistiques des pertes (valeur calculée uniquement à partir des prix enregistrés).

### Lot 8 — Tableau de bord
KPI, **« Ce que votre maison doit prévoir »**, liste en cours, derniers mouvements, dépenses du mois vs budget, prévisions de rupture, alertes péremption. Widgets activables et réordonnables (préférences synchronisées par membre).

### Lot 9 — Dépenses
Achats (produit, quantité, prix, magasin, date, membre), dépenses hebdomadaires/mensuelles, budget et projection de fin de mois (rythme réel), produits les plus coûteux, répartition par catégorie, comparaison des prix unitaires (€/kg, €/L, €/unité) par magasin. Aucune donnée inventée.

### Lot 10 — Avancé (architecture prête)
Recettes et ingrédients (réalisables avec le stock, ingrédients manquants → liste), planification des repas, restes, tâches ménagères, multi-magasins (ordre des rayons par magasin). Chaque module est un nouveau type d'entité + commandes, sans toucher au cœur.

---

## 5. Moteur intelligent d'approvisionnement

Entrées : produits, lots, mouvements, liste de courses, réglages du foyer, date du jour. Sortie : un `ProductInsight` par produit + recommandations triées.

1. **Stock utilisable** = Σ lots non périmés (les lots périmés sont signalés à part).
2. **Consommation observée** : mouvements `consume`, `finish`, et corrections marquées « consommation non enregistrée », sur 120 jours, **pondérées exponentiellement** (demi-vie 30 j). Les **périodes de rupture sont exclues** du dénominateur (on ne peut pas consommer ce qu'on n'a pas).
3. **Cadence d'achat** : intervalles entre réapprovisionnements → intervalle médian, régularité (coefficient de variation), quantité habituelle, date probable du prochain achat. Débit déduit des achats si la consommation n'est pas saisie.
4. **Confiance** : `élevée` (≥ 6 relevés sur ≥ 30 j), `moyenne` (≥ 3 relevés sur ≥ 14 j), `faible`, `aucune`. Priorité des sources : observée (≥ moyenne) → achats (≥ moyenne) → estimation manuelle saisie → seuils configurés. **Sans historique, seuls les seuils manuels sont utilisés ; aucune consommation n'est inventée.**
5. **Autonomie** = stock utilisable / débit journalier → date de rupture estimée.
6. **Déclencheurs** : rupture, sous le seuil minimal, rupture prévue avant la prochaine course + marge (`fréquence + sécurité`), achat régulier attendu.
7. **Quantité recommandée** = max(quantité idéale, débit × (fréquence + marge)) − stock utilisable − **quantité déjà dans la liste**, arrondie au conditionnement. Si la liste couvre déjà le besoin → « déjà prévu ».
8. **Explication** générée pour chaque recommandation, ex. : *« Acheter 2 bouteilles de lait : le stock actuel devrait être épuisé dans environ 3 jours. »* + détail (*« ~0,7 L/jour, 12 relevés sur 45 jours, confiance élevée »*).
9. **Anti-doublon** à l'ajout dans la liste : avertit si le stock est déjà suffisant ou si l'article est déjà listé.

---

## 6. Technologies (toutes open source, gratuites)

| Rôle | Choix | Licence |
|---|---|---|
| Langage | TypeScript | Apache-2.0 |
| Serveur HTTP | Fastify 5 (+ cookie, static) | MIT |
| Base | SQLite via better-sqlite3 (WAL, FK, CHECK) | MIT / domaine public |
| Validation | zod | MIT |
| Interface | React 19, react-router 7 | MIT |
| Build | Vite 8, esbuild | MIT |
| PWA | vite-plugin-pwa (Workbox) | MIT |
| Stockage local | IndexedDB via idb | ISC |
| Icônes | Lucide | ISC |
| Police | Manrope (auto-hébergée, @fontsource) | OFL |
| Codes-barres 1D/2D, GS1 | zxing-wasm (zxing-cpp en WebAssembly, auto-hébergé) | MIT / Apache-2.0 |
| OCR (dates, tickets) | Tesseract.js + modèle français auto-hébergés | Apache-2.0 |
| Notifications push | web-push (VAPID, aucun service payant) | MPL-2.0 |
| Bases produits | Open Food Facts, Open Beauty Facts, Open Products Facts (via proxy serveur avec cache) | ODbL — attribution affichée ; 100 requêtes/min en lecture, User-Agent personnalisé obligatoire, HTTP 503 au-delà |
| Tests | Vitest, Playwright | MIT / Apache-2.0 |

---

## 7. Étapes de développement

| # | Étape | Critère de fin |
|---|---|---|
| 0 | Monorepo, outillage, plan | build + tests verts |
| 1 | Domaine partagé : unités, entités, validation, handlers | tests unitaires des handlers |
| 2 | Serveur : schéma SQLite, auth, foyers, invitations, rôles | tests d'intégration HTTP |
| 3 | Sync push/pull, idempotence, conflits, SSE | tests de concurrence et de rejeu |
| 4 | Client : réplique IndexedDB, outbox, store réactif | tests du moteur de sync client |
| 5 | Inventaire + mouvements (UI) | parcours E2E |
| 6 | Liste de courses, mode courses, réception | parcours E2E multi-utilisateurs |
| 7 | Moteur d'approvisionnement + Prévisions | tests unitaires du moteur |
| 8 | Péremption, anti-gaspillage | tests unitaires + UI |
| 9 | Tableau de bord personnalisable | E2E |
| 10 | Dépenses & statistiques | tests unitaires des agrégats |
| 11 | Export/import, sauvegardes, intégrité | tests aller-retour |
| 12 | Codes-barres, photos, notifications | tests manuels + E2E partiels |
| 13 | Docker, documentation de déploiement | image fonctionnelle |

---

## 8. Tests nécessaires

**Unitaires (shared)** : conversions d'unités et formats français ; consommation FEFO multi-lots ; consommation supérieure au stock ; correction avec conflit ; fusion des doublons de liste ; achats partiels ; réception (lot + mouvement + dépense) ; conflits par champ ; estimation du débit (pondération, exclusion des ruptures, confiance) ; cadence d'achat ; recommandations (seuils seuls, prévision, déduction de la liste, arrondi au conditionnement) ; textes d'explication ; péremption et produits ouverts ; agrégats de dépenses et budget.

**Intégration (server)** : inscription/connexion/déconnexion ; limitation des tentatives ; création de foyer ; invitation/adhésion/retrait/rôles ; isolation stricte entre foyers ; lecteur sans droit d'écriture ; push/pull paginé ; **rejeu idempotent** ; **consommations concurrentes** ; ordre des opérations hors ligne ; alias après fusion ; export → import (remappage des identifiants) ; contrôle d'intégrité ; sauvegarde SQLite.

**Bout en bout (Playwright)** : parcours complet création → inventaire → liste → mode courses → réception → stock mis à jour ; deux membres simultanés (mise à jour en direct) ; **hors ligne puis reconnexion** sans perte ; mobile (viewport iPhone).

---

## 9. Sécurité et protection des données
- Mots de passe : scrypt + sel ; sessions : jeton aléatoire 256 bits, seul le hachage est stocké, cookie `HttpOnly`/`SameSite=Lax`/`Secure` en HTTPS.
- Requêtes d'écriture : en-tête personnalisé obligatoire (anti-CSRF), vérification d'appartenance au foyer et de rôle à chaque requête, toutes les lectures filtrées par `householdId`.
- Limitation des tentatives de connexion ; en-têtes de sécurité (CSP stricte, nosniff, frame-ancestors).
- Données uniquement sur votre serveur ; Open Food Facts n'est interrogé qu'avec le code-barres (aucune donnée personnelle).
- Sauvegardes : quotidiennes (14 jours + 12 mois), avant chaque import, export JSON/CSV à la demande.

---

## 10. Phase 2 — Scanner universel et enrichissements (analyse d'impact)

### 10.1 Conflits et ajustements par rapport à la conception initiale
| Élément initial | Problème | Décision |
|---|---|---|
| `product.barcode` (un seul code) | Un produit peut avoir plusieurs codes (marques, formats, packs) | Remplacé par l'entité **`productCodes`** (n codes → 1 produit, chacun avec son format et sa quantité par scan). |
| Date proposée via `defaultShelfLifeDays` | Serait une date **inventée** | Ce n'est plus qu'une **suggestion explicite** ; si l'utilisateur l'accepte, `expirySource = estimated` et elle est affichée comme estimation. Sinon : date inconnue. |
| Correction d'inventaire immédiate | L'inventaire par scan doit **demander confirmation** | Les comptages passent par des **sessions d'inventaire** ; écarts présentés, puis appliqués seulement après validation (avec contrôle de concurrence). |
| Quantités « entières » pour les conditionnements | Exigence : 0,5 bouteille, quantité approximative | Toutes les quantités sont décimales ; drapeau `qtyApprox` pour les quantités estimées (« reste environ la moitié »). Les arrondis entiers ne concernent que les **recommandations d'achat**. |
| Mouvement = delta + quantité après | Exigence : quantité avant/après, annulation | Ajout de `quantityBefore`, `source`, `revertOf/revertedBy` et du type `revert` (annulation compensatoire, l'original reste visible). |
| Notifications = journal d'activité | Exigence : alertes personnalisées, anti-doublons, récapitulatif | **Centre de notifications** calculé (moteur partagé) + préférences par membre + clés de déduplication + récapitulatif quotidien/hebdomadaire par **Web Push** (VAPID auto-généré, gratuit). |
| Sauvegarde = fichier quotidien | Exigence : versions, restauration réelle vérifiée | Chaque sauvegarde est **rouverte et vérifiée** (`integrity_check` + comptages) ; restauration depuis l'interface d'administration avec sauvegarde préalable de l'état courant ; changement d'`epoch` → resynchronisation des appareils. Testé automatiquement. |
| Liste de courses par rayon | Exigence : répartition multi-magasins | `shoppingItems.storeId` + mode courses **par magasin puis par rayon** (ordre des rayons propre au magasin). |
| Dépenses = prix saisis | Exigence : prix connu / estimé / inconnu | Coût prévisionnel de la liste : **connu** (prix saisi), **estimé** (historique réel de prix unitaires, de préférence dans le même magasin), **inconnu** (aucune donnée) — toujours affichés séparément. |
| Moteur : confiance basée sur l'historique | Exigence : qualité des informations | Le moteur intègre la **qualité du stock** (compté récemment / scanné / estimé / non vérifié) et la signale dans l'explication ; une quantité approximative ou non vérifiée abaisse la confiance et peut déclencher « inventaire à vérifier ». |

### 10.2 Scanner intelligent universel
- **Lecture** : `zxing-wasm` (moteur zxing-cpp compilé en WebAssembly, auto-hébergé, MIT) pour tous les navigateurs, y compris iPhone — EAN-13/8, UPC-A/E, Code 128, ITF, **QR, DataMatrix, GS1 DataBar**. Lecture continue, vibration + son discret, anti-rebond.
- **GS1** : analyse des Application Identifiers — (01) GTIN, (10) lot, (15) DDM, (17) date limite, (310n)/(320n) poids net, formats `(01)…`, `]d2…` avec séparateur FNC1 et **GS1 Digital Link** (`https://…/01/…/10/…`). **Un EAN classique n'est jamais supposé contenir une date.** Les codes magasin à poids variable (préfixe 2) sont identifiés comme tels et non interprétés.
- **Identification** : 1) catalogue local (`productCodes`, fonctionne hors ligne) ; 2) serveur → cache → Open Food Facts, puis Open Beauty Facts (hygiène), puis Open Products Facts (entretien/ménager) ; 3) code inconnu → création rapide avec seulement les champs indispensables. Si le nom trouvé ressemble à un produit existant : **question de validation** (« Associer à “Lait demi-écrémé” ? ») — jamais de fusion automatique.
- **Trois modes** : **Réception** (+1 par scan, lot créé ou complété pour même produit/date/n° de lot dans la session), **Consommation** (−1, FEFO), **Inventaire** (comptage dans une session, écarts à valider). Quantité par scan modifiable rapidement (pavé +/−, ½, saisie). **Annuler** sur chaque confirmation.
- **Fluidité** : traitement immédiat si tout est connu ; sinon une seule question (date ? produit inconnu ?) ; confirmation discrète « +1 Lait ajouté » ; mode continu.
- **Fiabilité** : anti-doublon (même code relu < 2,5 s ignoré et signalé, `opId` unique par scan), aucun mouvement sans action dans le mode correspondant, erreurs de lecture gérées.

### 10.3 OCR (sans IA générative, hors ligne)
- **Tesseract.js** (Apache-2.0) auto-hébergé avec le modèle français, chargé à la demande puis mis en cache par le service worker.
- **Dates** : reconnaissance des mentions DLC (« à consommer jusqu'au ») et DDM (« à consommer de préférence avant », « DLUO », « best before »), formats JJ/MM/AA(AA), JJ.MM, MM/AAAA, mois en lettres. Date détectée affichée → **confirmation obligatoire** → `expirySource = ocr`.
- **Tickets de caisse** : magasin, date, lignes (libellé, quantité, prix unitaire, total ligne), remises/promotions, total ; contrôle de cohérence (Σ lignes − remises ≈ total). **Écran de validation** : association aux produits (alias appris par magasin, codes, similarité), correspondances incertaines signalées, produits inconnus identifiés. Après validation seulement : dépenses, prix, réceptions en stock (cases à cocher).

### 10.4 Inventaire initial guidé
Assistant par espace (Cuisine, Réfrigérateur, Congélateur, Placards, Cellier, Salle de bain, Buanderie, Garage, espaces personnalisés), scan à la chaîne ou recherche, quantités/emplacements/dates modifiables avant validation, **pourcentage d'avancement**, sauvegarde automatique et reprise (session synchronisée, reprenable depuis un autre téléphone), validation finale avec récapitulatif des écarts.

### 10.5 Catalogue
Plusieurs codes par produit, formats d'emballage, variantes (`family`), marques par code, alias et libellés de tickets, produits personnalisés sans code. Détection des **doublons probables** (même code, nom très proche, alias commun) présentée pour **validation manuelle** ; fusion explicite (`product.merge`) qui conserve tout l'historique.

### 10.6 Contrôle de cohérence
Audit calculé (moteur partagé, affiché dans *Paramètres → Données* et dans les notifications) : quantité négative, Σ mouvements ≠ lot, produits en double probables, mouvements identiques à quelques secondes d'intervalle, consommation sur stock nul (`flags: shortfall`), écarts d'inventaire, dates incohérentes (péremption avant l'achat, à plus de 10 ans, déjà dépassée à la réception). **Annulation** d'une action complète (`movement.revertOp`) par mouvements compensatoires.

### 10.7 Niveaux de fiabilité affichés
| Information | Niveaux |
|---|---|
| Quantité | **Comptée** (inventaire), **Scannée/Reçue**, **Saisie**, **Approximative**, **Calculée** (déduite des mouvements depuis le dernier comptage) |
| Date de péremption | **Lue dans le code (GS1)**, **Saisie**, **Reconnue (OCR) et confirmée**, **Estimée**, **Inconnue** |
| Consommation | **Observée** (confiance élevée/moyenne/faible), **Déduite des achats**, **Estimation manuelle**, **Aucune donnée** |
| Prix | **Connu**, **Estimé** (historique), **Inconnu** |

### 10.8 Étapes ajoutées
| # | Étape |
|---|---|
| 14 | Catalogue multi-codes, alias, doublons, fusion validée |
| 15 | Scanner (zxing-wasm, GS1, 3 modes, mode continu, anti-doublon) + proxy Open Food/Beauty/Products Facts |
| 16 | Sessions d'inventaire + assistant d'inventaire initial |
| 17 | OCR dates + tickets de caisse avec validation |
| 18 | Multi-magasins (répartition, mode courses par magasin) + budget avancé (annuel, catégorie, magasin, évolution des prix, coût prévisionnel) |
| 19 | Audit de cohérence + annulation des mouvements |
| 20 | Centre de notifications, préférences, récapitulatifs Web Push |
| 21 | Sauvegardes versionnées vérifiées + restauration |
| 22 | **Simulation d'une semaine complète d'utilisation familiale** (tests automatisés) + audit global |

### 10.9 Tests ajoutés
Analyse GS1 (AI fixes/variables, FNC1, Digital Link, parenthèses, dates « 00 »), EAN/UPC (clé de contrôle), parsing de dates OCR (DLC/DDM, formats), parsing de tickets (lignes, quantités, remises, total), associations multi-codes, sessions d'inventaire (écarts, conflit si le stock change pendant l'inventaire), annulation (double annulation refusée), audit de cohérence, coût prévisionnel (connu/estimé/inconnu), notifications (déduplication, préférences), sauvegarde → restauration → données identiques, **semaine familiale simulée** (deux membres, deux appareils, hors ligne partiel) avec vérification des invariants après chaque journée.
