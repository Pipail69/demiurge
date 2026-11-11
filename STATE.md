# STATE — état du projet

Dernière mise à jour : 2026-11-11, T1 (Monde). Avant : T0 (Fondations) + tour correctif, D1 (mise en ligne).

## Ce qui existe

- Dépôt TypeScript 6 / Vite 8 / Vitest 5 / ESLint 10 + typescript-eslint, scripts npm
  `typecheck`, `lint`, `test`, `build`, `headless`.
- `src/core/` (pur, headless, aucune dépendance hors de lui-même) :
  - `rng.ts` — xoshiro128** amorcé par SplitMix64 (recommandation publiée, convention
    `seed_from_u64` de rand_xoshiro) ; `nextU32`, `nextFloat`, `nextInt` (sans biais),
    `getState`/`setState`.
  - `sha256.ts` — SHA-256 pur TS incrémental.
  - `hash.ts` — `hashWorld(world)` : SHA-256 de la sérialisation canonique **v2** (models.md § 4 :
    + paramètres du monde + grille).
  - `grid.ts` — `Grid` : grille dense W×H, couches = tableaux typés entiers nommés, ordonnés.
  - `ecs/entities.ts` — allocateur index + génération, liste libre LIFO.
  - `ecs/component.ts` — composants SoA en tableaux typés, ordre des champs figé (tri).
  - `ecs/world.ts` — `World` (graine, tick, PRNG, entités, composants, systèmes, **paramètres**
    ordonnés `params`, **grille** optionnelle `grid`), `query`, `step(world)`.
  - `world/` (T1) : `noise.ts` (bruit de gradient + fBm, gradients tirés de world.rng),
    `heap.ts` (tas (niveau, index)), `hydrology.ts` (océan, Priority-Flood + ε, lacs, D8,
    cumul), `erosion.ts` (stream power law), `climate.ts` (Bhāskara, latitude, température,
    vents, humidité), `biomes.ts` (12 biomes), `seasons.ts` (calendrier, température
    courante), `params.ts` (paramètres par défaut gelés, ordre de hachage), `generate.ts`
    (`generateWorld`, pipeline, statistiques, crochet `onStage`).
  - `loop.ts` — `FixedStepLoop` : accumulateur, pas 1000/30 ms, plafond 8 ticks/appel.
  - `index.ts` — API publique.
- `src/render/` — page : génère le monde (graine `?seed=`, défaut 20261111) sur le fil principal,
  carte 512×512 (couleur par biome + rivières), légende, ligne d'état (graine, taille, temps, hash) ;
  `palette.ts` = conversion pure monde → RGBA (testée sous Node).
- `scripts/worldgen.ts` (`npm run worldgen -- <graine> <l> <h>`), `scripts/bench-worldgen.ts`
  (`npm run bench:worldgen`), `scripts/map-png.ts` (PNG du même tampon RGBA).
- `scripts/headless.ts` — exécute la charge de démo sous Node pur et imprime tick + hash.
- `tests/fixtures/workload.ts` — charge de test (3 composants, 4 systèmes : naissance,
  déplacement, métabolisme/mort, bascule de composant). Pas du contenu de jeu.
- Docs : `docs/models.md`, `docs/decisions.md`, `README.md`.
- **D1 — mise en ligne** : `base: './'` (vite.config.ts) ; script `npm run check:dist`
  (`scripts/check-dist.ts`) ; workflow `.github/workflows/deploy.yml` (jobs `build` puis
  `deploy`, déclenché sur push `main` et manuellement). Dépôt public
  `https://github.com/Pipail69/demiurge`, page prévue `https://pipail69.github.io/demiurge/`.
  Le jeu est une page statique : tout tourne dans le navigateur du joueur (decisions.md, D1–D7).

## T1 — ce qui est testé (chiffres réels du 2026-11-11)

181 tests dans 17 fichiers, tous verts (`npm test` deux fois de suite : 13,51 s et 13,56 s, mêmes
résultats). `typecheck`, `lint`, `build` (24 modules, bundle 29,29 kB), `check:dist`, `headless`
(hash final T0 inchangé en v2 : `23438c0b…`) verts. `npm run worldgen -- 20261111 512 512` deux
fois : même hash `8cc05eed…`.

