# demiurge (nom de travail provisoire)

Bac à sable de dieu 2D original. Cœur de simulation déterministe, pur et headless
(TypeScript), rendu Canvas 2D séparé. État d'avancement : voir `STATE.md`.

En ligne : <https://pipail69.github.io/demiurge/> — dépôt : <https://github.com/Pipail69/demiurge>.
La page génère et affiche une carte 512×512 (biomes, rivières, légende) ; la graine se choisit
dans l'URL : `?seed=123` (entier 0..4294967295, défaut 20261111).
Chaque push sur `main` déclenche typecheck, lint, tests et build, puis publie sur GitHub Pages
si tout passe (`.github/workflows/deploy.yml`).

```sh
npm install
npm run typecheck   # cœur vérifié sans DOM ni types Node, puis le reste
npm run lint        # ESLint (interdictions de déterminisme dans src/core)
npm test            # Vitest (environnement node)
npm run build       # typecheck + bundle Vite du stub de rendu → dist/
npm run check:dist  # après build : aucun chemin absolu dans dist/
npm run headless    # cœur sous Node pur : 10 000 ticks de la charge de démo, tick + hash
npm run worldgen -- 20261111 512 512        # génère un monde : temps, hash, statistiques
npm run bench:worldgen -- 20261111 512 512 5 # 5 générations : min/médiane/max, détail par étape
node scripts/map-png.ts 20261111 512 512 carte.png  # PNG de la carte (même palette que la page)
```

Node ≥ 22.18 requis (`npm run headless` utilise l'effacement natif des types de Node).

- `src/core/` — cœur pur (PRNG, ECS, boucle à pas fixe, hash, grille, génération du monde dans
  `src/core/world/`). N'importe rien hors de lui-même.
- `src/render/` — page (index.html + main.ts) et palette pure (`palette.ts`).
- `tests/` — tests ; `tests/fixtures/` — charge de test (pas du contenu de jeu).
- `docs/models.md` — modèles ; `docs/decisions.md` — journal des décisions.
