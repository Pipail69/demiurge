# Modèles des systèmes

Chaque section distingue :

- **[standard publié]** : algorithme ou norme publiés, repris tels quels ;
- **[choix d'ingénierie]** : décision de conception propre au projet ;
- **[paramètre inventé]** : valeur numérique choisie sans source de calibrage (à réévaluer).

Aucun système de jeu (terrain, agents, etc.) n'existe encore : T0 ne pose que les fondations.

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

### Amorçage

- Graine : entier uint32 (`[0, 2^32)`), sinon `RangeError`.
- **[choix d'ingénierie]** « SplitMix32 » : 4 sorties successives de
  ```
  x = (x + 0x9E3779B9) mod 2^32
  z = x;  z = (z ^ z>>>16) * 0x85EBCA6B;  z = (z ^ z>>>13) * 0xC2B2AE35;  z ^= z>>>16
  ```
  Les constantes sont celles du finaliseur `fmix32` de MurmurHash3 (A. Appleby) et de
  l'incrément « nombre d'or » de SplitMix64 (Steele, Lea & Flood 2014). Ce n'est PAS un
  standard publié en tant que tel : c'est l'adaptation 32 bits usuelle de l'amorçage
  recommandé par Vigna (qui utilise SplitMix64).
- Garde contre l'état tout-à-zéro (point fixe de xoshiro) : si les 4 mots valent 0, `s[0] := 1`.
  `fmix32` étant une bijection et les 4 entrées distinctes, au plus un mot peut être nul :
  la garde est inatteignable en pratique. `setState([0,0,0,0])` lève une erreur.

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

- **Vérification croisée, PAS vecteurs publiés** : je ne disposais pas de vecteurs de test
  publiés et vérifiables pour xoshiro128**. Le test contient une implémentation de référence
  indépendante en `BigInt`, transcrite directement de l'algorithme C ci-dessus, et compare
  5 000 tirages × 8 graines (dont 0 et 2^32−1) ainsi que l'état final. L'amorçage SplitMix32
  est vérifié de la même manière. Cela prouve la conformité à l'algorithme tel que transcrit,
  pas l'absence d'erreur de transcription commune aux deux versions.
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
  l'APPELANT (le cœur ne lit jamais d'horloge), exécute `floor(acc / stepMs)` ticks au plus
  `maxStepsPerAdvance`, et renvoie le nombre de ticks exécutés.
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
   `present = 0`. Assuré par la mise à zéro au retrait de composant et à la destruction
   d'entité. Ainsi deux histoires menant au même état logique ont le même hash.
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

### Format de sérialisation canonique (version 1)

Flux d'octets haché, suite de sections :

```
section := u32le(len(label)) · label(ASCII) · u64le(len(payload)) · payload
```

Les entiers d'en-tête sont écrits en petit-boutiste explicite (DataView). La longueur annoncée
est vérifiée contre la longueur écrite (erreur sinon). Ordre exact (hw = highWater, fc = freeCount) :

| # | étiquette | charge utile |
|---|-----------|--------------|
| 1 | `format` | u32 = 1 (version du format) |
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
