/**
 * File de priorité, océan, Priority-Flood + ε, D8, cumul, lacs, érosion (docs/models.md).
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng.ts';
import { CellHeap } from '../src/core/world/heap.ts';
import {
  accumulate, D8_DX, D8_DY, findLakes, findOcean, flowDirections, NO_FLOW, priorityFlood, receiverOf,
} from '../src/core/world/hydrology.ts';
import { erode } from '../src/core/world/erosion.ts';

/** Relief aléatoire entier (cm) avec bordure océanique ; quelques cuvettes sous le niveau de la mer. */
function randomDem(seed: number, w: number, h: number): Int32Array {
  const rng = new Rng(seed);
  const z = new Int32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      // Beaucoup d'égalités (multiples de 50) pour exercer le départage.
      z[y * w + x] = border ? -100 * rng.nextInt(3) : 50 * (rng.nextInt(40) - 4);
    }
  }
  return z;
}

function neighbours(c: number, w: number, h: number): number[] {
  const x = c % w;
  const y = (c - x) / w;
  const out: number[] = [];
  for (let k = 0; k < 8; k++) {
    const nx = x + D8_DX[k]!;
    const ny = y + D8_DY[k]!;
    if (nx >= 0 && ny >= 0 && nx < w && ny < h) out.push(ny * w + nx);
  }
  return out;
}

describe('CellHeap', () => {
  it('sort dans l\'ordre total (niveau, index), y compris avec de nombreuses égalités de niveau', () => {
    const rng = new Rng(1);
    const n = 5000;
    const cells = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = rng.nextInt(i + 1);
      [cells[i], cells[j]] = [cells[j]!, cells[i]!];
    }
    const level = (c: number): number => (c * 7919) % 13 - 6; // 13 niveaux seulement
    const heap = new CellHeap(n);
    for (const c of cells) heap.push(level(c), c);
    const popped: [number, number][] = [];
    while (heap.size > 0) {
      const c = heap.pop();
      expect(heap.lastLevel).toBe(level(c));
      popped.push([level(c), c]);
    }
    const expected = [...popped].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    expect(popped).toEqual(expected);
    expect(() => heap.pop()).toThrow(/vide/);
  });
});

describe('Océan', () => {
  it('cellules ≤ 0 reliées au bord (8-connexité) ; cuvette ≤ 0 isolée ≠ océan', () => {
    // 6×5 : bord à 0 ; cuvette intérieure à −5 entourée de terre (non reliée) ; canal diagonal.
    const W = 6;
    const z = Int32Array.from([
      0, 0, 0, 0, 0, 0,
      0, 9, 9, 9, -3, 0,
      0, 9, -5, 9, 9, 0,
      0, 9, 9, 9, 9, 0,
      0, 0, 0, 0, 0, 0,
    ]);
    const o = new Uint8Array(z.length);
    const n = findOcean(z, W, 5, o);
    expect(o[2 * W + 2]).toBe(0); // cuvette isolée
    expect(o[1 * W + 4]).toBe(1); // reliée au bord
    expect(n).toBe(18 + 1);
  });
});

