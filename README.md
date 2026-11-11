# demiurge (nom de travail provisoire)

Bac à sable de dieu 2D original. Cœur de simulation déterministe, pur et headless
(TypeScript), rendu Canvas 2D séparé. État d'avancement : voir `STATE.md`.

En ligne : <https://pipail69.github.io/demiurge/> — dépôt : <https://github.com/Pipail69/demiurge>.
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
```

Node ≥ 22.18 requis (`npm run headless` utilise l'effacement natif des types de Node).

- `src/core/` — cœur pur (PRNG, ECS, boucle à pas fixe, hash). N'importe rien hors de lui-même.
- `src/render/` — stub navigateur (index.html + main.ts).
- `tests/` — tests ; `tests/fixtures/` — charge de test (pas du contenu de jeu).
- `docs/models.md` — modèles ; `docs/decisions.md` — journal des décisions.
