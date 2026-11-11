# Journal des décisions

Format : date — décision — raison — statut. « Inventé » = valeur sans source, à réévaluer.

## 2026-11-11 — T0 Fondations

### Dépôt et outillage

1. **Nom provisoire du dépôt : `demiurge`** (`/home/claude/demiurge`). Nom de travail, original,
   à remplacer quand le projet aura un nom. Imposé par le commanditaire.
2. **Versions des dépendances (épinglées exactement, `--save-exact`)** : typescript 6.0.3,
   vite 8.3.8, vitest 5.1.0, eslint 10.14.0, typescript-eslint 8.72.2, @types/node 22.20.5.
   Ce sont les dernières versions publiées le 2026-11-11, sauf @types/node, aligné sur Node 22
   (l'environnement d'exécution, v22.23.4) plutôt que sur la v26. Aucune autre dépendance
   (ni `@eslint/js`, ni `tsx`, ni `jsdom`).
   - typescript-eslint 8.72.2 déclare `typescript >=4.8.4 <6.1.0` : compatible avec TS 6.0.3.
   - `npm audit` signale une vulnérabilité « modérée » (minimatch, ReDoS, GHSA-g3hv-75wg-m249)
     dans des dépendances d'ESLint/typescript-eslint. Outillage de développement uniquement,
     n'entre pas dans le bundle. Le correctif proposé (`npm audit fix --force`) rétrograde
     ESLint en 9.x : non appliqué. À revoir à la prochaine mise à jour des outils.
3. **`npm run headless` = `node scripts/headless.ts`**, via l'effacement natif des types de Node
   (actif par défaut depuis Node 22.18 ; vérifié sur v22.23.4, sans avertissement). Aucune
   dépendance supplémentaire (pas de tsx), aucune étape de compilation. Contraintes induites :
   imports relatifs avec extension `.ts` (`allowImportingTsExtensions`), syntaxe TypeScript
   effaçable uniquement (`erasableSyntaxOnly` : pas d'`enum`, pas de `namespace`, pas de
   propriétés de paramètre), `import type` explicite (`verbatimModuleSyntax`). `engines.node`
   fixé à `>=22.18.0`.
4. **Deux tsconfig** : `tsconfig.core.json` (`lib: ["ES2022"]`, `types: []`, sans DOM ni Node)
   pour `src/core/**` ET `tests/fixtures/**` (la charge de démonstration tourne sous
   `npm run headless` et doit respecter les mêmes contraintes) ; `tsconfig.json` (DOM + types
   Node) pour le reste. `npm run typecheck` lance les deux. `strict` + `noUncheckedIndexedAccess`
   conservés : cela impose des `!` sur les accès indexés aux tableaux typés, jugé lisible.