describe('Priority-Flood + ε', () => {
  it('cas construit à la main : cuvette relevée à exutoire + ε, puis + ε par cellule', () => {
    const W = 6;
    const z = Int32Array.from([
      -1, -1, -1, -1, -1, -1,
      -1, 50, 50, 50, 50, -1,
      -1, 50, 10, 10, 50, -1,
      -1, 50, 10, 50, 30, -1,
      -1, 50, 50, 50, 50, -1,
      -1, -1, -1, -1, -1, -1,
    ]);
    const o = new Uint8Array(36);
    findOcean(z, W, 6, o);
    const { filled, count } = priorityFlood(z, o, W, 6, 1);
    expect(count).toBe(16);
    expect(filled[3 * W + 4]).toBe(30); // exutoire (col), voisin de l'océan
    expect(filled[2 * W + 3]).toBe(31); // atteint depuis l'exutoire (diagonale) : 30 + ε
    expect(filled[2 * W + 2]).toBe(32); // puis + ε
    expect(filled[3 * W + 2]).toBe(32);
    expect(filled[1 * W + 1]).toBe(50); // non relevée
    expect(filled[0]).toBe(0);
  });

  for (const seed of [1, 2, 3, 4]) {
    it(`relief aléatoire (graine ${seed}) : point fixe f = max(z, min voisins f + ε), ordre croissant, pente stricte`, () => {
      const W = 40;
      const H = 31;
      const z = randomDem(seed, W, H);
      const o = new Uint8Array(W * H);
      const oceanCount = findOcean(z, W, H, o);
      const eps = 1;
      const { filled, order, count } = priorityFlood(z, o, W, H, eps);
      expect(count).toBe(W * H - oceanCount);
      const rank = new Int32Array(W * H).fill(-1);
      for (let i = 0; i < count; i++) rank[order[i]!] = i;
      for (let c = 0; c < W * H; c++) {
        if (o[c] === 1) {
          expect(filled[c]).toBe(0);
          continue;
        }
        expect(rank[c]).toBeGreaterThanOrEqual(0);
        const nb = neighbours(c, W, H);
        const minN = Math.min(...nb.map((m) => filled[m]!));
        expect(filled[c]).toBe(Math.max(z[c]!, minN + eps));
        expect(filled[c]).toBeGreaterThanOrEqual(z[c]!);
        expect(minN).toBeLessThan(filled[c]!); // un voisin strictement plus bas
      }
      for (let i = 1; i < count; i++) expect(filled[order[i]!]).toBeGreaterThanOrEqual(filled[order[i - 1]!]!);
    });
  }

  it('sans océan → erreur explicite', () => {
    const z = new Int32Array(9).fill(5);
    const o = new Uint8Array(9);
    findOcean(z, 3, 3, o);
    expect(() => priorityFlood(z, o, 3, 3, 1)).toThrow(/océan/);
  });
});

describe('Écoulement D8 et cumul', () => {
  it('plus grande pente exacte : diagonale de baisse 14 battue par orthogonale de baisse 10 (14/√2 ≈ 9,9 < 10)', () => {
    const W = 3;
    const s = Int32Array.from([100, 100, 100, 100, 100, 90, 100, 100, 86]);
    const o = Uint8Array.from([1, 1, 1, 1, 0, 1, 1, 1, 1]); // seul le centre est de la terre
    const f = new Uint8Array(9);
    flowDirections(s, o, W, 3, f);
    expect(f[4]).toBe(0); // E (baisse 10), et non SE (baisse 14)
    s[8] = 85; // baisse 15 : 15/√2 ≈ 10,6 > 10 → SE
    flowDirections(s, o, W, 3, f);
    expect(f[4]).toBe(1);
  });

  it('égalités : premier voisin dans l\'ordre E, SE, S, SO, O, NO, N, NE', () => {
    const s = new Int32Array(9).fill(10);
    s[4] = 20;
    const f = new Uint8Array(9);
    // Toutes les orthogonales baissent de 10 (score 200) et toutes les diagonales aussi (score 100).
    expect(() => flowDirections(s, new Uint8Array(9), 3, 3, f)).toThrow(/sans voisin/); // les bords n'ont pas d'aval
    const o = Uint8Array.from([1, 1, 1, 1, 0, 1, 1, 1, 1]);
    flowDirections(s, o, 3, 3, f);
    expect(f[4]).toBe(0);
    expect(f[0]).toBe(NO_FLOW);
    s[5] = 15; // E ne baisse plus que de 5 → S (code 2) est le premier orthogonal à baisse 10
    flowDirections(s, o, 3, 3, f);
    expect(f[4]).toBe(2);
  });

  it('cumul : chaîne amont → aval, entiers exacts', () => {
    // Ligne 5×1 conceptuelle dans une grille 5×3 : cellules (1..3, 1) s'écoulent vers l'ouest.
    const W = 5;
    const z = Int32Array.from([
      0, 0, 0, 0, 0,
      0, 10, 20, 30, 0,
      0, 0, 0, 0, 0,
    ]);
    const o = new Uint8Array(15);
    findOcean(z, W, 3, o);
    const { filled, order, count } = priorityFlood(z, o, W, 3, 1);
    const f = new Uint8Array(15);
    flowDirections(filled, o, W, 3, f);
    const local = new Uint32Array(15).fill(0);
    local[6] = 1;
    local[7] = 2;
    local[8] = 4;
    const out = new Uint32Array(15);
    accumulate(order, count, f, W, local, out);
    // Chaque cellule s'écoule vers l'océan voisin le plus raide (bord nord ou sud) : vérifier
    // seulement la conservation : Σ apports = Σ débits reçus par l'océan.
    let oceanSum = 0;
    for (let c = 0; c < 15; c++) if (o[c] === 1) oceanSum += out[c]!;
    expect(oceanSum).toBe(7);
    for (let c = 6; c <= 8; c++) {
      const r = receiverOf(c, f[c]!, W);
      expect(filled[r]).toBeLessThan(filled[c]!);
    }
  });
});

