# STATE — état du projet

Dernière mise à jour : 2026-11-11, fin de T0 (Fondations) + tour correctif de relecture.

## Ce qui existe

- Dépôt TypeScript 6 / Vite 8 / Vitest 5 / ESLint 10 + typescript-eslint, scripts npm
  `typecheck`, `lint`, `test`, `build`, `headless`.
- `src/core/` (pur, headless, aucune dépendance hors de lui-même) :
  - `rng.ts` — xoshiro128** amorcé par SplitMix64 (recommandation publiée, convention
    `seed_from_u64` de rand_xoshiro) ; `nextU32`, `nextFloat`, `nextInt` (sans biais),
    `getState`/`setState`.
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

## Ce qui est testé (chiffres réels du 2026-11-11, après le tour correctif)

75 tests dans 7 fichiers, tous verts (`npm test`, 5,1 s et 5,8 s sur deux exécutions consécutives, mêmes résultats).

- Valeurs de référence ÉPINGLÉES (`tests/determinism.test.ts`) — tout changement doit être
  justifié dans decisions.md :
  - graine 20261111 : tick 0 `e2ea631b4172b7c1b82bc7a5c2dfc0543139f4964adc3f1cb4f17fd698085b7d`,
    tick 1 000 `618097791ec0143a8a53e2f40e04cf1971040d8ae1670fd9dc18343842c770f5`,
    tick 10 000 `4078ad80b1094a900272cea9a0e2db48127d60e15a8fdfe76e6c9ebc3fa93cdc` ;
  - graine 20261112 : tick 10 000 `e106632d1d97d73f699d7ce3d3259fbea679a5a0d8553145460d31bb677217c9`.
- Charge vivante, graine 20261111 / 10 000 ticks : 19 960 entités créées, 19 897 détruites,
  population finale 63, pic 97, highWater 97, capacité 64 → 128, Velocity +28 511 / −16 183,
  1 547 651 tirages `nextU32`. Graine 20261112 : 20 055 / 19 983, population 72, pic 105,
  1 549 727 tirages.
- Critère (a) : 10 000 ticks × 2, hashs identiques aux 11 points de contrôle.
- Critère (b) : hashs différents à chaque point de contrôle, ET histoires différentes hors
  graine (état PRNG, données de composants, compteurs) ; `World(seed).rng` = `new Rng(seed)`.
- Contrôles négatifs : système `Math.random` (dans tests/) → divergence ; ordre des systèmes
  inversé → hash différent.
- Critère (c) : environnement `node`, globals du navigateur indéfinis pendant `step`, analyse
  statique des imports de `src/core` (+ contrôle négatif), `scripts/headless.ts` en
  sous-processus → même hash que Vitest.