- **(a) Déterminisme** : deux générations → mêmes couches, mêmes statistiques, même hash ;
  graines différentes → couches différentes (> 5 % des cellules sur 6 couches, données
  comparées) ; `scripts/worldgen.ts` en sous-processus Node → même hash que Vitest (64×64,
  160×96) ; 5 000 ticks ne touchent aucune couche ; nombre de tirages PRNG = `rngDraws` (50 701).
  **Hashs épinglés** (graine 20261111, `tests/worldgen.test.ts`, + somme SHA-256 par couche et
  compteurs) : 64×64 `3ef9b72335e2f34f44ba3333ea99a403886d7cf87a52d379e73ba63076e607f9`,
  512×512 `8cc05eedbf839f2bd948cc481afe1a804cb3db8373abd131879e0ecbaad5ab96`. Hashs T0 re-épinglés
  pour le format v2 (decisions.md W4) : tick 0 `ba2ffb04…`, tick 1 000 `95a081bb…`,
  tick 10 000 `23438c0b…`, graine 20261112 `0fb538dd…`.
  **Navigateur** : `dist/` servi par `vite preview` et ouvert dans Chrome headless 153 (V8) :
  graine par défaut → hash `8cc05eed…` (= valeur épinglée sous Node), graine 7 → `05fd3a12…`
  (= Node), `?seed=abc` → défaut + message ; capture d'écran regardée (carte + légende).
- **(b) Rivières** : vérificateur indépendant (`tests/rivers.test.ts`, convention D8 et formule
  d'apport réécrites) sur 6 petites cartes (64×64 à 200×72, non carrées) et 512×512 : toute
  cellule de terre (rivière ou non) a un aval voisin qui est de l'eau ou strictement plus bas ;
  depuis toute cellule de terre et de lac on atteint l'océan sans cycle ; débit exact ;
  drapeau rivière ⇔ terre et débit ≥ seuil. 512×512 : 53 embouchures en mer, 43 dans un lac.
  Contrôles négatifs : aval relevé, cycle, débit +1, océan avec aval, lac sans aval, drapeau
  faux → rejetés.
- **(c) Biomes** : table de contraintes indépendante ; 4 cartes (dont 512×512) sans violation ;
  totalité par balayage (3 × 20 679 températures × 256 humidités) ; frontières exactes de chaque
  seuil ; contrôle négatif (glace à 25 °C, forêt humide à humidité 5, banquise à 15 °C, désert
  sur l'océan) rejeté.
- **(d) Performance 512×512** (Node 22.23.4, 2 cœurs) : test 5 graines < 5 s chacune
  (min 525 / méd. 594 / max 758 ms, puis 543 / 585 / 646 ms) ; `npm run bench:worldgen` :
  min 442, médiane 475, max 722 ms ; par étape (médianes) bruit 60, relief 21, **érosion 341**,
  hydrologie 39, température 2, humidité 7, débit 6, rivières 3, biomes 8, enregistrement 6 ms.
  Hash : ≈ 40 ms. Chrome headless : 529–640 ms affichés par la page.
- Autres : bordure 100 % océan (60 graines) ; fraction émergée = 0,40 ± 0,04 (8 graines) ;
  relèvement du niveau de la mer au bord (cible 95 %) ; bilan de masse exact (recalculé depuis
  la couche) ; Priority-Flood (cas à la main, point fixe F = max(z, min voisins + ε) sur
  4 reliefs aléatoires, ordre croissant) ; tas (ordre total avec égalités) ; D8 exact
  (14/√2 < 10, 15/√2 > 10) et départage ; lacs (profondeur, taille) ; érosion (bilan, borne aval,
  terre émergée) ; bruit (nul aux nœuds, |n| ≤ 1 atteint, Lipschitz 8,5, moyenne) ; Bhāskara
  (erreur max mesurée 0,001632) ; gradient thermique exact (1 000 m → 6,50 °C) ; monotonie
  latitude ; vents par bande ; cas 1D océan-plaine-montagne-plaine (plaine avant 218, crête 255,
  après 41) ; saisons (durées, périodicité, été > hiver, amplitude croissante, moyenne nulle) ;
  hash v2 (sensibilité par section) ; palette (pixel par pixel) ; test statique des fonctions
  mathématiques interdites (+ contrôles négatif et positif) ; lint vérifié à la main.
- **Test par mutation** (copie hors dépôt) : 27 mutants, 25 tués au premier passage ; 2 survivants
  révélateurs (relèvement du niveau de la mer au bord jamais exercé ; `<=` → `<` du seuil de
  banquise) → tests ajoutés, les 2 tués ensuite. M02 (départage du tas retiré) n'est tué QUE par
  le test unitaire du tas : les cartes générées sont identiques sans départage (les égalités de
  niveau donnent les mêmes surfaces comblées).

## T0 — ce qui est testé (chiffres réels du 2026-11-11, après le tour correctif)

75 tests dans 7 fichiers, tous verts (`npm test`, 5,1 s et 5,8 s sur deux exécutions consécutives, mêmes résultats).

- Valeurs de référence ÉPINGLÉES (`tests/determinism.test.ts`) — tout changement doit être
  justifié dans decisions.md. **Valeurs du format v1 ci-dessous, PÉRIMÉES depuis T1** (format v2,
  nouvelles valeurs dans la section T1 et decisions.md W4 ; histoire inchangée) :
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

## D1 — vérifié le 2026-11-11 (avant push)

En local : `typecheck` sans erreur, `lint` sans erreur, `npm test` 75 tests / 7 fichiers verts
(3,25 s), hashs épinglés inchangés (tests verts), `npm run build` OK (13 modules, 507 ms ;
`dist/index.html` 0,51 kB, `dist/assets/index-2mo3M2Qb.js` 12,33 kB), `dist/index.html`
référence `./assets/index-2mo3M2Qb.js`, `npm run check:dist` : « OK : 2 fichier(s) … sans chemin
absolu » ; contrôle négatif manuel : échec code 1. Activation de Pages par l'API : REFUSÉE
(HTTP 403, « Access to this GitHub API path is not permitted through this proxy »).

Workflow, premier run (commit a032662, run 43067466916, 2026-11-11, 17:22:04 → 17:23:14 UTC,
≈ 70 s, conclusion **failure**) : job `build` — checkout, setup-node, `npm ci`, typecheck, lint,
test, build, `check:dist` : succès sur GitHub ; `actions/configure-pages@v6` : ÉCHEC (« Get Pages
site failed. Please verify that the repository has Pages enabled and configured to build using
GitHub Actions … Error: Not Found ») ; upload-pages-artifact ignoré ; job `deploy` ignoré
(skipped). Cause : Pages n'est pas activé sur le dépôt (l'activation par l'API a été refusée,
voir ci-dessus). Aucun défaut dans les fichiers du dépôt. La barrière fonctionne : rien n'a été
déployé. `https://pipail69.github.io/demiurge/` : non joignable (WebFetch : échec côté site) ;
affichage du canvas NON vérifié dans un navigateur, ni avant ni après.

**Activation et déploiement réel** : le propriétaire a activé Pages à la main (Settings → Pages →
Source : GitHub Actions). Un premier relancement manuel (run 43068382377, workflow_dispatch) avait
encore échoué à `configure-pages`, avant l'activation. Run 43069278003 (workflow_dispatch,
2026-11-11 17:33:14 UTC, commit 8aa2d2e) : job `build` succès sur toutes les étapes (checkout,
setup-node, `npm ci`, typecheck, lint, test, build, `check:dist`, configure-pages,
upload-pages-artifact), job `deploy` succès (deploy-pages@v5). Constaté par WebFetch :
`https://pipail69.github.io/demiurge/index.html` répond (titre « Demiurge — stub de rendu ») ;
`https://pipail69.github.io/demiurge/assets/index-2mo3M2Qb.js` répond (bundle minifié d'environ
12 000 caractères contenant « xoshiro », « getContext », « tick », « hash »). L'URL
`https://pipail69.github.io/demiurge/` (sans `index.html`) a renvoyé une erreur client à WebFetch
juste après le déploiement : non expliqué, à revérifier dans un navigateur.

