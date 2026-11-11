/**
 * Hydrologie : océan, comblement des dépressions (Priority-Flood + ε), lacs, écoulement D8,
 * débit cumulé. Modèle : docs/models.md § Hydrologie.
 *
 * Toutes les grandeurs sont entières (cm, nombres de cellules, unités d'apport) : les
 * comparaisons sont exactes et le bilan de masse se vérifie à l'unité près.
 */

import { CellHeap } from './heap.ts';

/**
 * Directions D8, code 0..7, dans l'ORDRE FIXE de départage des égalités :
 * 0 E, 1 SE, 2 S, 3 SO, 4 O, 5 NO, 6 N, 7 NE (y croît vers le bas, nord en haut).
 */
export const D8_DX: readonly number[] = [1, 1, 0, -1, -1, -1, 0, 1];
export const D8_DY: readonly number[] = [0, 1, 1, 1, 0, -1, -1, -1];
/** Code « pas d'aval » (cellules d'océan). */
export const NO_FLOW = 255;

/** Classes d'eau de la couche `water`. */
export const LAND = 0;
export const OCEAN = 1;
export const LAKE = 2;

/** Vrai si (x, y) est sur le pourtour de la carte. */
export function isBorder(x: number, y: number, width: number, height: number): boolean {
  return x === 0 || y === 0 || x === width - 1 || y === height - 1;
}

/**
 * Océan = cellules d'altitude ≤ 0 reliées au pourtour par des cellules ≤ 0 (8-connexité).
 * Remplit isOcean (0/1) et renvoie le nombre de cellules d'océan. Parcours en largeur
 * amorcé par les cellules de bordure ≤ 0 dans l'ordre croissant des index.
 */
export function findOcean(elevation: Int32Array, width: number, height: number, isOcean: Uint8Array): number {
  const n = width * height;
  isOcean.fill(0);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let c = 0; c < n; c++) {
    const x = c % width;
    const y = (c - x) / width;
    if (isBorder(x, y, width, height) && elevation[c]! <= 0) {
      isOcean[c] = 1;
      queue[tail++] = c;
    }
  }
  while (head < tail) {
    const c = queue[head++]!;
    const x = c % width;
    const y = (c - x) / width;
    for (let k = 0; k < 8; k++) {
      const nx = x + D8_DX[k]!;
      const ny = y + D8_DY[k]!;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const m = ny * width + nx;
      if (isOcean[m] === 0 && elevation[m]! <= 0) {
        isOcean[m] = 1;
        queue[tail++] = m;
      }
    }
  }
  return tail;
}

export interface FloodResult {
  /**
   * Surface comblée : 0 pour l'océan (surface de la mer), sinon
   * filled[n] = max(elevation[n], filled[parent] + epsilon).
   */
  filled: Int32Array;
  /** Cellules non océaniques dans l'ordre de sortie de la file (aval avant amont). */
  order: Int32Array;
  /** Nombre de cellules non océaniques (= longueur utile de order). */
  count: number;
}

/**
 * Priority-Flood + ε (Barnes, Lehman & Mulla 2014, algorithme 3, avec ε entier fixe au lieu
 * de NextAfter). File amorcée par les cellules d'océan voisines d'une cellule non océanique,
 * au niveau 0 (surface de la mer). Clé de la file : (niveau, index) — ordre total.
 * Propriété : toute cellule non océanique a un voisin de surface comblée strictement
 * inférieure (son parent), et les niveaux sortent dans l'ordre croissant.
 */
export function priorityFlood(
  elevation: Int32Array,
  isOcean: Uint8Array,
  width: number,
  height: number,
  epsilon: number,
): FloodResult {
  const n = width * height;
  const filled = new Int32Array(n);
  const visited = new Uint8Array(n);
  const order = new Int32Array(n);
  const heap = new CellHeap(n);
  let oceanCount = 0;
  for (let c = 0; c < n; c++) {
    if (isOcean[c] !== 1) continue;
    oceanCount++;
    visited[c] = 1;
    filled[c] = 0;
    const x = c % width;
    const y = (c - x) / width;
    for (let k = 0; k < 8; k++) {
      const nx = x + D8_DX[k]!;
      const ny = y + D8_DY[k]!;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (isOcean[ny * width + nx] !== 1) {
        heap.push(0, c);
        break;
      }
    }
  }
  if (oceanCount === 0) throw new Error('priorityFlood : aucune cellule d\'océan (le pourtour doit être de l\'océan)');
  let count = 0;
  while (heap.size > 0) {
    const c = heap.pop();
    const level = heap.lastLevel;
    if (isOcean[c] !== 1) order[count++] = c;
    const x = c % width;
    const y = (c - x) / width;
    for (let k = 0; k < 8; k++) {
      const nx = x + D8_DX[k]!;
      const ny = y + D8_DY[k]!;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const m = ny * width + nx;
      if (visited[m] === 1) continue;
      visited[m] = 1;
      const e = elevation[m]!;
      const raised = level + epsilon;
      const f = e > raised ? e : raised;
      filled[m] = f;
      heap.push(f, m);
    }
  }
  if (count !== n - oceanCount) throw new Error('priorityFlood : cellules non atteintes');
  return { filled, order, count };
}