- PRNG : vecteurs publiés SplitMix64 (2 graines) et xoshiro128** (état [1,2,3,4]) ; états
  d'amorçage épinglés (C compilé) ; vérification croisée BigInt ; non-recouvrement des états
  entre graines voisines (avec contrôle négatif sur l'ancien amorçage) ; extrêmes de
  `nextFloat` ; seuil de rejet de `nextInt` ; chi-deux ; getState/setState.
- SHA-256 : contre `node:crypto` (903 tampons 0–300 octets, découpages, 5 Mo).
- ECS : recyclage LIFO, poignées périmées et invalides refusées par toutes les opérations,
  stores étrangers refusés, mise à zéro, mutation pendant l'itération, ordre des systèmes,
  limite ABA à 2^21 recyclages (documentée).
- Hash : un test de sensibilité par section (graine à PRNG égal, 4 mots du PRNG, highWater,
  alive, générations, liste libre, nombre/nom/schéma de composants, dernier emplacement,
  index ≥ 64, garde de boutisme effectivement appelée), indépendance vis-à-vis de la capacité.
- Boucle : 1 à 8 ticks par appel et chemin plafonné + abandon → même hash qu'en pas à pas ;
  `advance(100)` → 2 ticks, 10 × 100 ms → 29, 24 h à 60 Hz → 2 592 000 ticks.
- Outillage : le lint et le tsconfig du cœur rejettent bien un fichier fautif (vérifié à la
  main en T0 avec un fichier temporaire, non automatisé dans la suite).
- Test par mutation (hors dépôt, 2026-11-11) : 121 mutants (liste du relecteur, mutants de
  l'ancien SplitMix32 remplacés par 6 mutants SplitMix64 + 2 pour les correctifs) : 107 tués,
  14 survivants. Survivants équivalents ou attendus : R11, R22, E10, W07, W22, W25, S04.
  Survivants non équivalents, laissés tels quels : H25 (contrôle interne de longueur de
  section), E04/E05 (isAlive : branches impossibles à atteindre avec un état valide), L08
  (arrondi de l'accumulateur sous 1e-9), S01 (longueur ≥ 512 Mo), X02 (Math.random rare
  via un alias), X03 (modification au-delà de 10 000 ticks).

## Pièges connus

- **Fonctions mathématiques transcendantes** : `Math.sin/cos/tan/exp/log/pow/atan2/…` ne sont
  PAS garanties identiques au bit près d'un moteur JS à l'autre (la norme laisse
  l'approximation à l'implémentation). Déterministes sur un même moteur/version seulement.
  À trancher en T1 avant d'écrire le bruit de terrain (tables, polynômes maison, ou
  arithmétique entière / à virgule fixe). `+ - * /` et `Math.sqrt`, `Math.fround`,
  `Math.imul` sont exacts.
- **−0 ≠ +0** dans le hash (octets bruts) : deux états « égaux » numériquement peuvent avoir
  des hashs différents. Ne pas produire de −0 par accident, ou normaliser.
- **Petit-boutisme exigé** par le format de hash (erreur explicite sinon).
- **Ordre d'itération** : aucune logique ne doit dépendre de l'ordre d'une `Map`/`Set`/objet
  (règle non vérifiable par le lint actuel : à surveiller en revue).
- **Croissance de capacité** : `store.fields.*`, `store.present` et les tableaux de
  l'allocateur sont REMPLACÉS quand la capacité double. Ne pas garder de référence à travers
  un `createEntity()` ; relire `store.fields.x` après.
- **Un seul PRNG** : tout tirage supplémentaire ou réordonné change toute la suite de
  l'histoire (voulu). Toute instrumentation doit éviter de tirer.
- `query` alloue deux `Uint32Array(highWater)` par appel (à optimiser en T9 si mesuré).
- `npm run headless` exige Node ≥ 22.18 (effacement natif des types) et des imports `.ts`.
- `npm audit` : vulnérabilité modérée (minimatch) dans l'outillage ESLint, non corrigée
  (correctif = rétrogradation d'ESLint) — voir decisions.md.
- Conservation : aucun journal d'événements encore ; la règle de conservation n'est pas
  outillée dans le cœur.

## Décisions ouvertes (consignées après relecture, NON tranchées)

a. **Forme canonique fondée sur la discipline des systèmes** : écrire dans un champ de
   composant absent, dans un emplacement après `destroyEntity` (p. ex. dans un callback de
   `query`) ou au-delà de `highWater` n'est pas détecté ; `addComponent` ne remet pas à zéro.
   Option à décider avant T2 : validateur `assertCanonical` en mode test et/ou remise à zéro
   dans `addComponent`.
b. **Poignées** : 21 bits de génération + liste libre LIFO → ABA atteignable en ≈ 19,4 h à
   30 ticks/s si un emplacement est recyclé à chaque tick (2^21 / 30 s) ; reproduit par un test
   (« LIMITE CONNUE »). Une poignée (jusqu'à 2^53) ne tient dans aucun champ entier de
   composant, seulement en f64. Options avant T5 : autre répartition des bits (p. ex. 24 bits
   d'index + 29 de génération) ; identifiant persistant monotone distinct pour le journal et
   la généalogie.
c. **Le lint est un garde-fou, pas une preuve** : contournements constatés — alias
   `const M = Math`, `globalThis.Math.random()`, `Date()` sans `new`, `Intl` /
   `toLocaleString` / `localeCompare`, `Math.sin` & co, itération de `Map`/`Set`/`for…in`,
   comparateur de tri incohérent.
d. **État hors hash** : fermetures des systèmes (variables capturées), exception en cours de
   tick (monde à moitié avancé, tick non incrémenté), références de tableaux de champs gardées
   à travers une croissance de capacité (écriture perdue en silence), NaN de motifs différents
   même sur un seul moteur (`NaN` littéral vs `Infinity − Infinity`) → hashs différents.
e. **`nextFloat()` stocké en f32 peut valoir exactement 1,0** (arrondi de 1 − 2^−32 en
   float32, p ≈ 3·10⁻⁸ par tirage) → attention aux bornes [0, n) en T1+.
f. **Pour T1** : la grille 512×512 n'a de place ni dans `World` ni dans le hash → format de
   hash v2 à prévoir ; aucun moyen d'énumérer les entités sans composant ; `query` alloue deux
   tableaux par appel (à mesurer en T9, ne pas optimiser avant).
g. **Portée des vérifications** : critère (a) vérifié sur un seul moteur JS (V8 / Node 22.23.4) ;
   le stub de rendu n'a jamais été ouvert dans un navigateur.

## Prochaine étape

**T1 — Monde** : d'abord trancher la question des fonctions transcendantes (piège ci-dessus)
pour le bruit, puis écrire le modèle du terrain dans `docs/models.md` avant le code.