**Déploiement par push : VÉRIFIÉ** (run 43069683186, événement push, commit 3b0b266, succès ;
constaté par la session principale). **Toujours NON vérifié** : l'affichage de la page
PUBLIÉE dans un navigateur et l'URL sans `index.html`. (T1 : la page construite localement a
été ouverte dans Chrome headless 153, voir plus haut ; ce n'est pas la page publiée.)

## Pièges connus

- **Pages (D1)** : la source Pages doit être « GitHub Actions » (Settings → Pages), sinon le job
  `deploy` échoue. Pages ne règle pas les en-têtes HTTP (pas de SharedArrayBuffer, voir
  decisions.md d). Le dépôt est public : tout commit sur `main` est publié si les tests passent.
- **Fonctions mathématiques transcendantes** : TRANCHÉ en T1 (decisions.md W1) : interdites dans
  `src/core` (lint + test statique). Le sinus passe par Bhāskara. Garde-fous contournables
  (alias de `Math`, accès calculé) : à surveiller en revue.
- **Hashs épinglés** : tout changement d'un paramètre par défaut de génération, du pipeline ou du
  format change les hashs de `tests/worldgen.test.ts` (64×64 et 512×512) ; les sommes par couche
  désignent l'étape fautive.
- **Paramètres hachés** : ajouter un paramètre de génération = l'ajouter à `PARAM_NAMES` (ordre de
  hachage) ; sinon il gouvernerait le monde sans être dans l'état.