describe('Lacs', () => {
  it('profondeur ≥ minDepth et composante ≥ minCells', () => {
    const W = 8;
    const z = Int32Array.from([
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 90, 90, 90, 90, 90, 90, 0,
      0, 90, 10, 10, 90, 90, 90, 0,
      0, 90, 10, 10, 90, 50, 90, 0,
      0, 90, 90, 90, 90, 90, 90, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const o = new Uint8Array(z.length);
    findOcean(z, W, 6, o);
    const { filled } = priorityFlood(z, o, W, 6, 1);
    const lake = new Uint8Array(z.length);
    // Cuvette de 4 cellules (profondeur 81 ou 82) ; cuvette d'une cellule en (5,3) : profondeur 41.
    expect(filled[3 * W + 5]! - z[3 * W + 5]!).toBe(41);
    expect(findLakes(z, filled, o, W, 6, 50, 4, lake)).toBe(4);
    expect(lake[2 * W + 2]).toBe(1);
    expect(lake[3 * W + 5]).toBe(0);
    expect(findLakes(z, filled, o, W, 6, 50, 5, lake)).toBe(0); // composante trop petite
    expect(findLakes(z, filled, o, W, 6, 30, 1, lake)).toBe(5); // seuils abaissés : la cuvette isolée compte
    expect(lake[3 * W + 5]).toBe(1);
  });
});

describe('Érosion', () => {
  for (const seed of [5, 6]) {
    it(`graine ${seed} : bilan exact, jamais de relèvement, océan intact, terre émergée, déterministe`, () => {
      const W = 48;
      const H = 40;
      const z0 = randomDem(seed, W, H);
      const z = z0.slice();
      const { eroded } = erode(z, W, H, 6, 0.05, 1);
      const z2 = z0.slice();
      expect(erode(z2, W, H, 6, 0.05, 1).eroded).toBe(eroded);
      expect(Array.from(z2)).toEqual(Array.from(z));
      let before = 0;
      let after = 0;
      for (let c = 0; c < z.length; c++) {
        before += z0[c]!;
        after += z[c]!;
        expect(z[c]).toBeLessThanOrEqual(z0[c]!);
        if (z0[c]! <= 0) expect(z[c]).toBe(z0[c]!);
        if (z0[c]! > 0) expect(z[c]).toBeGreaterThanOrEqual(1);
      }
      expect(eroded).toBeGreaterThan(0);
      expect(before - after).toBe(eroded);
    });
  }

  it('aucune cellule érodée ne passe sous sa cellule aval (surface comblée) : pas de fosse créée', () => {
    const W = 48;
    const H = 40;
    const z = randomDem(9, W, H);
    // Une seule itération : on recalcule l'état de la passe pour vérifier la borne.
    const o = new Uint8Array(W * H);
    findOcean(z, W, H, o);
    const { filled } = priorityFlood(z, o, W, H, 1);
    const f = new Uint8Array(W * H);
    flowDirections(filled, o, W, H, f);
    const before = z.slice();
    erode(z, W, H, 1, 10, 1); // K énorme : la borne est active partout
    for (let c = 0; c < W * H; c++) {
      if (o[c] === 1 || before[c] !== filled[c]) continue;
      const r = receiverOf(c, f[c]!, W);
      const surfR = o[r] === 1 ? 0 : before[r] === filled[r] ? z[r]! : filled[r]!;
      expect(z[c], `cellule ${c}`).toBeGreaterThan(surfR);
    }
  });

  it('K = 0 ou 0 itération : relief inchangé', () => {
    const z = randomDem(2, 30, 30);
    const a = z.slice();
    expect(erode(a, 30, 30, 5, 0, 1).eroded).toBe(0);
    expect(Array.from(a)).toEqual(Array.from(z));
    expect(erode(a, 30, 30, 0, 1, 1).eroded).toBe(0);
  });
});