5. **ESLint** : flat config, `typescript-eslint` `recommended` sur tout le dépôt, plus les
   interdictions de déterminisme sur `src/core/**` et `tests/fixtures/**` (extension aux
   fixtures : même raison qu'au point 4). Liste imposée (`Math.random`, `Date.now`,
   `performance.now`, `new Date`, `window`, `document`, `navigator`, `performance`,
   `setTimeout`, `setInterval`, `requestAnimationFrame`) **plus `crypto` et `process`**
   (ajout de ma part : sources d'aléa / d'accès à l'hôte). Limite : l'ordre d'itération des
   `Map`/objets ne peut pas être interdit par une règle simple ; il reste une règle de revue.
6. **`npm run build` = `npm run typecheck && vite build`** (Vite ne vérifie pas les types).
   Racine Vite = `src/render/`, sortie `dist/`. Vitest a sa propre configuration
   (`vitest.config.ts`, environnement `node`, `tests/**/*.test.ts`).

### PRNG

7. **xoshiro128\*\*** plutôt que mulberry32 (période 2^32 : épuisée à l'échelle T9 — à 30 ticks/s
   et quelques milliers de tirages par tick, 2^32 tirages sont consommés en quelques heures)
   et plutôt que PCG32 (état 64 bits : exige BigInt ou une émulation 64 bits, lente en JS).
   xoshiro128** : période 2^128 − 1, uniquement des opérations 32 bits exactes en JS.
8. ~~**Amorçage SplitMix32**~~ (incrément 0x9E3779B9 + finaliseur fmix32 de MurmurHash3) :
   **REMPLACÉ** — voir entrée R1 ci-dessous (révisé après relecture).
9. **Graine = uint32** (pas de graine 64 bits ni chaîne). Suffisant pour T0 ; une graine
   textuelle pourra être réduite en uint32 plus tard si besoin (non décidé).
10. **`nextFloat` à 32 bits de résolution** (u32 / 2^32), pas 53 bits : un seul tirage par
    flottant, division exacte.
11. ~~**Pas de vecteurs publiés pour xoshiro128\*\***~~ : **AFFIRMATION FAUSSE, corrigée** — voir
    entrée R2 ci-dessous (révisé après relecture). La vérification croisée BigInt est conservée.

### Boucle à pas fixe

12. **Pas par défaut 1000/30 ms** (30 ticks/s), repris de la cible de performance T9.
13. **Plafond de rattrapage = 8 ticks par appel à `advance`** — **valeur inventée** (≈ 267 ms
    de retard rattrapable par trame). Au-delà, le retard entier est abandonné et seule la
    fraction de pas est gardée ; cumul exposé dans `droppedMs`.
14. Entrée `NaN`, ±∞ ou négative → `RangeError` (plutôt que d'ignorer silencieusement).

### ECS

15. **Poignée = un `number`** : `(génération mod 2^21) × 2^32 + index`. Évite toute allocation
    d'objet par poignée. Limite ABA après 2^21 recyclages du même emplacement (documentée).
    `generation` stockée en uint32 complet (bouclage après 2^32 destructions d'un emplacement).
16. **Liste libre LIFO**, génération incrémentée à la destruction.
17. **Capacité initiale par défaut = 64** — **valeur inventée** ; sans effet sur le hash.
18. **Ordre des champs = tri lexicographique** des noms (plutôt que l'ordre de déclaration) :
    indépendant de la façon dont l'objet schéma a été construit.
19. **Noms ASCII identifiants** pour composants et champs (sérialisation ASCII triviale).
20. **Mise à zéro** des champs et de la présence au retrait d'un composant et à la destruction
    d'une entité (forme canonique ; le hash ne voit jamais de résidu).
21. **Mutation pendant l'itération** : ensemble candidat figé au début de `query` (index +
    génération), revérifié à chaque visite. Les entités créées pendant l'itération ne sont
    jamais visitées ; les détruites/retirées avant visite sont sautées.
22. **Erreurs explicites** : ajout d'un composant déjà présent, retrait d'un composant absent,
    poignée périmée, composant d'un autre monde, nom en double. Choix : échouer bruyamment
    plutôt que no-op silencieux.
23. Un système ajouté pendant un tick ne s'exécute qu'au tick suivant.
24. Les systèmes sont de simples fonctions `(world) => void` sans nom ; non hachés.

### Hash

25. **SHA-256 pur TypeScript** plutôt qu'un hash non cryptographique plus rapide (xxHash,
    FNV…) : référence vérifiable contre `node:crypto`, collisions négligeables. Coût mesuré en
    T0 : 10 000 ticks + 11 hashs de la charge de test ≈ 130–170 ms au total. À réévaluer sur
    mesures en T9 (taille de monde réelle).
26. **Petit-boutisme exigé**, vérifié à l'exécution par `hashWorld` (erreur explicite sinon).
27. **Format de hash versionné** (`format` = 1) ; tick en u64, longueurs de section en u64.

### Reports (hors T0)

28. **Web Worker** : reporté (stack cible). Le cœur est déjà sans DOM et synchrone, prêt à y
    être déplacé.
29. **SQLite pour les exports** : reporté.
30. **Contenu de jeu** (terrain, agents), **journal d'événements**, **instantanés** : reportés.
    En particulier la règle de conservation (« rien ne se crée ni ne disparaît sans cause
    enregistrée ») n'a pas encore de mécanisme dans le cœur : il n'existe pas de journal en T0.
    La charge de test compte seulement ses créations/destructions pour vérifier la cohérence.

### Charge de test (`tests/fixtures/workload.ts`)

31. Paramètres arbitraires (ce n'est pas du contenu de jeu) : graine de démonstration
    `20261111`, 10 000 ticks, arène torique 100 × 100, 0–4 naissances par tick, population
    plafonnée à 400, énergie initiale 40–99, coût 1–2 par tick (+1 si en mouvement),
    bascule de vitesse 1 chance sur 20 par tick.

## 2026-11-11 — T0, révisé après relecture indépendante (tour correctif)

Un relecteur en contexte vierge a fait du test par mutation (118 mutants, 47 survivants).
Changements décidés par le commanditaire ; ma part : l'implémentation et les tests.

R1. **Amorçage du PRNG → SplitMix64** (décision du commanditaire). Constat du relecteur : avec
    SplitMix32, les graines s et s + 0x9E3779B9 partageaient 3 des 4 mots d'état, décalés.
    Nouvel amorçage : état SplitMix64 = graine uint32, deux sorties z1, z2, état xoshiro =
    `[bas32(z1), haut32(z1), bas32(z2), haut32(z2)]` (convention `seed_from_u64` de
    rand_xoshiro). Calcul en BigInt (une fois par monde). Statut dans models.md : de « choix
    d'ingénierie » à « recommandation publiée ». **Conséquence : tous les hashs changent**
    (nouvelles valeurs épinglées dans `tests/determinism.test.ts` et STATE.md). Garde contre
    l'état nul conservée (inatteignable). `splitMix64Next` est exporté de `rng.ts` (pas de
    `index.ts`) pour être testé contre les vecteurs publiés.
R2. **Vecteurs publiés — ce qui a réellement été vérifié** :
    - xoshiro128** état [1,2,3,4] → 11520, 0, 5927040, 70819200, 2031721883, 1637235492,
      1287239034, 3734860849, 3729100597, 4258142804 : lu dans le test `reference` de
      `xoshiro128starstar.rs` de rand_xoshiro 0.8.1 sur docs.rs (le 2026-11-11), et recalculé
      avec le C de référence compilé par gcc. Une copie plus ancienne de la crate (vendue dans
      Fuchsia) porte une autre suite (5760, 40320, 70819200, …) : c'est la première version de
      l'algorithme (brouilleur sur s[0]) ; nous suivons la version actuelle (s[1]).
    - SplitMix64 graine 1234567 → 6457827717110365317, 3203168211198807973,
      9817491932198370423, 4593380528125082431, 16408922859458223821 : valeurs fournies de
      mémoire par le commanditaire, CONFIRMÉES par la page Rosetta Code
      « Pseudo-random numbers/Splitmix64 » et par une transcription de `splitmix64.c`
      compilée par gcc.
    - SplitMix64 graine 1477776061723855037 → 5 premières valeurs du test `reference` de
      `splitmix64.rs` (rand_xoshiro, lu sur docs.fuchsia.dev), recalculées par le C compilé.
    - Non vérifié directement : le code de `fill_bytes` de SplitMix64 dans rand_xoshiro (j'ai lu
      `seed_from_u64` → `from_splitmix!` → `from_rng`, et `from_seed` en lecture petit-boutiste ;
      l'ordre des octets produits par `fill_bytes` est supposé petit-boutiste, conformément à la
      consigne). Les états d'amorçage de 6 graines ont été recalculés par le C compilé avec
      cette convention et épinglés.
R3. **`World.hasComponent` vérifie que le store appartient au monde** (`assertOwned`), comme
    les autres opérations (models.md l'affirmait déjà).
R4. **Poignées invalides** : `isAlive` renvoie faux pour toute valeur qui n'est pas un entier
    sûr ≥ 0 (avant : `isAlive(0.5)` était vrai et `destroyEntity(0.5)` détruisait l'entité 0).
    Toutes les opérations sur poignée lèvent donc une erreur pour ces valeurs.
R5. **Hashs de référence épinglés** dans les tests : tout changement = changement de format ou
    d'histoire, à justifier ici.
R6. **Boucle : documentation alignée sur le code** (soustraction répétée, pas `floor`), sans
    changer l'algorithme ; chiffres constatés par exécution épinglés par des tests.
R7. Non changé (décisions ouvertes, voir STATE.md) : largeur de génération des poignées,
    remise à zéro dans `addComponent`, algorithme de la boucle.

### Paramètres inventés et ajouts non signalés au premier tour

R8. **Stub de rendu** (`src/render/main.ts`, `index.html`) : `SEED = 1`, `TICKS = 60`, canvas
    720 × 80, police 14 px monospace, couleurs #111/#eee — valeurs inventées, sans enjeu
    (le stub ne fait qu'afficher tick + hash d'un monde vide).
R9. **`testTimeout` Vitest = 60 s** (inventé) : marge pour les tests longs (10 000 ticks × 2,
    24 h de boucle simulée, 2^21 recyclages) sur une machine lente.
R10. **Ajouts hors strict énoncé, avec justification** :
    - `README.md` court : demandé dans la structure, contenu (commandes) choisi par moi.
    - `getState()`/`setState()` du PRNG : demandés par la consigne d'architecture (instantanés
      futurs) ; utilisés par les tests.
    - `droppedMs` de la boucle : observabilité du retard abandonné, rend l'abandon testable ;
      n'affecte pas la simulation.
    - Arguments CLI `[graine] [ticks]` de `scripts/headless.ts` : permettent de calculer le
      hash d'une autre graine sans modifier le code (utilisé pour la graine 20261112).


## 2026-11-11 — D1 Mise en ligne : cible de déploiement

### Décisions

D1. **Cible : page web statique publique.** Tout tourne dans le navigateur du joueur : pas de
    serveur, pas de comptes, pas de multijoueur. Hypothèse annoncée au propriétaire, non
    contredite ; à reconsidérer si une de ces trois exigences apparaît.
D2. **Hébergement GitHub Pages, dépôt public** (`https://github.com/Pipail69/demiurge`, page
    `https://pipail69.github.io/demiurge/`). Choix du propriétaire ; l'alternative « code privé +
    Cloudflare Pages » lui a été proposée. Conséquence assumée : le code source est public.
D3. **Chemins relatifs** : `base: './'` dans `vite.config.ts`. La page est servie sous
    `/demiurge/` ; les chemins relatifs fonctionnent là comme à la racine d'un autre hébergeur.
D4. **Vérification automatique des chemins : script npm `check:dist`**
    (`scripts/check-dist.ts`), lancé comme étape du workflow après `npm run build`. Choix
    (mien) : un script plutôt qu'un `grep` en YAML, pour pouvoir le lancer en local et le tester
    à la main. Il échoue (code 1) sur un `src/href/srcset/poster/data="/…"` dans le HTML, un
    `url(/…)` dans le CSS, ou un littéral `"/assets/…"` dans le JS. Contrôle négatif fait à la
    main le 2026-11-11 (HTML modifié en `src="/assets/…"` → échec, code 1) ; non automatisé dans
    la suite de tests. `npm run build` n'a pas été modifié (il n'appelle pas `check:dist`).
D5. **Les tests sont la barrière de déploiement** : le workflow a deux jobs ; `deploy` a
    `needs: build`, et `build` enchaîne `npm ci`, `typecheck`, `lint`, `test`, `build`,
    `check:dist`, puis `configure-pages` et `upload-pages-artifact`. Un échec à une étape
    quelconque empêche le déploiement. Déclencheurs : push sur `main` et `workflow_dispatch`.
    Permissions : `contents: read` globalement ; `pages: write` et `id-token: write` seulement
    dans le job `deploy`. `concurrency: { group: pages, cancel-in-progress: true }` (choix mien :
    un run plus récent annule le précédent ; le dernier commit est ce qui compte pour un site
    sans état. Les annulations apparaîtront comme « cancelled », pas comme des échecs).
D6. **Versions des actions** (dernières versions publiées, lues le 2026-11-11 sur les pages
    « Releases » de chaque dépôt, via WebFetch ; l'année exacte n'est pas affichée par ces pages,
    et l'API REST des dépôts `actions/*` est refusée par le proxy de session, donc non recoupé) :
    `actions/checkout@v7` (v7.0.1), `actions/setup-node@v7` (v7.1.0),
    `actions/configure-pages@v6` (v6.0.0), `actions/upload-pages-artifact@v5` (v5.0.0),
    `actions/deploy-pages@v5` (v5.0.1). Étiquettes majeures flottantes, pas de SHA épinglé
    (choix mien, usage courant ; l'épinglage par SHA est un durcissement possible).
D7. **Node 22** dans le workflow (`node-version: 22`, dernière 22.x) : cohérent avec
    `engines.node >= 22.18` et la version de développement (22.23.4). Cache npm via
    `actions/setup-node`.

### Décisions OUVERTES (non tranchées), conséquences du choix « navigateur »

a. **Déterminisme inter-navigateurs.** `Math.sin/exp/pow/log` (et autres transcendantes) ne
   sont pas garantis identiques entre V8, SpiderMonkey et JavaScriptCore. À trancher AVANT T1
   (bruit de terrain) ; bruit à base d'entiers recommandé. Le critère de déterminisme n'a été
   vérifié que sur V8 (voir STATE.md).
b. **SQLite (T2)** devra tourner dans le navigateur, donc en WebAssembly, avec téléchargement
   du fichier par le joueur ; la même bibliothèque est souhaitable sous Node pour le mode batch.
c. **Sauvegardes** : stockage local du navigateur ou fichier téléchargé/rechargé — non décidé.
d. **SharedArrayBuffer indisponible** : GitHub Pages ne permet pas de régler les en-têtes HTTP
   (COOP/COEP). Transfert Worker → rendu par messages/transferables ; à mesurer en T8/T9 ;
   migration possible vers un hébergeur à en-têtes réglables.

### Écart constaté à l'exécution (2026-11-11)

D8. **Pages non activé par l'API** : `POST repos/Pipail69/demiurge/pages` (build_type=workflow)
    → HTTP 403 « Access to this GitHub API path is not permitted through this proxy ». Pas de
    contournement tenté (en particulier pas de paramètre `enablement` dans `configure-pages`).
    Conséquence : le premier run a échoué à `configure-pages` ; activation manuelle par le
    propriétaire requise (Settings → Pages → Source : GitHub Actions).
    **Suite (2026-11-11)** : le propriétaire a activé Pages à la main (Source : GitHub Actions) ;
    run 43069278003 (workflow_dispatch, commit 8aa2d2e) : `build` et `deploy` en succès.
    `…/demiurge/index.html` et le bundle JS répondent (WebFetch) ; l'URL sans `index.html` a
    d'abord donné une erreur client (non expliqué) ; exécution JS / canvas et déploiement par
    push non vérifiés (voir STATE.md).

## 2026-11-11 — T1 Monde

### Décisions du propriétaire et de la session principale (imposées, consignées ici)

W1. **Aucune fonction mathématique non exacte entre moteurs JS dans `src/core`** (décision du
    propriétaire, recommandation acceptée ; tranche la décision ouverte D1-a pour le cœur).
    Autorisé : `+ − × ÷`, `Math.sqrt`, `Math.SQRT2`, `Math.fround`, `Math.imul`,
    `Math.floor/ceil/round/trunc/abs/min/max/sign`, entiers, bit à bit, tris de tableaux typés.
    Interdit : `Math.sin/cos/tan/asin/acos/atan/atan2/sinh/cosh/tanh/asinh/acosh/atanh/exp/expm1/
    log/log2/log10/log1p/pow/cbrt/hypot` et `**`/`**=`. Outillage : règles ESLint sur `src/core/**`
    et `tests/fixtures/**` + test statique `tests/forbidden-math.test.ts` (commentaires et chaînes
    retirés, contrôles négatif et positif). **Le lint et ce test restent des garde-fous
    contournables** (alias `const M = Math`, `Math['sin']`, `globalThis.Math`…), voir STATE.md
    décision ouverte c. Les tests (`tests/`) peuvent utiliser `Math.sin` (mesure d'erreur).
W2. **Grille = ressource dense du monde**, couches = tableaux typés ENTIERS nommés dans un tableau
    ordonné ; `World.grid` optionnel. Types de couches : ceux proposés par la session principale,
    sans ajustement.
W3. **Paramètres de génération dans l'état** : `World.params`, liste ordonnée (nom ASCII, f64),
    hachée. −0 normalisé en +0 et valeurs non finies refusées à l'ajout (choix mien : le hash
    lit les octets bruts).
W4. **Format de hash v2** (`HASH_FORMAT_VERSION` = 2) : sections paramètres puis grille après les
    composants (models.md § 4). **Conséquence : tous les hashs épinglés de T0 changent** alors que
    l'histoire simulée est identique (compteurs inchangés, tests verts) :
    graine 20261111 tick 0 `e2ea631b…` → `ba2ffb046fbb5be80d5092472b4a079bd8bd55a46cf6751b93bb1fd0672a9e59`,
    tick 1 000 `61809779…` → `95a081bbc6c708309924aba83a76db8527bd52cb5ea99b7f6abbbe772e95aa8f`,
    tick 10 000 `4078ad80…` → `23438c0b488662788e07a374e34abb5ef25c6e3320926764fc7c339f07dde475` ;
    graine 20261112 tick 10 000 `e106632d…` → `0fb538dd7482a0ddb3c715667389d1096d4028ff3ccdf31857cff51b1ca31d59`.
W5. **Monde-île** : océan forcé sur tout le pourtour (terme de bord + relèvement du niveau de la
    mer au maximum du bord si besoin, assertion, test sur 60 graines).
W6. **Un seul hémisphère, nord en haut, « climat compressé »** (latitude linéaire par ligne).
W7. **Érosion par incision (stream power law) sans dépôt** ; matière exportée hors du système,
    comptée ; conservation stricte à partir du tick 0, la genèse étant la cause de l'état initial.
W8. **Priority-Flood + ε** (Barnes et al. 2014) avec ε = 1 cm entier ; file = tas binaire maison,
    clé (niveau, index).
W9. **Saisons sans effet sur l'humidité ni les biomes** en T1 (seule la température courante varie) ;
    pas d'événement de changement de saison (journal = T2).
W10. **Web Worker toujours reporté** ; génération sur le fil principal : la page est bloquée
     pendant la génération (≈ 0,5–0,7 s mesuré dans Chrome headless, 512×512).
W11. **Graine de la page** lue dans `?seed=` ; défaut 20261111 (choix mien : graine de démo de T0).

### Ambiguïtés tranchées et choix d'ingénierie (miens)

W12. **Gradients du bruit** : 8 directions (±1,0), (0,±1), (±1,±1), non normalisées ; tirage
     `nextU32() >>> 29` (exactement un tirage par nœud, pas de rejet).
W13. **Sinus de Bhāskara** utilisé pour la latitude (P2(sin φ) et amplitude saisonnière) et le
     cycle saisonnier ; erreur absolue max mesurée 0,001632.
W14. **Température au niveau de la mer calibrée** sur North, Cahalan & Coakley (1981), tableau 1
     (T0 = 14,9 °C, T2 = −28,0 °C) — source trouvée et vérifiée (texte lu), pas « inventé ».
     Amplitude saisonnière A1 = 15,5 °C, même source (terme P1).
W15. **Glace de mer** : océan dont la température moyenne annuelle ≤ −1,9 °C (NOAA) et non −1,8 °C
     (valeur de l'énoncé, « à vérifier ») : la page NOAA lue indique « about -1.9 degrees Celsius ».
     Conséquence assumée : la banquise suit exactement une ligne de latitude (l'océan n'a pas de
     relief) → bord horizontal rectiligne sur la carte.
W16. **Lacs** : profondeur ≥ 3 m ET composante ≥ 9 cellules (le seuil de taille n'était pas dans
     l'énoncé ; ajouté contre le « mouchetis » de lacs d'une cellule). Tous les lacs sont
     exoréiques (ils s'écoulent vers la mer).
W17. **Érosion** : pas d'incision dans les dépressions ; une cellule de terre reste ≥ 1 cm (pas de
     recul du trait de côte) ; abaissement borné à (aval + 1 cm).
W18. **Humidité** : altitude de la masse d'air avec descente limitée (`airDescentCm`) et mélange
     méridien vertical (`humidityMixRadiusRef`) — deux ajouts au schéma de l'énoncé, introduits
     après inspection visuelle (sans eux : cartes rayées, une pluie orographique à chaque bosse).
     L'humidité stockée est un indice de précipitations relatif (255 = plaine côtière sous air
     saturé), pas une humidité relative de l'air.
W19. **Apport local** = max(0, humidité − 30) sur terre et lacs, 0 sur l'océan.
W20. **Coefficients d'humidité ramenés à la taille** (référence 512) ; K d'érosion NON ramené
     (le relief dépend donc un peu de la résolution ; non gênant en T1).
W21. **D8 exact sans racine** (comparaison des carrés des baisses pondérés 2:1) ; ordre de
     départage E, SE, S, SO, O, NO, N, NE.
W22. **Crochet `onStage`** dans `generateWorld` : permet la mesure par étape depuis l'extérieur sans
     dupliquer le pipeline ; ne doit pas modifier le monde (contrat documenté, non vérifiable).
W23. **`generateWorld` exige tick 0 et un monde sans terrain**, refuse un nom de paramètre déjà présent.
W24. **Taille** : côtés de 16 à 4 096 cellules (W·H ≤ 2^24 → débits u32 sans dépassement).

### Paramètres inventés (valeurs par défaut, `src/core/world/params.ts`)

W25. Grille 512×512 (énoncé). Bruit : `noiseBaseCells` 3, `noiseOctaves` 7. Relief :
     `landFraction` 0,40, `edgeMarginFraction` 0,12, `edgeDrop` 1, `maxAltitudeM` 5 000,
     `oceanDepthM` 4 000, profil h². Érosion : `erosionK` 0,002, `erosionIterations` 8.
     Hydrologie : `fillEpsilonCm` 1, `lakeMinDepthCm` 300, `lakeMinCells` 9,
     `runoffHumidityThreshold` 30, `riverAreaFraction` 0,0006. Climat : `latNorthDeg` 66,
     `latSouthDeg` 0, `ticksPerYear` 7 200, décalage saisonnier 1/8 d'année. Humidité :
     `moistMax` 10⁶, `evapRef` 3 000, `rainBaseRef` 450, `rainOro` 30, `airDescentCm` 2 000,
     `humidityMixRadiusRef` 3. Biomes (centièmes de °C / humidité) : glace < −1 000, toundra
     < −200, désert H < 40, taïga < 400, tropical ≥ 2 000, forêt tempérée H ≥ 110, forêt
     tropicale sèche H ≥ 100, forêt tropicale humide H ≥ 180. Palette : couleurs choisies à la main.
W26. **Réglage à l'œil** (cartes PNG de 4 graines regardées, hors dépôt) : premier jeu
     (`latNorthDeg` 80, `latSouthDeg` 5, `rainOro` 160, `rainBaseRef` 600, sans altitude de la
     masse d'air ni mélange) → moitié de la carte en glace, déserts sur 30 % des terres, rayures
     horizontales ; valeurs ci-dessus retenues après 4 itérations.
W27. Tolérances de test inventées : fraction émergée ±0,04 ; |moyenne du bruit| < 0,02 ;
     |moyenne du cycle| < 10⁻¹² ; contraintes « physiques » de la table indépendante des biomes.
