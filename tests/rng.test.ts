import { describe, expect, it } from 'vitest';
import { Rng, splitMix64Next } from '../src/core/rng.ts';
import { World } from '../src/core/ecs/world.ts';

/*
 * Deux niveaux de vérification (voir docs/models.md § 1) :
 *  1. vecteurs PUBLIÉS : SplitMix64 (Rosetta Code, crate rand_xoshiro) et xoshiro128**
 *     (test `reference` de rand_xoshiro 0.8.1) ;
 *  2. vérification CROISÉE contre une implémentation BigInt indépendante, transcrite de
 *     l'algorithme C de référence (5 000 tirages × 8 graines).
 */
const M32 = 0xffffffffn;
const rotlBig = (x: bigint, k: bigint): bigint => ((x << k) | (x >> (32n - k))) & M32;

class RefXoshiro128ss {
  s: bigint[];
  constructor(state: readonly bigint[]) {
    this.s = [...state];
  }
  next(): bigint {
    const s = this.s as [bigint, bigint, bigint, bigint];
    const result = (rotlBig((s[1] * 5n) & M32, 7n) * 9n) & M32;
    const t = (s[1] << 9n) & M32;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotlBig(s[3], 11n);
    return result;
  }
}

/** Amorçage de référence : 2 sorties SplitMix64 → [bas(z1), haut(z1), bas(z2), haut(z2)]. */
function refSplitMix64Seed(seed: number): bigint[] {
  const M64 = (1n << 64n) - 1n;
  let st = BigInt(seed);
  const out: bigint[] = [];
  for (let i = 0; i < 2; i++) {
    st = (st + 0x9e3779b97f4a7c15n) & M64;
    let z = st;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & M64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & M64;
    z = z ^ (z >> 31n);
    out.push(z & M32, z >> 32n);
  }
  return out;
}

/** Ancien amorçage « SplitMix32 » (avant relecture), conservé pour le contrôle négatif. */
function oldSplitMix32Seed(seed: number): number[] {
  let st = seed >>> 0;
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    st = (st + 0x9e3779b9) >>> 0;
    let z = st;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    out.push((z ^ (z >>> 16)) >>> 0);
  }
  return out;
}

/** Paires (graine A, graine B) dont les états partagent un mot à une position décalée. */
function shiftedOverlaps(seeds: readonly number[], seedFn: (s: number) => ArrayLike<number>): string[] {
  const where = new Map<number, Array<[number, number]>>(); // mot → [(graine, position)]
  const found: string[] = [];
  for (const s of seeds) {
    const st = seedFn(s);
    for (let p = 0; p < 4; p++) {
      const w = st[p]!;
      for (const [s2, p2] of where.get(w) ?? []) if (s2 !== s && p2 !== p) found.push(`${s2}[${p2}]=${s}[${p}]`);
      const list = where.get(w) ?? [];
      list.push([s, p]);
      where.set(w, list);
    }
  }
  return found;
}

/** État xoshiro128** dont le prochain nextU32() vaut exactement `target` (inversion du brouilleur). */
function stateProducing(target: number): number[] {
  const inv9 = 0x38e38e39n; // 9 × 0x38E38E39 ≡ 1 (mod 2^32)
  const inv5 = 0xcccccccdn; // 5 × 0xCCCCCCCD ≡ 1 (mod 2^32)
  const x = (BigInt(target) * inv9) & M32; // = rotl(s1*5, 7)
  const y = ((x >> 7n) | (x << 25n)) & M32; // rotr 7 → s1*5
  const s1 = (y * inv5) & M32;
  return [1, Number(s1), 0, 0];
}

