/**
 * Bruit de gradient et fBm (docs/models.md § Bruit).
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng.ts';
import { fade, Fbm, GradientLattice, GRADIENT_X, GRADIENT_Y } from '../src/core/world/noise.ts';

describe('Polynôme d\'interpolation quintique', () => {
  it('s(0) = 0, s(1) = 1, s(1/2) = 1/2, monotone, dérivées 1re et 2e nulles aux bords (différences finies)', () => {
    expect(fade(0)).toBe(0);
    expect(fade(1)).toBe(1);
    expect(fade(0.5)).toBe(0.5);
    // Forme développée 6t⁵ − 15t⁴ + 10t³ (référence écrite à la main).
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      expect(fade(t)).toBeCloseTo(6 * t ** 5 - 15 * t ** 4 + 10 * t ** 3, 14);
      if (i > 0) expect(fade(t)).toBeGreaterThanOrEqual(fade((i - 1) / 100));
    }
    const h = 1e-4;
    expect((fade(h) - fade(0)) / h).toBeLessThan(1e-6);
    expect((fade(1) - fade(1 - h)) / h).toBeLessThan(1e-6);
    expect(Math.abs(fade(2 * h) - 2 * fade(h) + fade(0)) / (h * h)).toBeLessThan(1e-2);
  });
});

describe('Treillis de gradients', () => {
  it('8 directions fixes à composantes entières', () => {
    expect(GRADIENT_X).toEqual([1, -1, 0, 0, 1, 1, -1, -1]);
    expect(GRADIENT_Y).toEqual([0, 0, 1, -1, 1, -1, 1, -1]);
  });

  it('tirage : un nextU32 par nœud, 3 bits de poids fort, ligne par ligne (ordre figé)', () => {
    const rng = new Rng(42);
    const lat = GradientLattice.draw(rng, 5, 4);
    const ref = new Rng(42);
    const expected = Array.from({ length: 20 }, () => ref.nextU32() >>> 29);
    expect(Array.from(lat.codes)).toEqual(expected);
    expect(Array.from(rng.getState())).toEqual(Array.from(ref.getState())); // exactement 20 tirages
  });

  it('valeur nulle exactement sur tous les nœuds (propriété du bruit de gradient)', () => {
    const lat = GradientLattice.draw(new Rng(3), 9, 7);
    // === et non Object.is : −0 et +0 sont tous deux « nul » (le bruit n'est jamais stocké tel quel).
    for (let j = 0; j < 7; j++) for (let i = 0; i < 9; i++) expect(lat.sample(i, j) === 0, `${i},${j}`).toBe(true);
  });

  it('borne |n| ≤ 1 vérifiée sur 10⁶ échantillons, et atteinte (n = 1 construit à la main)', () => {
    // Démonstration : models.md § Bruit. Cas d'égalité : gradients pointant vers le centre.
    const peak = new GradientLattice(2, 2, Uint8Array.of(4, 6, 5, 7));
    expect(peak.sample(0.5, 0.5)).toBe(1);
    const lat = GradientLattice.draw(new Rng(11), 40, 40);
    const rng = new Rng(12);
    let maxAbs = 0;
    for (let k = 0; k < 1_000_000; k++) {
      const v = lat.sample(rng.nextFloat() * 39, rng.nextFloat() * 39);
      const a = Math.abs(v);
      if (a > maxAbs) maxAbs = a;
    }
    expect(maxAbs).toBeLessThanOrEqual(1);
    expect(maxAbs).toBeGreaterThan(0.7); // la borne n'est pas lâche au point d'être inutile
  });

  it('continuité : |n(x+h) − n(x)| ≤ 8,5·h (borne de Lipschitz démontrée), en x et en y', () => {
    const lat = GradientLattice.draw(new Rng(5), 20, 20);
    const h = 0.01;
    let worst = 0;
    for (let j = 0; j < 1800; j++) {
      for (let i = 0; i < 1800; i += 7) {
        const x = i * h;
        const y = j * h;
        const a = lat.sample(x, y);
        const dx = Math.abs(lat.sample(x + h, y) - a);
        const dy = Math.abs(lat.sample(x, y + h) - a);
        worst = Math.max(worst, dx, dy);
      }
    }
    expect(worst).toBeLessThanOrEqual(8.5 * h);
    console.log(`[bruit] plus grand écart entre voisins à h = ${h} : ${worst.toFixed(5)} (borne ${8.5 * h})`);
  });

  it('statistiques : moyenne proche de 0 (|moyenne| < 0,02 sur 64×64 cellules de treillis)', () => {
    // Tolérance : l'écart-type observé est ≈ 0,2 ; les échantillons d'une même cellule sont
    // corrélés, on compte ≈ 4 096 cellules indépendantes → erreur type ≈ 0,2/64 ≈ 0,003.
    for (const seed of [1, 2, 3]) {
      const lat = GradientLattice.draw(new Rng(seed), 65, 65);
      let sum = 0;
      let sum2 = 0;
      let n = 0;
      for (let j = 0; j < 256; j++) {
        for (let i = 0; i < 256; i++) {
          const v = lat.sample((i + 0.5) / 4, (j + 0.5) / 4);
          sum += v;
          sum2 += v * v;
          n++;
        }
      }
      const mean = sum / n;
      expect(Math.abs(mean), `graine ${seed}`).toBeLessThan(0.02);
      expect(Math.sqrt(sum2 / n - mean * mean)).toBeGreaterThan(0.1); // pas un bruit plat
    }
  });

  it('hors domaine → erreur', () => {
    const lat = GradientLattice.draw(new Rng(1), 3, 3);
    expect(() => lat.sample(-0.1, 0)).toThrow(RangeError);
    expect(() => GradientLattice.draw(new Rng(1), 1, 3)).toThrow(RangeError);
  });
});

describe('fBm', () => {
  it('déterminisme : même graine → mêmes valeurs ; graines différentes → valeurs différentes', () => {
    const a = new Fbm(new Rng(9), 64, 48, 3, 5);
    const b = new Fbm(new Rng(9), 64, 48, 3, 5);
    const c = new Fbm(new Rng(10), 64, 48, 3, 5);
    let diff = 0;
    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 64; x++) {
        expect(a.sampleCell(x, y)).toBe(b.sampleCell(x, y));
        if (a.sampleCell(x, y) !== c.sampleCell(x, y)) diff++;
      }
    }
    expect(diff).toBeGreaterThan(64 * 48 * 0.99);
  });

  it('octaves : fréquences ×2, amplitudes ×½ ; nombre de tirages = nombre de nœuds ; carte non carrée couverte', () => {
    const rng = new Rng(4);
    let draws = 0;
    const orig = rng.nextU32.bind(rng);
    rng.nextU32 = () => {
      draws++;
      return orig();
    };
    const f = new Fbm(rng, 100, 30, 3, 4);
    expect(f.frequencies).toEqual([3, 6, 12, 24]);
    expect(f.amplitudes).toEqual([1, 0.5, 0.25, 0.125]);
    // cols = ⌊100·freq/100⌋ + 2, rows = ⌊30·freq/100⌋ + 2
    expect(f.lattices.map((l) => [l.cols, l.rows])).toEqual([[5, 2], [8, 3], [14, 5], [26, 9]]);
    expect(f.draws).toBe(5 * 2 + 8 * 3 + 14 * 5 + 26 * 9);
    expect(draws).toBe(f.draws);
    // Coins de la carte : échantillonnables, valeurs dans [−1, 1].
    for (const [x, y] of [[0, 0], [99, 0], [0, 29], [99, 29]] as const) {
      const v = f.sampleCell(x, y);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
  });

  it('borne |fBm| ≤ 1 sur une carte 256×256', () => {
    const f = new Fbm(new Rng(77), 256, 256, 3, 7);
    let m = 0;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) m = Math.max(m, Math.abs(f.sampleCell(x, y)));
    expect(m).toBeLessThanOrEqual(1);
    expect(m).toBeGreaterThan(0.3);
  });
});
