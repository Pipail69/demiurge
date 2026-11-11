/**
 * Saisons : calendrier dérivé du tick (aucun état redondant, aucune couche recalculée).
 * Modèle : docs/models.md § Saisons.
 *
 * - Année = ticksPerYear ticks (multiple de 8), 4 saisons de durée égale :
 *   0 printemps, 1 été, 2 automne, 3 hiver ; le tick 0 ouvre le printemps de l'année 0.
 * - Cycle thermique : cycle(tick) = sin(360°·(phase − 1/8)), phase = (tick mod Y)/Y, par
 *   l'approximation de Bhāskara : maximum au milieu de l'été, minimum au milieu de l'hiver.
 * - Température courante = moyenne annuelle + amplitude(φ)·cycle, amplitude(φ) = A1·sin φ
 *   (terme P1 de North, Cahalan & Coakley 1981, A1 ≈ 15,5 °C).
 */

import type { World } from '../ecs/world.ts';
import { bhaskaraSinDeg, latitudeOfRow } from './climate.ts';

export const SPRING = 0;
export const SUMMER = 1;
export const AUTUMN = 2;
export const WINTER = 3;
export const SEASON_NAMES: readonly string[] = ['printemps', 'été', 'automne', 'hiver'];

function assertCalendar(tick: number, ticksPerYear: number): void {
  if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError(`tick invalide ${String(tick)}`);
  if (!Number.isSafeInteger(ticksPerYear) || ticksPerYear < 8 || ticksPerYear % 8 !== 0) {
    throw new RangeError(`ticksPerYear invalide ${String(ticksPerYear)} (entier multiple de 8)`);
  }
}

export function yearAt(tick: number, ticksPerYear: number): number {
  assertCalendar(tick, ticksPerYear);
  return Math.floor(tick / ticksPerYear);
}

/** Saison (0..3) du tick : ⌊4·(tick mod Y)/Y⌋ (entiers exacts). */
export function seasonAt(tick: number, ticksPerYear: number): number {
  assertCalendar(tick, ticksPerYear);
  return Math.floor((4 * (tick % ticksPerYear)) / ticksPerYear);
}

/** Cycle saisonnier dans [−1, 1] (Bhāskara), maximum au milieu de l'été. */
export function seasonalCycle(tick: number, ticksPerYear: number): number {
  assertCalendar(tick, ticksPerYear);
  const t = tick % ticksPerYear;
  // Angle en degrés : 360·t/Y − 45 (décalage de 1/8 d'année).
  return bhaskaraSinDeg((360 * t) / ticksPerYear - 45);
}

/** Amplitude saisonnière (°C) à la latitude φ : A1·sin φ. */
export function seasonalAmplitude(latDeg: number, a1: number): number {
  return a1 * bhaskaraSinDeg(latDeg);
}

/**
 * Température courante (centièmes de °C, entier) de la cellule à l'index donné, au tick donné :
 * temperatureMean + round(100·amplitude(φ_ligne)·cycle(tick)). Lit les paramètres du monde.
 */
export function temperatureAt(world: World, cell: number, tick: number): number {
  const g = world.grid;
  if (g === null) throw new Error('temperatureAt : le monde n\'a pas de terrain');
  if (!Number.isInteger(cell) || cell < 0 || cell >= g.size) throw new RangeError(`cellule invalide ${String(cell)}`);
  const y = Math.floor(cell / g.width);
  const lat = latitudeOfRow(y, g.height, world.param('latNorthDeg'), world.param('latSouthDeg'));
  const amp = seasonalAmplitude(lat, world.param('seasonalAmplitudeC'));
  const cycle = seasonalCycle(tick, world.param('ticksPerYear'));
  return g.layer('temperatureMean')[cell]! + Math.round(100 * amp * cycle);
}
