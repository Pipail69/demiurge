/**
 * Bruit de gradient 2D sur treillis (famille « Perlin ») et somme d'octaves (fBm).
 * Modèle : docs/models.md § Bruit.
 *
 * - Gradients pris dans un ensemble FIXE de 8 directions à composantes entières
 *   (±1, 0), (0, ±1), (±1, ±1) : aucune trigonométrie.
 * - Interpolation par le polynôme quintique s(t) = 6t⁵ − 15t⁴ + 10t³ (Perlin 2002),
 *   écrit en multiplications.
 * - UN SEUL générateur : chaque gradient est TIRÉ de world.rng, un tirage nextU32 par nœud
 *   (3 bits de poids fort), dans un ordre figé : octave par octave, puis ligne par ligne
 *   (y croissant), puis x croissant. Pas de hachage de coordonnées.
 * - Arithmétique : + − × ÷ et Math.floor uniquement (résultats exacts au bit près, IEEE 754).
 *
 * Borne démontrée : |noise| ≤ 1 (voir models.md), |fBm| ≤ 1 (moyenne pondérée d'octaves).
 */

import type { Rng } from '../rng.ts';

/** Composantes des 8 gradients, index = code tiré (0..7). */
export const GRADIENT_X: readonly number[] = [1, -1, 0, 0, 1, 1, -1, -1];
export const GRADIENT_Y: readonly number[] = [0, 0, 1, -1, 1, -1, 1, -1];

/** Polynôme d'interpolation quintique de Perlin : 6t⁵ − 15t⁴ + 10t³ = t³(t(6t − 15) + 10). */
export function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Treillis de gradients de (cols × rows) nœuds, tirés du PRNG à la construction. */
export class GradientLattice {
  readonly cols: number;
  readonly rows: number;
  /** Code de gradient (0..7) par nœud, index = j·cols + i. */
  readonly codes: Uint8Array;

  constructor(cols: number, rows: number, codes: Uint8Array) {
    if (codes.length !== cols * rows) throw new Error('GradientLattice : taille des codes incohérente');
    this.cols = cols;
    this.rows = rows;
    this.codes = codes;
  }

  /** Tire cols × rows gradients : ligne par ligne (j croissant), puis i croissant. */
  static draw(rng: Rng, cols: number, rows: number): GradientLattice {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2) {
      throw new RangeError(`GradientLattice : dimensions invalides ${cols}×${rows}`);
    }
    const codes = new Uint8Array(cols * rows);
    for (let k = 0; k < codes.length; k++) codes[k] = rng.nextU32() >>> 29;
    return new GradientLattice(cols, rows, codes);
  }

  /**
   * Bruit au point (x, y) en unités de treillis, 0 ≤ x ≤ cols − 1, 0 ≤ y ≤ rows − 1.
   * Nul exactement sur les nœuds.
   */
  sample(x: number, y: number): number {
    let i = Math.floor(x);
    let j = Math.floor(y);
    if (i >= this.cols - 1) i = this.cols - 2; // bord droit : cellule précédente, fx = 1
    if (j >= this.rows - 1) j = this.rows - 2;
    if (i < 0 || j < 0) throw new RangeError(`GradientLattice.sample hors domaine (${x}, ${y})`);
    const fx = x - i;
    const fy = y - j;
    const c = this.codes;
    const k00 = j * this.cols + i;
    const g00 = c[k00]!;
    const g10 = c[k00 + 1]!;
    const g01 = c[k00 + this.cols]!;
    const g11 = c[k00 + this.cols + 1]!;
    const d00 = GRADIENT_X[g00]! * fx + GRADIENT_Y[g00]! * fy;
    const d10 = GRADIENT_X[g10]! * (fx - 1) + GRADIENT_Y[g10]! * fy;
    const d01 = GRADIENT_X[g01]! * fx + GRADIENT_Y[g01]! * (fy - 1);
    const d11 = GRADIENT_X[g11]! * (fx - 1) + GRADIENT_Y[g11]! * (fy - 1);
    const sx = fade(fx);
    const sy = fade(fy);
    const a = d00 + sx * (d10 - d00);
    const b = d01 + sx * (d11 - d01);
    return a + sy * (b - a);
  }
}

/**
 * Somme d'octaves (fBm) : lacunarité 2, gain 1/2, normalisée par la somme des amplitudes.
 * L'octave k a une fréquence baseCells·2^k cellules de treillis sur le plus grand côté de la
 * carte ; le treillis couvre toute la carte (non carrée comprise).
 */
export class Fbm {
  readonly lattices: GradientLattice[] = [];
  readonly frequencies: number[] = [];
  readonly amplitudes: number[] = [];
  /** Nombre de tirages nextU32 consommés à la construction (= nombre total de nœuds). */
  readonly draws: number;
  private readonly norm: number;
  private readonly maxDim: number;

  constructor(rng: Rng, width: number, height: number, baseCells: number, octaves: number) {
    if (!Number.isInteger(octaves) || octaves < 1 || octaves > 16) throw new RangeError(`Fbm : octaves invalide ${octaves}`);
    if (!Number.isInteger(baseCells) || baseCells < 1) throw new RangeError(`Fbm : baseCells invalide ${baseCells}`);
    this.maxDim = width > height ? width : height;
    let freq = baseCells;
    let amp = 1;
    let sum = 0;
    let draws = 0;
    for (let k = 0; k < octaves; k++) {
      // Coordonnée max en unités de treillis : (W − 0,5)·freq/maxDim < freq·W/maxDim → +2 nœuds.
      const cols = Math.floor((width * freq) / this.maxDim) + 2;
      const rows = Math.floor((height * freq) / this.maxDim) + 2;
      this.lattices.push(GradientLattice.draw(rng, cols, rows));
      draws += cols * rows;
      this.frequencies.push(freq);
      this.amplitudes.push(amp);
      sum += amp;
      freq *= 2;
      amp *= 0.5;
    }
    this.norm = sum;
    this.draws = draws;
  }

  /** Valeur au centre de la cellule (x, y) de la carte, dans [−1, 1]. */
  sampleCell(x: number, y: number): number {
    let v = 0;
    for (let k = 0; k < this.lattices.length; k++) {
      const f = this.frequencies[k]!;
      v += this.amplitudes[k]! * this.lattices[k]!.sample(((x + 0.5) * f) / this.maxDim, ((y + 0.5) * f) / this.maxDim);
    }
    return v / this.norm;
  }
}
