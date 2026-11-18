# HOMEOS

Gestion des stocks de la maison et des courses pour toute la famille : inventaire par lots et dates, scanner de codes-barres, liste de courses partagée en temps réel, mode courses, prévisions de rupture expliquées, péremption et pertes, dépenses et budget, lecture des dates et des tickets de caisse sur photo.

- **Gratuit et libre**, auto-hébergé (Raspberry Pi, NAS, vieux PC) — aucune donnée chez un tiers.
- **Application installable** sur iPhone, Android et ordinateur, **utilisable hors connexion**.
- **Plusieurs foyers** par serveur, données strictement séparées, plusieurs membres par foyer (administrateur, membre, lecture seule).
- Aucune IA générative : règles et statistiques explicables.

## Démarrer

```bash
docker compose up -d --build
```

Puis suivez **[docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md)** (accès HTTPS gratuit, sauvegardes, mises à jour).
Sans machine à la maison : **[docs/INSTALLATION_SERVEUR_GRATUIT.md](docs/INSTALLATION_SERVEUR_GRATUIT.md)** (serveur gratuit Oracle Cloud, installation automatique).
Pour la famille : **[docs/GUIDE_UTILISATEUR.md](docs/GUIDE_UTILISATEUR.md)**.

## Développement

```bash
npm ci
npm run dev          # serveur + interface en mode développement
npm test             # tests unitaires et d'intégration (Vitest)
npm run build && npm run test:e2e   # parcours de bout en bout (Playwright)
npm run typecheck
node scripts/check-licenses.mjs     # licences des dépendances livrées
```

Structure : `packages/shared` (domaine : commandes, moteur, unités), `packages/server` (Fastify + SQLite), `packages/web` (React, PWA), `e2e` (Playwright).

Documents du projet : `MASTER_SPEC.md` (cahier des charges), `FEATURE_TRACKER.md` (état réel de chaque fonctionnalité), `PROJECT_PLAN.md` (phases et bilans).