/**
 * Direction D8 de plus grande pente sur `surface`, pour chaque cellule non océanique.
 * Pente = baisse / distance (1 ou √2) ; comparaison EXACTE sans racine :
 * baisse_diag/√2 > baisse_orth ⇔ baisse_diag² > 2·baisse_orth² (entiers < 2^53).
 * Égalités : premier voisin dans l'ordre D8 (E, SE, S, SO, O, NO, N, NE).
 * Erreur si une cellule non océanique n'a aucun voisin strictement plus bas.
 */
export function flowDirections(
  surface: Int32Array,
  isOcean: Uint8Array,
  width: number,
  height: number,
  flowDir: Uint8Array,
): void {
  const n = width * height;
  for (let c = 0; c < n; c++) {
    if (isOcean[c] === 1) {
      flowDir[c] = NO_FLOW;
      continue;
    }
    const x = c % width;
    const y = (c - x) / width;
    const s = surface[c]!;
    let best = NO_FLOW;
    let bestScore = 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + D8_DX[k]!;
      const ny = y + D8_DY[k]!;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const drop = s - surface[ny * width + nx]!;
      if (drop <= 0) continue;
      // Score proportionnel au carré de la pente : orthogonal 2·d², diagonal d².
      const score = (k & 1) === 0 ? 2 * drop * drop : drop * drop;
      if (score > bestScore) {
        bestScore = score;
        best = k;
      }
    }
    if (best === NO_FLOW) throw new Error(`flowDirections : cellule ${c} sans voisin plus bas`);
    flowDir[c] = best;
  }
}

/** Index de la cellule aval de c (flowDir[c] ≠ NO_FLOW). */
export function receiverOf(c: number, code: number, width: number): number {
  return c + D8_DY[code]! * width + D8_DX[code]!;
}

/**
 * Cumul amont : out[c] = local[c] + Σ out[amont]. Parcours de order à l'envers (amont avant
 * aval, propriété du Priority-Flood). Les cellules d'océan reçoivent mais ne transmettent pas.
 */
export function accumulate(
  order: Int32Array,
  count: number,
  flowDir: Uint8Array,
  width: number,
  local: ArrayLike<number>,
  out: Uint32Array,
): void {
  for (let c = 0; c < out.length; c++) out[c] = local[c]!;
  for (let i = count - 1; i >= 0; i--) {
    const c = order[i]!;
    const r = receiverOf(c, flowDir[c]!, width);
    const v = out[r]! + out[c]!;
    if (v > 0xffffffff) throw new Error('accumulate : dépassement u32');
    out[r] = v;
  }
}

/**
 * Lacs : parmi les cellules non océaniques, candidates = profondeur (filled − elevation)
 * ≥ minDepth ; une composante 8-connexe de candidates de moins de minCells cellules n'est pas
 * un lac. Renvoie isLake (0/1) et le nombre de cellules de lac.
 */
export function findLakes(
  elevation: Int32Array,
  filled: Int32Array,
  isOcean: Uint8Array,
  width: number,
  height: number,
  minDepth: number,
  minCells: number,
  isLake: Uint8Array,
): number {
  const n = width * height;
  const cand = new Uint8Array(n);
  for (let c = 0; c < n; c++) {
    if (isOcean[c] !== 1 && filled[c]! - elevation[c]! >= minDepth) cand[c] = 1;
  }
  isLake.fill(0);
  const seen = new Uint8Array(n);
  const comp = new Int32Array(n);
  let lakeCells = 0;
  for (let s = 0; s < n; s++) {
    if (cand[s] !== 1 || seen[s] === 1) continue;
    let size = 0;
    let head = 0;
    comp[size++] = s;
    seen[s] = 1;
    while (head < size) {
      const c = comp[head++]!;
      const x = c % width;
      const y = (c - x) / width;
      for (let k = 0; k < 8; k++) {
        const nx = x + D8_DX[k]!;
        const ny = y + D8_DY[k]!;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const m = ny * width + nx;
        if (cand[m] === 1 && seen[m] === 0) {
          seen[m] = 1;
          comp[size++] = m;
        }
      }
    }
    if (size >= minCells) {
      for (let i = 0; i < size; i++) isLake[comp[i]!] = 1;
      lakeCells += size;
    }
  }
  return lakeCells;
}
