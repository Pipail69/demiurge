# Modèles des systèmes

Chaque section distingue :

- **[standard publié]** : algorithme ou norme publiés, repris tels quels ;
- **[choix d'ingénierie]** : décision de conception propre au projet ;
- **[paramètre inventé]** : valeur numérique choisie sans source de calibrage (à réévaluer).

T0 pose les fondations (§ 1–4) ; T1 ajoute le monde procédural (§ 4 v2, § 5–14). Pas encore d'agents.

**Arithmétique du cœur (décision du 2026-11-11, T1)** : uniquement des opérations dont le résultat est
garanti au bit près par ECMAScript sur tout moteur : `+ − × ÷` (IEEE 754, arrondi correct, pas de
contraction FMA en JS), `Math.sqrt`, `Math.SQRT2`, `Math.fround`, `Math.imul`,
`Math.floor/ceil/round/trunc/abs/min/max/sign`, opérations entières et bit à bit, tris de tableaux
typés. Interdits : `Math.sin/cos/tan/asin/acos/atan/atan2/sinh/cosh/tanh/asinh/acosh/atanh/exp/
expm1/log/log2/log10/log1p/pow/cbrt/hypot` et `**` (ESLint + test statique `tests/forbidden-math.test.ts`).

---

## 1. Générateur pseudo-aléatoire (`src/core/rng.ts`)

### Algorithme

- **[standard publié]** xoshiro128** — D. Blackman & S. Vigna, *Scrambled Linear Pseudorandom
  Number Generators*, ACM TOMS 47(4), 2021 ; code C de référence sur prng.di.unimi.it.
  État `s[0..3]` de 4 × 32 bits, période **2^128 − 1** (tout état non nul), sortie 32 bits :

  ```
  result = rotl(s[1] * 5, 7) * 9          (mod 2^32)
  t      = s[1] << 9
  s[2] ^= s[0];  s[3] ^= s[1];  s[1] ^= s[2];  s[0] ^= s[3];
  s[2] ^= t;     s[3]  = rotl(s[3], 11)
  ```

- **[choix d'ingénierie]** Implémentation en opérations entières 32 bits uniquement
  (`Math.imul`, décalages, `>>> 0`) : ces opérations sont exactement spécifiées par ECMAScript,
  donc la suite est identique au bit près sur tout moteur conforme (Node, navigateurs, Worker).
- **[choix d'ingénierie]** L'état vit dans un `Uint32Array(4)` (`rng.state`), copiable par
  `getState()` et restaurable par `setState()` ; il fait partie du hash du monde.
- **[choix d'ingénierie]** Un seul générateur par monde, possédé par le monde ; pas de sous-flux.
  Conséquence : l'ordre des tirages fait partie de l'histoire (changer l'ordre des systèmes
  change l'histoire — c'est voulu et testé).

### Amorçage (révisé après relecture, 2026-11-11)

- Graine : entier uint32 (`[0, 2^32)`), sinon `RangeError`.
- **[recommandation publiée]** SplitMix64 (Steele, Lea & Flood, OOPSLA 2014 ; code C de
  référence `splitmix64.c` de S. Vigna), que Blackman & Vigna recommandent pour amorcer
  la famille xoshiro :
  ```
  x = (x + 0x9E3779B97F4A7C15) mod 2^64
  z = x;  z = (z ^ z>>30) * 0xBF58476D1CE4E5B9;  z = (z ^ z>>27) * 0x94D049BB133111EB;  z ^= z>>31
  ```
  État initial de SplitMix64 = la graine (uint32 étendue à 64 bits). Deux sorties z1, z2 ;
  état xoshiro = `[bas32(z1), haut32(z1), bas32(z2), haut32(z2)]` — **[convention publiée]**
  de `seed_from_u64` de la crate Rust `rand_xoshiro` (remplissage des octets par SplitMix64,
  lecture petit-boutiste des mots). Calcul en `BigInt`, une fois par monde.
- Pourquoi ce changement : l'amorçage précédent (« SplitMix32 » maison, incrément 32 bits
  0x9E3779B9) donnait aux graines s et s + 0x9E3779B9 des états partageant 3 mots sur 4,
  décalés d'une position. Avec SplitMix64, deux graines uint32 diffèrent de moins de 2^32 et
  ne peuvent pas différer de l'incrément 64 bits : pas de recouvrement décalé de ce type
  (testé sur un échantillon, avec contrôle négatif sur l'ancien amorçage).
- Garde contre l'état tout-à-zéro (point fixe de xoshiro) : si les 4 mots valent 0, `s[0] := 1`.
  La sortie de SplitMix64 est une bijection de son état et les deux états utilisés sont
  distincts : au plus une sortie est nulle, la garde est inatteignable. `setState([0,0,0,0])`
  lève une erreur.

### Conversions

- `nextU32()` : sortie brute, uniforme sur `[0, 2^32)`.
- `nextFloat()` = `nextU32() / 2^32` ∈ `[0, 1)`. Division exacte en double IEEE 754
  (u32 < 2^53, diviseur puissance de 2). Résolution : multiples de 2^−32 (32 bits d'aléa,
  pas 53) — **[choix d'ingénierie]**, suffisant pour un jeu ; à revoir si un système exige
  des probabilités < 2^−32.
- `nextInt(n)`, n entier ∈ `[1, 2^32]` : rejet des tirages `r < (2^32 mod n)` puis `r mod n`.
  Le nombre de valeurs acceptées est un multiple de n → **aucun biais modulo**. Probabilité
  de rejet < 1/2 ; nombre de tirages consommés variable mais déterministe.

### Ce qui est vérifié, et comment (`tests/rng.test.ts`)

- **Vecteurs publiés** :
  - SplitMix64, graine 1234567 → 5 premières sorties (tâche « Pseudo-random numbers/Splitmix64 »
    de Rosetta Code) ; graine 1477776061723855037 → 5 premières sorties (test `reference` de
    `splitmix64.rs`, crate `rand_xoshiro`). Les deux suites ont aussi été recalculées avec une
    transcription de `splitmix64.c` compilée par gcc (identiques).
  - xoshiro128**, état [1,2,3,4] → 10 premières sorties (test `reference` de
    `xoshiro128starstar.rs`, `rand_xoshiro` 0.8.1, lu sur docs.rs ; valeurs recalculées avec le
    C de référence compilé par gcc). Attention : d'anciennes copies de cette crate (p. ex. la
    copie vendue dans Fuchsia) portent la suite 5760, 40320, … de la première version de
    xoshiro128** (brouilleur sur s[0]) ; la version actuelle de l'algorithme utilise s[1].
- **Vérification croisée** : implémentation de référence BigInt indépendante dans le test,
  transcrite de l'algorithme C, comparée sur 5 000 tirages × 8 graines et sur l'état final ;
  l'amorçage est comparé à une transcription BigInt de SplitMix64 et à des états épinglés
  calculés par le C compilé.
- Même graine → même suite ; graines voisines → suites différentes.
- Bornes de `nextU32`, `nextFloat` ∈ [0,1), `nextInt` (n = 1, 2, …, 2^32) et refus des entrées invalides.
- Uniformité grossière : chi-deux de `nextInt(10)` sur 100 000 tirages < 27,877 (quantile
  0,999, 9 ddl). Absence de biais modulo : `nextInt(3·2^30)` réparti en 3 tiers, chi-deux
  < 13,816 (quantile 0,999, 2 ddl), et contrôle qu'un modulo naïf échoue à ce même test.
  Graines fixes → tests déterministes, non instables.
- Aller-retour `getState`/`setState` (même générateur et générateur différent).

---

## 2. Boucle à pas fixe (`src/core/loop.ts`)

- **Sémantique du tick** : `step(world)` exécute chaque système une fois, dans l'ordre
  d'enregistrement, puis incrémente `world.tick`. Pendant le tick n (0-indexé), les systèmes
  lisent `world.tick = n`. Un système ajouté pendant un tick ne s'exécute qu'au tick suivant.
- **[choix d'ingénierie]** Accumulateur : `advance(elapsedMs)` ajoute le temps réel fourni par
  l'APPELANT (le cœur ne lit jamais d'horloge) à `acc`, puis, tant que `acc >= stepMs` et que
  le plafond n'est pas atteint : un tick, puis `acc -= stepMs` (SOUSTRACTION RÉPÉTÉE en double,
  pas `floor(acc / stepMs)`). Renvoie le nombre de ticks exécutés. Les arrondis comptent :
  avec `stepMs = 1000/30`, `advance(100)` exécute 2 ticks (et non 3) et garde un reste
  `33.33333333333332 < stepMs` ; 10 × `advance(100)` → 29 ticks ; 24 h en trames de
  1000/60 ms → exactement 2 592 000 ticks (chiffres constatés par exécution, épinglés par
  des tests). Le reste n'est jamais perdu hors abandon.
- **[choix d'ingénierie]** Plafond de rattrapage (anti « spirale de la mort ») : si, après
  `maxStepsPerAdvance` ticks, il reste au moins un pas entier de retard, ce retard est
  abandonné ; seule la fraction de pas (`acc mod stepMs`) est conservée. Le retard abandonné
  est cumulé dans `droppedMs` (observabilité). La simulation ralentit donc par rapport au temps
  réel au lieu d'accumuler une dette ; son issue n'en dépend pas.
- **[paramètre inventé / repris]** `stepMs = 1000/30` (30 ticks/s, repris de la cible de
  performance T9 du projet) ; `maxStepsPerAdvance = 8` (≈ 267 ms de rattrapage par appel ;
  valeur inventée).
- Entrées invalides (`NaN`, ±∞, négatif) → `RangeError`, aucun tick exécuté.
- **Propriété** : l'arithmétique flottante de l'accumulateur ne décide QUE du nombre de ticks
  exécutés à chaque appel ; l'état du monde ne dépend que du nombre total de ticks. Testé :
  deux découpages différents du temps réel menant à 600 ticks donnent le même hash.
- L'accumulateur n'est pas un état logique du monde (non haché).

---

## 3. ECS minimal (`src/core/ecs/`)

### Entités (`entities.ts`)

- Index uint32 + génération uint32. Tableaux `alive: Uint8Array`, `generation: Uint32Array`,
  `freeList: Uint32Array` (pile LIFO) et `highWater` (emplacements jamais alloués).
- Allocation : dépiler la liste libre si non vide, sinon `highWater++`. Destruction :
  `alive = 0`, `generation += 1` (mod 2^32), index empilé. **[choix d'ingénierie]** LIFO :
  recyclage déterministe et localité mémoire.
- **[choix d'ingénierie]** Poignée `Entity` = un `number` exact :
  `(generation mod 2^21) × 2^32 + index` (< 2^53). La poignée périmée est détectée si la
  génération courante (mod 2^21) diffère. Limite connue : une poignée conservée pendant que son
  emplacement est recyclé exactement un multiple de 2^21 fois serait jugée valide (ABA).
- Capacité : doublement (`initialCapacity` par défaut 64, **[paramètre inventé]**). Tous les
  tableaux de composants sont réalloués avec l'allocateur.

### Composants (`component.ts`)

- Schéma `{ champ: 'f32' | 'f64' | 'i8' | 'i16' | 'i32' | 'u8' | 'u16' | 'u32' }` → un tableau
  typé par champ (SoA) + `present: Uint8Array`.
- Noms de composants et de champs : identifiants ASCII `/^[A-Za-z_][A-Za-z0-9_]*$/`.
- **[choix d'ingénierie]** Ordre des champs FIGÉ à l'enregistrement : tri lexicographique
  (unités de code UTF-16) des noms. L'ordre de déclaration du schéma n'a aucune influence.
- Composants rangés dans un TABLEAU ; `id` = ordre d'enregistrement.

### Invariants et forme canonique

1. L'état logique se limite à `[0, highWater)` ; la capacité allouée n'y figure pas (le hash
   est identique pour toute capacité — testé).
2. **Forme canonique** : un emplacement mort, ou un composant absent, a tous ses champs à 0 et
   `present = 0`. Le cœur remet à zéro au retrait de composant et à la destruction d'entité ;
   `addComponent` ne remet PAS à zéro (il suppose l'invariant déjà vrai). L'invariant repose
   donc aussi sur la DISCIPLINE DES SYSTÈMES : écrire dans le champ d'un composant absent,
   dans un emplacement après `destroyEntity` (p. ex. dans un callback de `query`) ou au-delà de
   `highWater` n'est ni empêché ni détecté, et casserait l'égalité « même état logique ⇒ même
   hash ». Décision ouverte (STATE.md) : validateur `assertCanonical` en mode test et/ou remise
   à zéro dans `addComponent`.
3. `freeList[freeCount..]` est remis à 0 à chaque dépilement (aucun résidu, bien que non haché).
4. `aliveCount` = nombre d'entités vivantes (dérivé, non haché).
5. Ajout d'un composant déjà présent, retrait d'un composant absent, opération sur une poignée
   périmée, composant d'un autre monde → erreur (jamais d'effet silencieux).

### Itération (`World.query`)

- Visite par index d'entité croissant. Aucune itération de `Map`/objet n'intervient.
- **[choix d'ingénierie]** Règle de mutation pendant l'itération : l'ensemble candidat (index +
  génération des entités vivantes possédant TOUS les composants demandés) est figé au début de
  l'itération ; au moment de sa visite, un candidat n'est visité que s'il est encore vivant,
  de même génération, et possède encore tous les composants. Donc :
  - entité créée pendant l'itération (même dans un index recyclé) → **non visitée** ;
  - composant ajouté pendant l'itération à une entité non candidate → **non visitée** ;
  - entité détruite ou composant retiré avant la visite → **sautée**.
  Comportement testé, y compris avec croissance de capacité pendant l'itération.
- Coût : deux `Uint32Array(highWater)` alloués par requête (optimisation renvoyée à T9).
- Les tableaux de champs sont REMPLACÉS lors d'une croissance de capacité : ne pas conserver
  une référence `store.fields.x` à travers une création d'entité (relire `store.fields`).

---

## 4. Hash de l'état complet (`src/core/hash.ts`, `src/core/sha256.ts`)

### SHA-256

- **[standard publié]** FIPS 180-4. **[choix d'ingénierie]** implémentation TypeScript pure,
  synchrone, incrémentale (`update`/`digest`, sortie hex), sans `node:crypto` ni
  `crypto.subtle`, pour un comportement identique sous Node et en Worker.
- Vérifié contre `node:crypto` (dans les tests uniquement) : vecteurs vide et "abc", toutes les
  longueurs 0..300 octets (×3, 903 tampons, dont 55/56/63/64/65/119/120), 50 découpages
  incrémentaux aléatoires, un tampon de 5 Mo + 13 octets en morceaux irréguliers.

### Format de sérialisation canonique (version 2 depuis T1 ; v1 = sections 1–9 + composants)

Flux d'octets haché, suite de sections :

```
section := u32le(len(label)) · label(ASCII) · u64le(len(payload)) · payload
```

Les entiers d'en-tête sont écrits en petit-boutiste explicite (DataView). La longueur annoncée
est vérifiée contre la longueur écrite (erreur sinon). Ordre exact (hw = highWater, fc = freeCount) :

| # | étiquette | charge utile |
|---|-----------|--------------|
| 1 | `format` | u32 = 2 (version du format) |
| 2 | `seed` | u32 |
| 3 | `tick` | u64 |
| 4 | `rng` | 4 × u32 (`rng.state`) |
| 5 | `entities.highWater` | u32 |
| 6 | `entities.alive` | hw × u8 |
| 7 | `entities.generation` | hw × u32 |
| 8 | `entities.freeList` | fc × u32 (bas de pile en premier) |
| 9 | `components.count` | u32 |
| puis, pour chaque composant dans l'ordre d'enregistrement : | | |
| a | `component.name` | nom ASCII |
| b | `component.schema` | ASCII `champ:type;champ:type…` dans l'ordre figé |
| c | `component.present` | hw × u8 |
| d | `field:<nom>` (un par champ, ordre figé) | hw × taille du type |
| 10 | `params.count` | u32 (v2) |
| puis, pour chaque paramètre dans l'ordre de `world.params` : | | |
| e | `param.name` | nom ASCII |
| f | `param.value` | f64 petit-boutiste (motif IEEE 754 ; valeur finie, −0 normalisé en +0 à l'ajout) |
| 11 | `grid.present` | u32 : 0 (pas de terrain : fin du flux) ou 1 (v2) |
| si présent : 12 | `grid.width` | u32 |
| 13 | `grid.height` | u32 |
| 14 | `grid.layers.count` | u32 |
| puis, pour chaque couche dans l'ordre d'enregistrement : | | |
| g | `layer.name` | nom ASCII |
| h | `layer.type` | ASCII (`i8`, `i16`, `i32`, `u8`, `u16`, `u32`) |
| i | `layer.data` | W·H × taille du type (octets de la plateforme, petit-boutisme exigé) |

Non hachés (pas un état logique) : capacité, données au-delà de `highWater`/`freeCount`,
`aliveCount`, liste des systèmes (code), accumulateur de la boucle.

### Hypothèse de boutisme

- **[choix d'ingénierie]** Les tableaux typés sont lus par une vue `Uint8Array` : octets dans le
  boutisme de la plateforme. Le format EXIGE le petit-boutisme ; `hashWorld` vérifie à
  l'exécution et lève une erreur explicite sinon (toutes les plateformes visées — x86-64,
  ARM64 — sont petit-boutistes).
- Conséquences des octets bruts : `-0` et `+0` donnent des hashs différents ; un `NaN` peut
  avoir plusieurs motifs de bits (un NaN produit par calcul peut en théorie différer d'un moteur
  à l'autre). Voir STATE.md, pièges connus.

---

## 5. Grille du terrain (`src/core/grid.ts`)

- **[choix d'ingénierie]** Le terrain est une **ressource dense** du monde (motif « ressource » ou
  « singleton » d'un ECS), pas un ensemble d'entités : chaque cellule existe toujours, sans
  identité ni cycle de vie ; index `c = y·W + x`, nord en haut (y = 0). `World.grid` est
  optionnel (`null` avant la genèse).
- Couches = tableaux typés **entiers** nommés (ASCII), rangés dans un TABLEAU ordonné (ordre
  d'enregistrement = ordre de hachage ; recherche linéaire par nom, jamais de Map).
  Raisons du tout-entier : comparaisons exactes (critère b), bilan de masse exact, aucun −0/NaN.
- Côté maximal : 4 096 (W·H ≤ 2^24 : les débits tiennent en u32, voir § 10).
- Couches de T1, dans l'ordre :

| couche | type | unité / sens |
|---|---|---|
| `elevation` | i32 | cm par rapport au niveau de la mer (0) ; fond pour les lacs et l'océan |
| `waterSurface` | i32 | cm : 0 pour l'océan, surface du lac, = `elevation` pour la terre |
| `water` | u8 | 0 terre, 1 océan, 2 lac |
| `flowDir` | u8 | direction D8 0..7 vers l'aval (§ 10), 255 = pas d'aval (océan) |
| `discharge` | u32 | débit cumulé, unités d'apport (§ 10) |
| `river` | u8 | 0/1 |
| `temperatureMean` | i16 | moyenne annuelle, centièmes de °C |
| `humidity` | u8 | 0..255 (indice de précipitations relatif, § 12) |
| `biome` | u8 | identifiant § 13 |

- **Paramètres du monde** (`World.params`, liste ordonnée `{nom ASCII, valeur f64}`) : tous les
  paramètres de génération réellement utilisés y sont enregistrés dans l'ordre de `PARAM_NAMES`
  (`src/core/world/params.ts`) et hachés. Règle : deux mondes de même hash ont le même futur
  (p. ex. `ticksPerYear`, latitudes et amplitude saisonnière gouvernent la température courante).

## 6. Pipeline de génération (`src/core/world/generate.ts`)

Ordre (aucune circularité ; chaque étape ne lit que des couches déjà produites) :

```
bruit → relief → érosion → hydrologie finale (océan, lacs, écoulement) → température →
humidité → débit → rivières → biomes → enregistrement (couches, paramètres, assertions)
```

- `generateWorld(world, surcharges?, crochets?)` exige un monde sans terrain au tick 0, consomme
  `world.rng` (uniquement dans le bruit), remplit la grille, enregistre les paramètres et renvoie
  des statistiques (fractions terre/océan/lac, cellules de rivière, biomes, totaux érodé/comblé,
  sommes d'élévation, tirages PRNG). Le crochet `onStage(nom)` permet de mesurer chaque étape
  **depuis l'extérieur** (le cœur ne lit aucune horloge).
- **Conservation (règle 2)** : la genèse est la cause de l'état initial ; les quantités
  déplacées pendant la genèse (matière érodée, matière comblée) sont enregistrées dans les
  statistiques renvoyées (cause enregistrée en attendant le journal de T2), et le bilan
  `Σ élévation finale = Σ initiale − érodé + comblé` est vérifié exactement (assertion + tests).
  La conservation au sens strict s'applique à partir du tick 0.
- **Assertions par construction** : tout le pourtour est de l'océan ; bilan de masse exact.

## 7. Bruit (`src/core/world/noise.ts`)

- **[standard publié]** Bruit de gradient sur treillis (famille de K. Perlin) avec
  l'interpolant quintique `s(t) = 6t⁵ − 15t⁴ + 10t³` (Perlin, « Improving Noise », 2002 ;
  formule et justification — dérivées 1re et 2e nulles en 0 et 1 — lues dans GPU Gems ch. 5,
  « Implementing Improved Perlin Noise », K. Perlin, référence « Perlin 2002, Computer Graphics
  35(3) »). Écrit `t³(t(6t − 15) + 10)`.
- **[choix d'ingénierie]** 8 gradients fixes à composantes entières (±1, 0), (0, ±1), (±1, ±1),
  non normalisés (comme les 12 gradients « milieux d'arêtes du cube » de Perlin 2002, en 2D) :
  aucune trigonométrie.
- **[choix d'ingénierie]** Un seul générateur : chaque nœud reçoit `code = nextU32() >>> 29`
  (3 bits de poids fort, exactement un tirage par nœud, pas de rejet), tirés octave par
  octave, puis ligne par ligne (j croissant), puis i croissant. Pas de hachage de coordonnées.
- Valeur en (x, y) (unités de treillis), i = ⌊x⌋, j = ⌊y⌋, (fx, fy) = parties fractionnaires,
  dᵢⱼ = gᵢⱼ · (fx − i', fy − j') pour les 4 coins, puis interpolation bilinéaire pondérée par
  s(fx), s(fy). Nulle exactement sur les nœuds.
- **Borne démontrée |n| ≤ 1** : n est une moyenne pondérée (poids ≥ 0, somme 1) des dᵢⱼ et
  |dᵢⱼ| ≤ |dx| + |dy| ; la somme pondérée des |dx| vaut g(fx) = fx(1 − s) + s(1 − fx), et
  g(f) − ½ = −2(f − ½)(s(f) − ½) ≤ 0 car s est croissante avec s(½) = ½. Donc |n| ≤ ½ + ½ = 1,
  borne atteinte en (½, ½) quand les 4 gradients diagonaux pointent vers le centre (testé).
- **Continuité** : |∂n/∂x| ≤ 2·max s'·max|d| + 1 = 2·(15/8)·2 + 1 = 8,5 par unité de treillis
  (idem en y) ; testé : |n(x + h) − n(x)| ≤ 8,5·h.
- **fBm** : Σₖ aₖ·n(fₖ·p) / Σₖ aₖ, fₖ = `noiseBaseCells`·2ᵏ cellules de treillis sur le plus grand
  côté de la carte, aₖ = 2⁻ᵏ (lacunarité 2, gain ½ : **[choix d'ingénierie]**, valeurs usuelles).
  Échantillon au centre des cellules : p = ((x + ½)·fₖ/max(W,H), (y + ½)·fₖ/max(W,H)).
  Treillis de ⌊W·fₖ/max⌋ + 2 × ⌊H·fₖ/max⌋ + 2 nœuds. |fBm| ≤ 1.
- **[paramètre inventé]** `noiseBaseCells` = 3, `noiseOctaves` = 7 → 50 701 tirages quelle
  que soit la taille (carrée) de la carte.

## 8. Relief (`generate.ts`, étape « relief »)

1. Terme de bord (monde-île) : d = distance (en cellules, norme ∞) au bord, marge
   m = `edgeMarginFraction`·min(W, H), t = min(1, d/m), brut r = fBm − `edgeDrop`·(1 − t)².
2. Niveau de la mer par quantile : tri (tableau typé) des r, seuil s = r trié à l'index
   round((1 − `landFraction`)·N) − 1 → environ `landFraction`·N cellules au-dessus.
   **Garantie par construction** : s est relevé au maximum de r sur le pourtour si nécessaire
   (indicateur `seaLevelClamped`), donc toute cellule de bord a r ≤ s → altitude ≤ 0 → océan
   (relié au bord par elle-même). Assertion finale + test sur 60 graines.
3. Mise à l'échelle et quantification (`Math.round`, cm entiers) :
   terre (r > s) : h = (r − s)/(r_max − s) ∈ ]0, 1], z = max(1, round(`maxAltitudeM`·100·h²)) ;
   mer (r ≤ s) : z = −round(`oceanDepthM`·100·(s − r)/(s − r_min)) (jamais −0).
   h² : **[choix d'ingénierie / simplification de jeu]** basses terres étendues, sommets rares.
- **[paramètres inventés]** `landFraction` 0,40 (tolérance testée ±0,04 sur la fraction émergée
  terre + lacs, 8 graines), `edgeMarginFraction` 0,12, `edgeDrop` 1, `maxAltitudeM` 5 000,
  `oceanDepthM` 4 000.

## 9. Érosion (`src/core/world/erosion.ts`)

- **[source publiée, forme seulement]** Loi de puissance du courant (« stream power law »)
  E = K·Aᵐ·Sⁿ (Whipple & Tucker 1999, J. Geophys. Res. 104(B8), 17 661–17 674, équation 1 ;
  l'article indique m/n « dans un intervalle étroit proche de 0,5 (0,35 < m/n < 0,6) » et
  utilise m/n = 0,5 dans ses exemples). Ici m = ½, n = 1 → E = K·√A·S (seul `Math.sqrt`, exact).
  n = 1 est un **choix** (l'article souligne que n est l'inconnue critique).
- **[simplification de jeu]** Pas de temps sans unité physique ; K et le nombre d'itérations
  sont inventés et calés à l'œil sur des cartes 512×512 (non indépendants de la résolution).
- Schéma explicite, `erosionIterations` passes ; chaque passe :
  1. océan + Priority-Flood + ε (§ 10) sur l'élévation courante → surface comblée F, ordre ;
  2. D8 sur F ; aire drainée A = nombre de cellules non océaniques amont (apport uniforme 1) ;
  3. dans l'ordre du Priority-Flood (aval d'abord), pour chaque cellule de terre hors dépression
     (z = F) d'aval r (surface S_r déjà mise à jour ; 0 pour l'océan, F pour un lac) :
     baisse b = z − S_r > 0, Δ = ⌊K·√A·b / d⌋ (d = 1 ou √2), puis Δ ≤ b − 1 (reste strictement
     au-dessus de l'aval : pas de fosse) et Δ ≤ z − 1 (une cellule de terre reste ≥ 1 cm,
     **choix** : le trait de côte ne bouge pas). Cellules en dépression : pas d'incision.
- **[simplification de jeu]** Pas de dépôt : la matière érodée (Σ Δ, entier exact) sort du
  système (« exportée vers l'océan »), enregistrée dans `erodedTotal`.
- **[paramètres inventés]** `erosionK` 0,002, `erosionIterations` 8.

## 10. Hydrologie (`src/core/world/hydrology.ts`, `heap.ts`)

- **Océan** = cellules d'altitude ≤ 0 reliées au pourtour par des cellules ≤ 0 (8-connexité,
  parcours en largeur). Une cuvette ≤ 0 non reliée est une dépression comme une autre.
- **[standard publié]** Comblement par **Priority-Flood + ε** : R. Barnes, C. Lehman, D. Mulla
  (2014), « Priority-Flood: An optimal depression-filling and watershed-labeling algorithm for
  digital elevation models », *Computers & Geosciences* 62, 117–127,
  doi:10.1016/j.cageo.2013.04.024 (algorithme 3, « Priority-Flood+ε » ; référence lue sur la
  prépublication arXiv:1511.04463). **[choix d'ingénierie]** ε entier fixe = `fillEpsilonCm` = 1 cm
  au lieu de `NextAfter` (élévations entières : pas de problème de précision). File amorcée par
  les cellules d'océan voisines d'une cellule non océanique, au niveau 0 (surface de la mer) ;
  `F[n] = max(z[n], F[parent] + ε)` à la première visite. **File = tas binaire maison sur
  tableaux typés, ordre total (niveau, index)** : l'ordre ne dépend pas de la structure du tas.
  Propriétés (testées) : F = max(z, min voisins F + ε) pour toute cellule non océanique ;
  chaque cellule non océanique a un voisin strictement plus bas ; niveaux sortis en ordre
  croissant, donc l'ordre de sortie inversé est un ordre topologique amont → aval.
- **Lacs** : cellule non océanique de profondeur F − z ≥ `lakeMinDepthCm` (300) dans une
  composante 8-connexe d'au moins `lakeMinCells` (9) telles cellules → lac, `waterSurface = F`.
  **[simplification de jeu]** Les autres dépressions sont comblées dans le terrain
  (« comblement sédimentaire » : z ← F, total `filledTotal`, compté dans le bilan). La surface
  d'un lac est inclinée de ε par cellule vers l'exutoire (1 cm/cellule, invisible).
- **Écoulement D8** sur `waterSurface` : directions codées 0 E, 1 SE, 2 S, 3 SO, 4 O, 5 NO,
  6 N, 7 NE (y vers le bas) ; 255 pour l'océan. Plus grande pente baisse/distance (1 ou √2),
  comparée **exactement** sans racine : baisse_diag/√2 > baisse_orth ⇔ baisse_diag² > 2·baisse_orth²
  (entiers < 2^53). Égalités : premier voisin dans l'ordre ci-dessus. Les lacs s'écoulent par la
  même règle (surface comblée strictement descendante) jusqu'à leur exutoire, puis à la mer :
  **tous les lacs sont exoréiques** (simplification : pas de lac salé endoréique).
- **Débit** : `discharge[c] = apport[c] + Σ discharge[amont]` en entiers exacts, calcul dans
  l'ordre topologique ; apport = 0 pour l'océan, sinon max(0, humidité − `runoffHumidityThreshold`)
  (30) : les déserts n'alimentent presque pas de rivières. Pas de dépassement : débit ≤
  255·W·H < 2^32 car W·H ≤ 2^24 (vérification explicite en plus).
- **Rivière** : cellule de terre de débit ≥ seuil = max(1, round(`riverAreaFraction`·N·255))
  (fraction 0,0006 → 40 108 à 512×512 : ≈ 0,06 % de la carte drainée à pleine humidité) ;
  le seuil suit la taille de la carte. **[paramètres inventés]** `lakeMinDepthCm`,
  `lakeMinCells`, `runoffHumidityThreshold`, `riverAreaFraction`.

## 11. Température (`src/core/world/climate.ts`)

- **[simplification de jeu]** Un seul hémisphère, nord en haut ; latitude linéaire de
  `latNorthDeg` (ligne 0) à `latSouthDeg` (dernière ligne) ; « climat compressé » : la carte ne
  représente pas une vraie distance pôle-équateur. **[paramètres inventés]** 66° et 0°.
- **[formule publiée, VIIe siècle]** sin x° ≈ 4x(180 − x) / (40500 − x(180 − x)), x ∈ [0, 180]
  (Bhāskara I, *Mahābhāskarīya* ; erreur absolue max ≈ 0,0016 selon l'article Wikipédia
  « Bhāskara I's sine approximation formula »), prolongée par imparité et période 360.
  Erreur mesurée dans les tests contre `Math.sin` : 0,001632 (à 11,544°).
- **[source publiée, calibrée]** Température moyenne annuelle au niveau de la mer :
  T(φ) = T0 + T2·P2(sin φ), P2(x) = (3x² − 1)/2, avec T0 = 14,9 °C et T2 = −28,0 °C : coefficients
  du tableau 1 (champs de l'hémisphère nord symétrisés, ligne « T(x,t), sea-level temperature »)
  de G. R. North, R. F. Cahalan, J. A. Coakley Jr. (1981), « Energy balance climate models »,
  *Reviews of Geophysics and Space Physics* 19(1), 91–121. Donne 28,9 °C à l'équateur, −13,1 °C
  au pôle (sin calculé par Bhāskara).
- **[standard publié]** Gradient vertical 6,5 °C/km : atmosphère type internationale
  (ISO 2533:1975 ; ICAO Doc 7488 a le même modèle), couche 0 (troposphère), +15 °C au niveau de
  la mer. Appliqué à la surface z = `waterSurface` (terre : élévation ; lac : surface ; océan : 0).
- Stockage : `T = round(100·T_mer(φ_ligne)) − round(z·6,5/1000)` en centièmes de °C (z en cm ;
  deux arrondis séparés → l'écart entre deux cellules d'une même ligne est exactement
  `round(z₁·6,5/1000) − round(z₂·6,5/1000)` ; 1 000 m → 650 exactement).

## 12. Humidité (`climate.ts`)

- **[schéma de manuel]** Vents dominants de la circulation à trois cellules : alizés d'est
  (|φ| < 30°, cellule de Hadley), vents d'ouest (30–60°, cellule de Ferrel), vents d'est polaires
  (≥ 60°, cellule polaire) — bornes lues dans la page « The Three Cells in the Atmosphere »
  du cours en ligne de Penn State (courses.ems.psu.edu/meteo7). Ici, le vent est purement zonal (simplification).
- **[structure motivée physiquement, coefficients inventés]** Transport le long de chaque ligne
  dans le sens du vent, récurrence exacte en entiers. État de l'air : humidité m (0..`moistMax`),
  altitude a (cm). Entrée par le bord au vent : m = `moistMax` (air maritime saturé), a = 0.
  Pour chaque cellule c (z = `waterSurface[c]`) :
  - soulèvement u = max(0, z − a) ; a ← max(z, a − `airDescentCm`) ;
  - eau (océan, lac) : m ← m + ⌊(moistMax − m)·evap/65 536⌋ ; humidité = 255 ;
  - terre : f = min(65 536, rainBase + ⌊rainOro·u/100⌋) ; p = ⌊m·f/65 536⌋ ; m ← m − p ;
    humidité = min(255, ⌊255·p/pRef⌋), pRef = max(1, ⌊moistMax·rainBase/65 536⌋) (pluie d'une
    plaine côtière sous air saturé ↦ 255).
  La masse d'air ne redescend que de `airDescentCm` par cellule : une bosse plus basse que le
  relief déjà franchi ne redéclenche pas de pluie orographique (sans cela, chaque petite
  irrégularité de terrain vidait l'air : cartes rayées). Effets : décroissance vers
  l'intérieur, pluie au vent des montagnes, **ombre pluviométrique** derrière.
- Mélange méridien (dispersion latérale) : moyenne entière de l'humidité sur les lignes
  [y − r, y + r] (bornées), sur la terre seulement, r = round(`humidityMixRadiusRef`·H/512).
- Coefficients définis pour 512 cellules de côté et ramenés à la taille réelle :
  evap = round(`evapRef`·512/max(W,H)), rainBase = max(1, round(`rainBaseRef`·512/max(W,H))).
- **[paramètres inventés]** `moistMax` 10⁶, `evapRef` 3 000 (≈ 4,6 %/cellule), `rainBaseRef`
  450 (≈ 0,69 %/cellule), `rainOro` 30 (/65 536 par mètre de soulèvement), `airDescentCm` 2 000,
  `humidityMixRadiusRef` 3.
- **[décision]** Humidité statique : les saisons ne modulent que la température (§ 14).

## 13. Biomes (`src/core/world/biomes.ts`)

- **[inspiration publiée, seuils adaptés]** Diagramme de Whittaker (R. H. Whittaker,
  *Communities and Ecosystems*, 1970, révisé 1975 ; axes : température moyenne annuelle ×
  précipitations moyennes annuelles). Seuils ci-dessous = **simplification de jeu** (l'axe
  « humidité » est un indice relatif, pas des cm de pluie).
- **[valeur publiée]** Point de congélation de l'eau de mer ≈ −1,9 °C (NOAA Ocean Service,
  page oceanservice.noaa.gov/facts/oceanfreeze.html, lue dans une copie archivée :
  « seawater freezes at about -1.9 degrees Celsius ») → `seaIceMaxC` = −190.
- Classification totale (cascade, premier test vrai ; T en centièmes de °C, H 0..255) :

| ordre | condition | biome (id) |
|---|---|---|
| 1 | eau = océan, T ≤ −190 | banquise (1), sinon océan (0) |
| 2 | eau = lac | lac (2) |
| 3 | T < −1 000 | glace terrestre (3) |
| 4 | T < −200 | toundra (4) |
| 5 | H < 40 | désert (8) |
| 6 | T < 400 | taïga (5) |
| 7 | T < 2 000 | prairie/steppe tempérée (6) si H < 110, sinon forêt tempérée (7) |
| 8 | H < 100 | savane (9) |
| 9 | H < 180 | forêt tropicale sèche (10), sinon forêt tropicale humide (11) |

- Totalité testée par balayage (3 classes d'eau × T sur [−100, +100] °C au pas de 0,01 °C et
  tout l'intervalle i16 au pas de 97 × H 0..255). Critère (c) vérifié par une table de
  contraintes **indépendante** (tests/biomes.test.ts), pas par cette fonction.
- **[paramètres inventés]** tous les seuils sauf `seaIceMaxC`.

## 14. Saisons (`src/core/world/seasons.ts`)

- Calendrier dérivé du tick, sans état : année = `ticksPerYear` ticks (multiple de 8 ;
  **[paramètre inventé]** 7 200 = 4 min à 30 ticks/s), `yearAt = ⌊tick/Y⌋`,
  `seasonAt = ⌊4·(tick mod Y)/Y⌋` (0 printemps, 1 été, 2 automne, 3 hiver ; le tick 0 ouvre le
  printemps de l'année 0), 4 saisons de Y/4 ticks.
- Cycle : c(tick) = sinB(360·(tick mod Y)/Y − 45) (sinB = Bhāskara) : maximum au milieu de
  l'été, minimum au milieu de l'hiver. **[simplification]** Le décalage de 1/8 d'année (≈ 46 j)
  remplace le retard observé de 32 j sur l'ensoleillement (North et al. 1981).
- Température courante = `temperatureMean` + round(100·A(φ)·c(tick)), A(φ) = A1·sin φ :
  **[source publiée, dérivée]** terme P1(x) = x du développement de North et al. (1981) ;
  A1 = 15,5 °C = amplitude de T1(t) indiquée dans le texte, cohérente avec √(13,2² + 8,1²) =
  15,49 calculé à partir des coefficients A1 = −13,2 et B1 = −8,1 du tableau 1. Nulle à
  l'équateur, croissante avec la latitude.
- Aucune couche n'est recalculée à chaque tick ; aucun événement n'est émis (journal : T2).
- Moyenne du cycle sur une année : 0 à l'arrondi près (les ticks t et t + Y/2 donnent des
  valeurs opposées) ; testé |moyenne| < 10⁻¹² et moyenne de la température courante =
  moyenne stockée ± 0,5 centième.

## 15. Affichage (`src/render/`)

- `palette.ts` (pur, sans DOM) : une couleur RGB par biome (palette originale), rivières en
  surimpression (couleur distincte), tampon `Uint8ClampedArray` RGBA opaque de W·H·4 octets.
  Partagé par la page et `scripts/map-png.ts`.
- `main.ts` : génère sur le fil principal (page bloquée pendant ≈ 0,5–0,7 s mesurés), affiche la
  carte 512×512, la légende et une ligne d'état (graine, taille, temps mesuré côté rendu, hash).
  Graine : `?seed=<0..4294967295>`, défaut 20261111, valeur invalide → défaut + message.
