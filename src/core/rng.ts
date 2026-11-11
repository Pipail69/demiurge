/**
 * Générateur pseudo-aléatoire à graine du monde : xoshiro128** (Blackman & Vigna, 2018).
 *
 * - État : 4 × uint32 dans un Uint32Array(4), lisible et restaurable (instantanés futurs).
 * - Uniquement des opérations entières 32 bits (Math.imul, décalages, >>> 0) : la suite
 *   produite est identique au bit près sur tout moteur JavaScript conforme.
 * - Amorçage : graine uint32 → 4 sorties d'un SplitMix32 (voir docs/models.md).
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

/**
 * SplitMix32 : incrément par la constante du nombre d'or (0x9E3779B9), puis le
 * finaliseur « fmix32 » de MurmurHash3. Sert UNIQUEMENT à dériver l'état initial.
 * Renvoie l'état interne avancé et la sortie.
 */
function splitMix32(state: number): { state: number; out: number } {
  const next = (state + 0x9e3779b9) >>> 0;
  let z = next;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
  z = (z ^ (z >>> 16)) >>> 0;
  return { state: next, out: z };
}

export class Rng {
  /** État xoshiro128** : s[0..3]. Ne pas modifier directement ; utiliser setState. */
  readonly state: Uint32Array = new Uint32Array(4);

  constructor(seed: number) {
    assertU32(seed, 'La graine');
    let sm = seed;
    for (let i = 0; i < 4; i++) {
      const r = splitMix32(sm);
      sm = r.state;
      this.state[i] = r.out;
    }
    // Garde contre l'état tout-à-zéro (point fixe de xoshiro). fmix32 étant une
    // bijection et les 4 entrées distinctes, au plus une sortie peut valoir 0 :
    // cette branche est inatteignable en pratique, elle reste par sûreté.
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
