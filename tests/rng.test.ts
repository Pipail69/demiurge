import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng.ts';

/*
 * Vérification CROISÉE (et non vecteurs de test publiés) : implémentation de référence
 * indépendante en BigInt, transcrite directement de l'algorithme C de référence de
 * xoshiro128** (Blackman & Vigna) et de SplitMix32 tel que défini dans docs/models.md.
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

function refSplitMix32Seed(seed: number): bigint[] {
  let st = BigInt(seed);
  const out: bigint[] = [];
  for (let i = 0; i < 4; i++) {
    st = (st + 0x9e3779b9n) & M32;
    let z = st;
    z = ((z ^ (z >> 16n)) * 0x85ebca6bn) & M32;
    z = ((z ^ (z >> 13n)) * 0xc2b2ae35n) & M32;
    z = z ^ (z >> 16n);
    out.push(z);
  }
  return out;
}

describe('Rng (xoshiro128**)', () => {
  it('amorçage SplitMix32 identique à la référence BigInt, pour plusieurs graines', () => {
    for (const seed of [0, 1, 2, 42, 0x7fffffff, 0x80000000, 0xffffffff, 20261111]) {
      const rng = new Rng(seed);
      expect(Array.from(rng.getState()).map(BigInt)).toEqual(refSplitMix32Seed(seed));
    }
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
    expect(0xffffffff / 4294967296).toBeLessThan(1);
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
