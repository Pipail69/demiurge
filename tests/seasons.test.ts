/**
 * Saisons (docs/models.md § Saisons) : calendrier dérivé du tick, cycle thermique.
 */
import { describe, expect, it } from 'vitest';
import { step } from '../src/core/ecs/world.ts';
import { hashWorld } from '../src/core/hash.ts';
import {
  AUTUMN, seasonalAmplitude, seasonalCycle, seasonAt, SPRING, SUMMER, temperatureAt, WINTER, yearAt,
} from '../src/core/world/seasons.ts';
import { World } from '../src/core/ecs/world.ts';
import { generateWorld } from '../src/core/world/generate.ts';
import { DEFAULT_WORLDGEN_PARAMS as D } from '../src/core/world/params.ts';
import { generated, layersOf } from './helpers/worlds.ts';

const Y = D.ticksPerYear;

describe('Calendrier', () => {
  it('4 saisons de durées égales (Y/4 ticks), dans l\'ordre printemps, été, automne, hiver', () => {
    const counts = [0, 0, 0, 0];
    let prev = -1;
    const order: number[] = [];
    for (let t = 0; t < Y; t++) {
      const s = seasonAt(t, Y);
      counts[s]!++;
      if (s !== prev) order.push(s);
      prev = s;
    }
    expect(counts).toEqual([Y / 4, Y / 4, Y / 4, Y / 4]);
    expect(order).toEqual([SPRING, SUMMER, AUTUMN, WINTER]);
    expect(seasonAt(0, Y)).toBe(SPRING);
    expect(seasonAt(Y / 4 - 1, Y)).toBe(SPRING);
    expect(seasonAt(Y / 4, Y)).toBe(SUMMER);
    expect(seasonAt(Y - 1, Y)).toBe(WINTER);
  });

  it('périodicité annuelle : saison et cycle de t et de t + k·Y identiques ; année = ⌊t/Y⌋', () => {
    for (const t of [0, 1, 17, Y / 2, Y - 1]) {
      for (const k of [1, 2, 1000]) {
        expect(seasonAt(t + k * Y, Y)).toBe(seasonAt(t, Y));
        expect(seasonalCycle(t + k * Y, Y)).toBe(seasonalCycle(t, Y));
        expect(yearAt(t + k * Y, Y)).toBe(k);
      }
    }
    expect(yearAt(Y - 1, Y)).toBe(0);
  });

  it('cycle : max au milieu de l\'été (= 1), min au milieu de l\'hiver (= −1), dans [−1, 1]', () => {
    expect(seasonalCycle((3 * Y) / 8, Y)).toBe(1);
    expect(seasonalCycle((7 * Y) / 8, Y)).toBe(-1);
    for (let t = 0; t < Y; t++) expect(Math.abs(seasonalCycle(t, Y))).toBeLessThanOrEqual(1);
  });

  it('moyenne du cycle sur une année ≈ 0 (|moyenne| < 1e-12 : paires t, t + Y/2 opposées à l\'arrondi près)', () => {
    let s = 0;
    for (let t = 0; t < Y; t++) s += seasonalCycle(t, Y);
    expect(Math.abs(s / Y)).toBeLessThan(1e-12);
  });

  it('entrées invalides refusées', () => {
    expect(() => seasonAt(-1, Y)).toThrow(RangeError);
    expect(() => seasonAt(0.5, Y)).toThrow(RangeError);
    expect(() => seasonAt(0, 100)).toThrow(RangeError); // non multiple de 8
  });
});

describe('Température saisonnière d\'une cellule', () => {
  const { world } = generated(4, 96, 96);
  const g = world.grid!;
  const mean = g.layer('temperatureMean');

  it('été plus chaud que l\'hiver pour une même cellule ; moyenne annuelle ≈ moyenne stockée (±0,5 centième)', () => {
    // Ligne du bas = équateur (latSouthDeg = 0) : amplitude nulle, été = hiver (vérifié à part).
    const eq = 95 * 96 + 50;
    expect(temperatureAt(world, eq, (3 * Y) / 8)).toBe(temperatureAt(world, eq, (7 * Y) / 8));
    for (const cell of [0, 50 * 96 + 40, 90 * 96 + 95]) {
      const summer = temperatureAt(world, cell, (3 * Y) / 8);
      const winter = temperatureAt(world, cell, (7 * Y) / 8);
      expect(summer).toBeGreaterThan(winter);
      let s = 0;
      for (let t = 0; t < Y; t++) s += temperatureAt(world, cell, t);
      expect(Math.abs(s / Y - mean[cell]!)).toBeLessThanOrEqual(0.5);
    }
  });

  it('amplitude A1·sin φ : croissante avec la latitude, 15,5 °C au pôle, nulle à l\'équateur', () => {
    expect(seasonalAmplitude(0, 15.5)).toBe(0);
    expect(seasonalAmplitude(90, 15.5)).toBe(15.5);
    let prev = -1;
    for (let lat = 0; lat <= 90; lat++) {
      const a = seasonalAmplitude(lat, 15.5);
      expect(a).toBeGreaterThan(prev);
      prev = a;
    }
    // Sur la carte : écart été − hiver plus grand au nord (ligne 0) qu'au sud (dernière ligne).
    const span = (cell: number) => temperatureAt(world, cell, (3 * Y) / 8) - temperatureAt(world, cell, (7 * Y) / 8);
    expect(span(10)).toBeGreaterThan(span(95 * 96 + 10));
  });

  it('les ticks ne modifient aucune couche du terrain (3 000 ticks), seul le tick change', () => {
    const w = new World(8);
    generateWorld(w, { width: 64, height: 64 });
    const before = layersOf(w);
    const rngBefore = Array.from(w.rng.getState());
    for (let t = 0; t < 3000; t++) step(w);
    expect(w.tick).toBe(3000);
    for (const l of w.grid!.layers) expect(Array.from(l.data), l.name).toEqual(Array.from(before.get(l.name)!));
    expect(Array.from(w.rng.getState())).toEqual(rngBefore);
    const w2 = new World(8);
    generateWorld(w2, { width: 64, height: 64 });
    w2.tick = 3000;
    expect(hashWorld(w)).toBe(hashWorld(w2));
  });

  it('erreurs : monde sans terrain, cellule hors grille', () => {
    expect(() => temperatureAt(new World(1), 0, 0)).toThrow(/terrain/);
    expect(() => temperatureAt(world, g.size, 0)).toThrow(RangeError);
  });
});
