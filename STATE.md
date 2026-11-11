# STATE — état du projet

Dernière mise à jour : 2026-11-11, fin de T0 (Fondations).

## Ce qui existe

- Dépôt TypeScript 6 / Vite 8 / Vitest 5 / ESLint 10 + typescript-eslint, scripts npm
  `typecheck`, `lint`, `test`, `build`, `headless`.
- `src/core/` (pur, headless, aucune dépendance hors de lui-même) :
  - `rng.ts` — xoshiro128** amorcé par SplitMix32 ; `nextU32`, `nextFloat`, `nextInt` (sans
    biais), `getState`/`setState`.
  - `sha256.ts` — SHA-256 pur TS incrémental.
  - `hash.ts` — `hashWorld(world)` : SHA-256 de la sérialisation canonique v1 (models.md § 4).
  - `ecs/entities.ts` — allocateur index + génération, liste libre LIFO.
  - `ecs/component.ts` — composants SoA en tableaux typés, ordre des champs figé (tri).
  - `ecs/world.ts` — `World` (graine, tick, PRNG, entités, composants, systèmes), `query`,
    `step(world)`.
  - `loop.ts` — `FixedStepLoop` : accumulateur, pas 1000/30 ms, plafond 8 ticks/appel.
  - `index.ts` — API publique.
- `src/render/` — stub : crée un monde vide, 60 ticks, écrit tick + hash sur un canvas.
- `scripts/headless.ts` — exécute la charge de démo sous Node pur et imprime tick + hash.
- `tests/fixtures/workload.ts` — charge de test (3 composants, 4 systèmes : naissance,
  déplacement, métabolisme/mort, bascule de composant). Pas du contenu de jeu.
- Docs : `docs/models.md`, `docs/decisions.md`, `README.md`.

## Ce qui est testé (chiffres réels du 2026-11-11)

48 tests dans 7 fichiers, tous verts (`npm test`, ~2,1 s ; exécuté deux fois, mêmes résultats).

- Critère (a) : 10 000 ticks × 2, graine 20261111, hashs identiques aux 11 points de contrôle
  (tous les 1 000 ticks) ; ≈ 130–170 ms par exécution de 10 000 ticks (hashs compris).
  Hash final : `147705a5cb504456d0e055807e2d30116559dae97ce6fe6bc8ec358522775f48`.
- Charge vivante (graine 20261111) : 20 274 entités créées, 20 192 détruites, population
  finale 82, pic 102, highWater 102 (recyclage massif), capacité 64 → 128,
  Velocity +28 763 / −16 192, 1 566 132 tirages `nextU32`.
- Critère (b) : graine 20261112 → hashs différents dès le tick 0, à chaque point de contrôle
  et à la fin (`2f1d494395a1b253cb32ff88bf97c443323cb77651ec5a697840b711d7370528`, pop. 56).
- Contrôles négatifs : un système `Math.random` (dans tests/) fait diverger deux exécutions ;
  l'ordre des systèmes inversé change le hash.
- Critère (c) : Vitest en environnement `node` (window/document indéfinis pendant `step`) ;
  analyse statique des imports de `src/core` (+ contrôle négatif de l'analyseur) ;
  `node scripts/headless.ts` lancé en sous-processus donne le même hash final que Vitest.
- PRNG : vérification croisée contre une référence BigInt (5 000 tirages × 8 graines,
  PAS de vecteurs publiés), chi-deux, absence de biais modulo, bornes, getState/setState.
- SHA-256 : contre `node:crypto`, 903 tampons de 0 à 300 octets + frontières, découpages
  incrémentaux, 5 Mo en morceaux irréguliers.
- ECS : création/destruction/recyclage LIFO, poignées périmées, composants, mise à zéro,
  règles de mutation pendant l'itération (y compris avec croissance), ordre des systèmes.
- Hash : sensibilité (valeur, tick, PRNG, graine, mort, ajout/retrait, liste libre, −0),
  indépendance vis-à-vis de la capacité allouée.
- Boucle : découpages de temps différents → même hash ; plafond ; entrées invalides.
- Outillage : le lint et le tsconfig du cœur rejettent bien un fichier fautif (vérifié à la
  main en T0 avec un fichier temporaire, non automatisé dans la suite).

## Pièges connus

- **Fonctions mathématiques transcendantes** : `Math.sin/cos/tan/exp/log/pow/atan2/…` ne sont
  PAS garanties identiques au bit près d'un moteur JS à l'autre (la norme laisse
  l'approximation à l'implémentation). Déterministes sur un même moteur/version seulement.
  À trancher en T1 avant d'écrire le bruit de terrain (tables, polynômes maison, ou
  arithmétique entière / à virgule fixe). `+ - * /` et `Math.sqrt`, `Math.fround`,
  `Math.imul` sont exacts.
- **−0 ≠ +0** dans le hash (octets bruts) : deux états « égaux » numériquement peuvent avoir
  des hashs différents. Ne pas produire de −0 par accident, ou normaliser.
- **NaN** : plusieurs motifs de bits possibles ; un NaN calculé pourrait différer d'un moteur à
  l'autre → hash différent. Éviter tout NaN dans l'état (à valider à l'écriture si besoin).
- **Petit-boutisme exigé** par le format de hash (erreur explicite sinon).
- **Ordre d'itération** : aucune logique ne doit dépendre de l'ordre d'une `Map`/`Set`/objet
  (règle non vérifiable par le lint actuel : à surveiller en revue).
- **Croissance de capacité** : `store.fields.*`, `store.present` et les tableaux de
  l'allocateur sont REMPLACÉS quand la capacité double. Ne pas garder de référence à travers
  un `createEntity()` ; relire `store.fields.x` après.
- **Poignées** : génération sur 21 bits dans la poignée → ABA théorique après 2^21 recyclages
  d'un même emplacement.
- **Un seul PRNG** : tout tirage supplémentaire ou réordonné change toute la suite de
  l'histoire (voulu). Toute instrumentation doit éviter de tirer.
- `query` alloue deux `Uint32Array(highWater)` par appel (à optimiser en T9 si mesuré).
- `npm run headless` exige Node ≥ 22.18 (effacement natif des types) et des imports `.ts`.
- `npm audit` : vulnérabilité modérée (minimatch) dans l'outillage ESLint, non corrigée
  (correctif = rétrogradation d'ESLint) — voir decisions.md.
- Conservation : aucun journal d'événements encore ; la règle de conservation n'est pas
  outillée dans le cœur.

## Prochaine étape

**T1 — Monde** : d'abord trancher la question des fonctions transcendantes (piège ci-dessus)
pour le bruit, puis écrire le modèle du terrain dans `docs/models.md` avant le code.
