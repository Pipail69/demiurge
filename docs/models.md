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
