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
8. **Amorçage SplitMix32** (incrément 0x9E3779B9 + finaliseur fmix32 de MurmurHash3) : choix
   d'ingénierie, ce n'est pas un standard publié (Vigna recommande SplitMix64). Garde contre
   l'état nul conservée bien qu'inatteignable.
9. **Graine = uint32** (pas de graine 64 bits ni chaîne). Suffisant pour T0 ; une graine
   textuelle pourra être réduite en uint32 plus tard si besoin (non décidé).
10. **`nextFloat` à 32 bits de résolution** (u32 / 2^32), pas 53 bits : un seul tirage par
    flottant, division exacte.
11. **Pas de vecteurs publiés pour xoshiro128\*\*** à ma disposition de façon vérifiable :
    vérification croisée contre une implémentation BigInt indépendante dans le test (voir
    models.md). Ce n'est pas une preuve contre une erreur de transcription commune.

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