- **Banquise rectiligne** : la température de l'océan ne dépend que de la latitude → limite
  banquise/océan = une ligne horizontale exacte (≈ ligne 50 en 512×512).
- **Artefacts d'humidité** : transport ligne par ligne + mélange vertical → bandes horizontales
  et « peignes » verticaux visibles dans les zones tropicales et désertiques.
- **Érosion = 70 % du temps de génération** (8 Priority-Flood complets) ; K non ramené à la
  résolution : le relief dépend un peu de la taille de la carte.
- **Page bloquée** pendant la génération (fil principal, ≈ 0,5–0,7 s) tant que le Worker est reporté.
- **−0 ≠ +0** dans le hash (octets bruts) : les couches sont entières (pas de −0) ; les paramètres
  normalisent −0 ; le bruit produit des −0 (jamais stockés tels quels).
- **Petit-boutisme exigé** par le format de hash (erreur explicite sinon).
- **Ordre d'itération** : aucune logique ne doit dépendre de l'ordre d'une `Map`/`Set`/objet
  (règle non vérifiable par le lint actuel : à surveiller en revue).
- **Croissance de capacité** : `store.fields.*`, `store.present` et les tableaux de
  l'allocateur sont REMPLACÉS quand la capacité double. Ne pas garder de référence à travers
  un `createEntity()` ; relire `store.fields.x` après.
- **Un seul PRNG** : tout tirage supplémentaire ou réordonné change toute la suite de
  l'histoire (voulu). Toute instrumentation doit éviter de tirer. La genèse consomme 50 701
  tirages (bruit uniquement).
- `query` alloue deux `Uint32Array(highWater)` par appel (à optimiser en T9 si mesuré).
- `npm run headless`/`worldgen` exigent Node ≥ 22.18 (effacement natif des types) et des imports `.ts`.
- `npm audit` : vulnérabilité modérée (minimatch) dans l'outillage ESLint, non corrigée
  (correctif = rétrogradation d'ESLint) — voir decisions.md.
- Conservation : aucun journal d'événements encore ; la genèse enregistre ses totaux (érodé,
  comblé) dans les statistiques renvoyées, pas dans l'état du monde.

## Décisions ouvertes (NON tranchées)

a. **Forme canonique fondée sur la discipline des systèmes** (T0) : écrire dans un champ de
   composant absent, après `destroyEntity` ou au-delà de `highWater` n'est pas détecté ;
   `addComponent` ne remet pas à zéro. À décider avant T2 : `assertCanonical` en mode test et/ou
   remise à zéro dans `addComponent`.
b. **Poignées** : 21 bits de génération + liste libre LIFO → ABA atteignable en ≈ 19,4 h à
   30 ticks/s ; une poignée ne tient que dans un f64. Options avant T5 (voir T0).
c. **Le lint est un garde-fou, pas une preuve** : contournements constatés — alias
   `const M = Math`, `globalThis.Math.random()`, `Math['sin']`, `Date()` sans `new`, `Intl` /
   `toLocaleString` / `localeCompare`, itération de `Map`/`Set`/`for…in`, comparateur de tri
   incohérent. Le test statique des fonctions mathématiques a les mêmes limites.
d. **État hors hash** : fermetures des systèmes, exception en cours de tick, références de
   tableaux gardées à travers une croissance de capacité, NaN de motifs différents.
e. **`nextFloat()` stocké en f32 peut valoir exactement 1,0** → attention aux bornes [0, n).
f. **Portée des vérifications** : déterminisme vérifié sur V8 seulement (Node 22.23.4 et
   Chrome headless 153 donnent les mêmes hashs) ; Firefox (SpiderMonkey) et Safari (JSC) non
   testés. Le cœur n'utilise plus que des opérations exactes, mais rien ne le PROUVE sur ces moteurs.
g. **Statistiques de genèse hors de l'état** : `erodedTotal`/`filledTotal` sont renvoyés, pas
   stockés ni hachés ; T2 devra décider si la genèse ouvre le journal (événement « genèse »).
h. **Lacs endoréiques** : tous les lacs s'écoulent vers la mer (pas de lac salé fermé) ; à
   revoir si l'évaporation entre en jeu.
i. **Saisons → humidité/biomes** : sans effet en T1 ; neige, gel des lacs, banquise saisonnière
   non modélisés.

## Prochaine étape

**T2 — Journal d'événements et données** : journal de causes (règle de conservation outillée),
instantanés, export SQLite. À brancher : le **changement de saison** (`seasonAt(tick)` change
de valeur → événement), et éventuellement un événement de genèse portant les totaux
érodé/comblé et les paramètres. Trancher avant : décisions ouvertes a, g.
