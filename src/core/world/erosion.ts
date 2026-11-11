/**
 * Érosion simple : incision fluviale par la loi de puissance du courant (« stream power law »),
 * E = K·A^m·S^n avec m = 1/2 et n = 1, soit E = K·√A·S (Whipple & Tucker 1999 pour la forme et
 * m/n ≈ 0,5 ; K, nombre d'itérations et pas de temps sans unité = paramètres de jeu).
 * Modèle complet : docs/models.md § Érosion.
 *
 * Schéma explicite, `iterations` passes. Chaque passe :
 *  1. océan + Priority-Flood + ε sur l'élévation courante ;
 *  2. directions D8 sur la surface comblée ;
 *  3. aire drainée A (nombre de cellules, apport uniforme 1 par cellule non océanique) ;
 *  4. de l'aval vers l'amont (ordre du Priority-Flood), pour chaque cellule de terre hors
 *     dépression (elevation = filled) : baisse = élévation − surface aval (déjà mise à jour),
 *     Δ = ⌊K·√A·baisse/d⌋ (d = 1 ou √2), bornée pour que la cellule reste ≥ surface aval + 1 cm
 *     (jamais de fosse sous l'aval) et ≥ 1 cm (une cellule de terre reste émergée).
 * Bilan : la matière érodée (Σ Δ, entier exact) est exportée hors du système (pas de dépôt).
 */

import { accumulate, findOcean, flowDirections, priorityFlood, receiverOf } from './hydrology.ts';

export interface ErosionResult {
  /** Total abaissé, en cm·cellule (entier exact). */
  eroded: number;
}

export function erode(
  elevation: Int32Array,
  width: number,
  height: number,
  iterations: number,
  k: number,
  epsilon: number,
): ErosionResult {
  const n = width * height;
  const isOcean = new Uint8Array(n);
  const flowDir = new Uint8Array(n);
  const area = new Uint32Array(n);
  const unit = new Uint8Array(n);
  let eroded = 0;
  for (let it = 0; it < iterations; it++) {
    findOcean(elevation, width, height, isOcean);
    const { filled, order, count } = priorityFlood(elevation, isOcean, width, height, epsilon);
    flowDirections(filled, isOcean, width, height, flowDir);
    for (let c = 0; c < n; c++) unit[c] = isOcean[c] === 1 ? 0 : 1;
    accumulate(order, count, flowDir, width, unit, area);
    // `filled` sert de surface courante : mise à jour au fil des abaissements (aval d'abord).
    for (let i = 0; i < count; i++) {
      const c = order[i]!;
      const z = elevation[c]!;
      if (z !== filled[c]!) continue; // dans une dépression : pas d'incision
      const code = flowDir[c]!;
      const r = receiverOf(c, code, width);
      const drop = z - filled[r]!; // > 0 par construction
      const dist = (code & 1) === 0 ? 1 : Math.SQRT2;
      let delta = Math.floor((k * Math.sqrt(area[c]!) * drop) / dist);
      if (delta > drop - 1) delta = drop - 1;
      if (delta > z - 1) delta = z - 1;
      if (delta <= 0) continue;
      elevation[c] = z - delta;
      filled[c] = z - delta;
      eroded += delta;
    }
  }
  return { eroded };
}
