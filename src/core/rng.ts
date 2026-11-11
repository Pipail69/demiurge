/**
 * Générateur pseudo-aléatoire à graine du monde : xoshiro128** (Blackman & Vigna, 2018).
 *
 * - État : 4 × uint32 dans un Uint32Array(4), lisible et restaurable (instantanés futurs).
 * - Uniquement des opérations entières 32 bits (Math.imul, décalages, >>> 0) : la suite
 *   produite est identique au bit près sur tout moteur JavaScript conforme.
 * - Amorçage : graine uint32 → 2 sorties de SplitMix64 (recommandation publiée de
 *   Blackman & Vigna ; voir docs/models.md).
 *
 * Règle du projet : UN SEUL générateur par monde, possédé par le monde. Aucun sous-flux.
 */

const TWO_POW_32 = 4294967296;

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** Vérifie qu'une valeur est un entier dans [0, 2^32). */
function assertU32(value: number, what: string): void {
  if (!Number.isInteger(value) || value < 0 || value >= TWO_POW_32) {
    throw new RangeError(`${what} doit être un entier dans [0, 2^32), reçu ${String(value)}`);
  }
}

const MASK_64 = 0xffffffffffffffffn;

/**
 * SplitMix64 (G. Steele, D. Lea, C. Flood 2014 ; code C de référence de S. Vigna,
 * splitmix64.c) : générateur recommandé par Blackman & Vigna pour amorcer xoshiro.
 * Sert UNIQUEMENT à dériver l'état initial (une fois par monde). BigInt : arithmétique
 * 64 bits exacte, déterministe sur tout moteur.
 * Renvoie l'état avancé et la sortie (uint64).
 */
export function splitMix64Next(state: bigint): { state: bigint; out: bigint } {
  const next = (state + 0x9e3779b97f4a7c15n) & MASK_64;
  let z = next;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK_64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK_64;
  z = z ^ (z >> 31n);
  return { state: next, out: z };
}

export class Rng {
  /** État xoshiro128** : s[0..3]. Ne pas modifier directement ; utiliser setState. */
  readonly state: Uint32Array = new Uint32Array(4);

  constructor(seed: number) {
    assertU32(seed, 'La graine');
    // État SplitMix64 = graine (uint32 étendue à 64 bits) ; deux sorties z1, z2.
    // Convention de seed_from_u64 (rand_xoshiro / rand_core) : octets petit-boutistes,
    // donc s = [bas32(z1), haut32(z1), bas32(z2), haut32(z2)].
    const r1 = splitMix64Next(BigInt(seed));
    const r2 = splitMix64Next(r1.state);
    this.state[0] = Number(r1.out & 0xffffffffn);
    this.state[1] = Number(r1.out >> 32n);
    this.state[2] = Number(r2.out & 0xffffffffn);
    this.state[3] = Number(r2.out >> 32n);
    // Garde contre l'état tout-à-zéro (point fixe de xoshiro). La sortie de SplitMix64 est
    // une bijection de son état et les deux états sont distincts : au plus une des deux
    // sorties peut être nulle, la branche est inatteignable ; elle reste par sûreté.
    if ((this.state[0]! | this.state[1]! | this.state[2]! | this.state[3]!) === 0) {
      this.state[0] = 1;
    }
  }

  /** Prochain entier uniforme dans [0, 2^32). */
  nextU32(): number {
    const s = this.state;
    let s0 = s[0]!;
    let s1 = s[1]!;
    let s2 = s[2]!;
    let s3 = s[3]!;
    const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0;
    s3 = rotl(s3, 11);
    s[0] = s0;
    s[1] = s1;
    s[2] = s2;
    s[3] = s3;
    return result;
  }

  /** Flottant uniforme dans [0, 1) : u32 / 2^32 (division exacte en IEEE 754 double). */
  nextFloat(): number {
    return this.nextU32() / TWO_POW_32;
  }

  /**
   * Entier uniforme dans [0, n), sans biais modulo : on rejette les tirages
   * r < (2^32 mod n), de sorte que le nombre de valeurs acceptées est un multiple de n.
   * n doit être un entier dans [1, 2^32].
   */
  nextInt(n: number): number {
    if (!Number.isInteger(n) || n < 1 || n > TWO_POW_32) {
      throw new RangeError(`nextInt : n doit être un entier dans [1, 2^32], reçu ${String(n)}`);
    }
    const threshold = TWO_POW_32 % n; // exact : entiers < 2^53
    for (;;) {
      const r = this.nextU32();
      if (r >= threshold) return r % n;
    }
  }

  /** Copie de l'état courant. */
  getState(): Uint32Array {
    return this.state.slice();
  }

  /** Restaure un état (4 × uint32, non tout-à-zéro). */
  setState(newState: ArrayLike<number>): void {
    if (newState.length !== 4) {
      throw new RangeError(`setState : 4 mots attendus, reçu ${newState.length}`);
    }
    let any = 0;
    for (let i = 0; i < 4; i++) {
      const w = newState[i]!;
      assertU32(w, `setState : mot ${i}`);
      any |= w;
    }
    if (any === 0) throw new RangeError('setState : état tout-à-zéro interdit (point fixe de xoshiro128**)');
    for (let i = 0; i < 4; i++) this.state[i] = newState[i]!;
  }
}