describe('Rng (xoshiro128**)', () => {
  it('SplitMix64 : vecteurs publiés (Rosetta Code, graine 1234567 ; rand_xoshiro, graine 1477776061723855037)', () => {
    const run = (seed: bigint, n: number): bigint[] => {
      const out: bigint[] = [];
      let st = seed;
      for (let i = 0; i < n; i++) {
        const r = splitMix64Next(st);
        st = r.state;
        out.push(r.out);
      }
      return out;
    };
    expect(run(1234567n, 5)).toEqual([
      6457827717110365317n, 3203168211198807973n, 9817491932198370423n, 4593380528125082431n, 16408922859458223821n,
    ]);
    expect(run(1477776061723855037n, 5)).toEqual([
      1985237415132408290n, 2979275885539914483n, 13511426838097143398n, 8488337342461049707n, 15141737807933549159n,
    ]);
  });

  it('xoshiro128** : vecteur publié (rand_xoshiro 0.8.1, test `reference`), état [1,2,3,4]', () => {
    const rng = new Rng(1);
    rng.setState([1, 2, 3, 4]);
    const got = Array.from({ length: 10 }, () => rng.nextU32());
    expect(got).toEqual([11520, 0, 5927040, 70819200, 2031721883, 1637235492, 1287239034, 3734860849, 3729100597, 4258142804]);
  });

  it('amorçage = 2 sorties SplitMix64 en mots petit-boutistes ; valeurs épinglées (C de référence compilé)', () => {
    for (const seed of [0, 1, 2, 42, 0x7fffffff, 0x80000000, 0xffffffff, 20261111]) {
      expect(Array.from(new Rng(seed).getState()).map(BigInt)).toEqual(refSplitMix64Seed(seed));
    }
    // Valeurs produites par splitmix64.c compilé avec gcc (graine → [bas(z1), haut(z1), bas(z2), haut(z2)]).
    expect(Array.from(new Rng(0).getState())).toEqual([2065550767, 3793791033, 2713282036, 1853398634]);
    expect(Array.from(new Rng(20261111).getState())).toEqual([2804312971, 4227617026, 1894127723, 1294573315]);
    expect(Array.from(new Rng(0xffffffff).getState())).toEqual([2951840192, 1940994978, 323015604, 1629504261]);
  });

  it('World(seed).rng a exactement l\'état de new Rng(seed)', () => {
    for (const seed of [0, 1, 20261111, 20261112, 0xffffffff]) {
      expect(Array.from(new World(seed).rng.getState())).toEqual(Array.from(new Rng(seed).getState()));
    }
    expect(Array.from(new World(5).rng.getState())).not.toEqual(Array.from(new World(6).rng.getState()));
  });

  it('non-recouvrement : aucun mot d\'état partagé à position décalée entre graines voisines', () => {
    const G = 0x9e3779b9;
    const seeds: number[] = [];
    for (let s = 0; s < 200; s++) seeds.push(s); // graines consécutives
    for (const s of [1, 42, 20261111, 0x80000000]) seeds.push((s + G) >>> 0, (s + 2 * G) >>> 0); // s, s+φ, s+2φ
    for (let k = 0; k < 50; k++) seeds.push((0xffffffff - k) >>> 0);
    const unique = [...new Set(seeds)];
    expect(shiftedOverlaps(unique, (s) => new Rng(s).getState())).toEqual([]);
    // Contrôle négatif : l'ancien amorçage SplitMix32 recouvre bien s et s+0x9E3779B9.
    expect(shiftedOverlaps([42, (42 + G) >>> 0], oldSplitMix32Seed).length).toBe(3);
  });

  it('suite identique à la référence BigInt sur 5 000 tirages × 8 graines', () => {
    for (const seed of [0, 1, 2, 42, 0x7fffffff, 0x80000000, 0xffffffff, 20261111]) {
      const rng = new Rng(seed);
      const ref = new RefXoshiro128ss(Array.from(rng.getState()).map(BigInt));
      for (let i = 0; i < 5000; i++) {
        const got = rng.nextU32();
        const want = ref.next();
        if (BigInt(got) !== want) throw new Error(`graine ${seed}, tirage ${i} : ${got} ≠ ${want}`);
      }
      // État final identique également.
      expect(Array.from(rng.getState()).map(BigInt)).toEqual(ref.s);
    }
  });

  it('même graine → même suite ; graines différentes → suites différentes', () => {
    const a = new Rng(123);
    const b = new Rng(123);
    const c = new Rng(124);
    const sa: number[] = [];
    const sb: number[] = [];
    const sc: number[] = [];
    for (let i = 0; i < 1000; i++) {
      sa.push(a.nextU32());
      sb.push(b.nextU32());
      sc.push(c.nextU32());
    }
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
    // Pas seulement « différentes quelque part » : quasiment aucune coïncidence position à position.
    expect(sa.filter((v, i) => v === sc[i]).length).toBeLessThan(3);
  });

  it('nextU32 renvoie des entiers dans [0, 2^32)', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 10000; i++) {
      const v = rng.nextU32();
      expect(Number.isInteger(v) && v >= 0 && v <= 0xffffffff).toBe(true);
    }
  });

  it('nextFloat ∈ [0, 1) et la borne haute théorique est < 1', () => {
    const rng = new Rng(99);
    for (let i = 0; i < 100000; i++) {
      const f = rng.nextFloat();
      if (!(f >= 0 && f < 1)) throw new Error(`hors [0,1) : ${f}`);
    }
  });

  it('nextFloat aux extrêmes : u32 = 0 → 0 ; u32 = 2^32−1 → (2^32−1)/2^32 < 1 exactement', () => {
    const rng = new Rng(1);
    rng.setState(stateProducing(0));
    expect(rng.nextFloat()).toBe(0);
    rng.setState(stateProducing(0xffffffff));
    const f = rng.nextFloat();
    expect(f).toBe(0.99999999976716935634613037109375); // = 1 − 2^−32, exact en double
    expect(f).toBeLessThan(1);
  });

  it('nextInt accepte un tirage égal au seuil de rejet (r = 2^32 mod n) sans le rejeter', () => {
    const rng = new Rng(1);
    // n = 3 : seuil = 2^32 mod 3 = 1. r = 1 doit être accepté → 1 % 3 = 1, un seul tirage consommé.
    const st = stateProducing(1);
    rng.setState(st);
    expect(rng.nextInt(3)).toBe(1);
    const afterOne = new Rng(1);
    afterOne.setState(st);
    afterOne.nextU32();
    expect(Array.from(rng.getState())).toEqual(Array.from(afterOne.getState()));
    // r = 0 < seuil doit être rejeté.
    rng.setState(stateProducing(0));
    const ref = new Rng(1);
    ref.setState(stateProducing(0));
    ref.nextU32();
    const second = ref.nextU32();
    expect(rng.nextInt(3)).toBe(second >= 1 ? second % 3 : -1);
  });

  it('nextInt reste dans les bornes et accepte les cas limites', () => {
    const rng = new Rng(5);
    for (const n of [1, 2, 3, 7, 10, 1000, 2 ** 31 + 1, 3 * 2 ** 30, 2 ** 32]) {
      for (let i = 0; i < 2000; i++) {
        const v = rng.nextInt(n);
        if (!(Number.isInteger(v) && v >= 0 && v < n)) throw new Error(`nextInt(${n}) = ${v}`);
      }
    }
    expect(rng.nextInt(1)).toBe(0);
  });

  it('nextInt rejette les entrées invalides', () => {
    const rng = new Rng(5);
    for (const n of [0, -1, 1.5, NaN, Infinity, 2 ** 32 + 1]) {
      expect(() => rng.nextInt(n)).toThrow(RangeError);
    }
  });

  // Seuil : quantile 0,999 du chi-deux. ddl 9 → 27,877 ; ddl 2 → 13,816.
  // Graine fixe : le test est déterministe (pas d'instabilité possible).
  it('uniformité grossière de nextInt(10) : chi-deux < 27,877 (ddl 9, p = 0,001) sur 100 000 tirages', () => {
    const rng = new Rng(2024);
    const N = 100000;
    const counts = new Array<number>(10).fill(0);
    for (let i = 0; i < N; i++) counts[rng.nextInt(10)]!++;
    const expected = N / 10;
    const chi2 = counts.reduce((acc, c) => acc + (c - expected) ** 2 / expected, 0);
    expect(chi2).toBeLessThan(27.877);
  });

  it('pas de biais modulo : nextInt(3·2^30) uniforme sur 3 tiers (un modulo naïf donnerait 1/2, 1/4, 1/4)', () => {
    const rng = new Rng(77);
    const n = 3 * 2 ** 30;
    const N = 60000;
    const counts = [0, 0, 0];
    for (let i = 0; i < N; i++) counts[Math.floor(rng.nextInt(n) / 2 ** 30)]!++;
    const expected = N / 3;
    const chi2 = counts.reduce((acc, c) => acc + (c - expected) ** 2 / expected, 0);
    expect(chi2).toBeLessThan(13.816);
    // Contrôle : la même statistique sur un modulo naïf échoue bien.
    const naive = new Rng(77);
    const nc = [0, 0, 0];
    for (let i = 0; i < N; i++) nc[Math.floor((naive.nextU32() % n) / 2 ** 30)]!++;
    const naiveChi2 = nc.reduce((acc, c) => acc + (c - expected) ** 2 / expected, 0);
    expect(naiveChi2).toBeGreaterThan(13.816);
  });

  it('aller-retour getState/setState reproduit la suite', () => {
    const rng = new Rng(31337);
    for (let i = 0; i < 100; i++) rng.nextU32();
    const saved = rng.getState();
    const first = Array.from({ length: 500 }, () => rng.nextU32());
    rng.setState(saved);
    const again = Array.from({ length: 500 }, () => rng.nextU32());
    expect(again).toEqual(first);
    // getState renvoie une copie : la modifier n'affecte pas le générateur.
    const copy = rng.getState();
    copy[0] = copy[0]! ^ 1;
    expect(rng.getState()).not.toEqual(copy);
    // Restauration dans un AUTRE générateur.
    const other = new Rng(1);
    other.setState(saved);
    expect(Array.from({ length: 500 }, () => other.nextU32())).toEqual(first);
  });

  it('setState refuse l\'état tout-à-zéro et les mots invalides ; la graine doit être uint32', () => {
    const rng = new Rng(1);
    expect(() => rng.setState([0, 0, 0, 0])).toThrow(/tout-à-zéro/);
    expect(() => rng.setState([1, 2, 3])).toThrow(RangeError);
    expect(() => rng.setState([1, 2, 3, 2 ** 32])).toThrow(RangeError);
    expect(() => rng.setState([1, 2, 3, -1])).toThrow(RangeError);
    for (const seed of [-1, 1.5, 2 ** 32, NaN]) expect(() => new Rng(seed)).toThrow(RangeError);
  });
});
