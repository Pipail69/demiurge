import { describe, expect, it } from 'vitest';
import { hashWorld } from '../src/core/hash.ts';
import { DEFAULT_MAX_STEPS_PER_ADVANCE, DEFAULT_STEP_MS, FixedStepLoop } from '../src/core/loop.ts';
import { World } from '../src/core/ecs/world.ts';
import { buildWorkload } from './fixtures/workload.ts';

describe('Boucle à pas fixe', () => {
  it('valeurs par défaut : 1000/30 ms, plafond 8', () => {
    expect(DEFAULT_STEP_MS).toBe(1000 / 30);
    expect(DEFAULT_MAX_STEPS_PER_ADVANCE).toBe(8);
  });

  it('convertit le temps écoulé en ticks entiers et garde le reste', () => {
    const loop = new FixedStepLoop(new World(1), { stepMs: 10 });
    expect(loop.advance(5)).toBe(0);
    expect(loop.advance(5)).toBe(1);
    expect(loop.advance(25)).toBe(2);
    expect(loop.accumulatorMs).toBeCloseTo(5, 12);
    expect(loop.advance(0)).toBe(0);
    expect(loop.world.tick).toBe(3);
  });

  it('l\'issue ne dépend que du nombre de ticks, pas du découpage du temps réel', () => {
    const seed = 555;
    const stepMs = 1000 / 30;
    // Découpage 1 : trames régulières de ~16,67 ms (60 Hz).
    const a = buildWorkload(seed);
    const la = new FixedStepLoop(a.world, { stepMs });
    // Découpage 2 : trames irrégulières (déterministes) entre 1 et 60 ms.
    const b = buildWorkload(seed);
    const lb = new FixedStepLoop(b.world, { stepMs, maxStepsPerAdvance: 1000 });
    const target = 600;
    // Le temps passé est borné par le temps restant : aucun découpage ne dépasse la cible.
    let callsA = 0;
    while (a.world.tick < target) {
      la.advance(Math.min(1000 / 60, (target - a.world.tick) * stepMs));
      callsA++;
    }
    const jitter = [1, 59, 7, 33.3, 12, 47, 3, 60, 21, 0];
    let k = 0;
    while (b.world.tick < target) {
      const remaining = (target - b.world.tick) * stepMs;
      lb.advance(Math.min(jitter[k++ % jitter.length]!, remaining));
    }
    expect(a.world.tick).toBe(target);
    expect(b.world.tick).toBe(target);
    expect(hashWorld(a.world)).toBe(hashWorld(b.world));
    // Les deux découpages ont bien été différents.
    expect(callsA).not.toBe(k);
  });

  it('plafond de rattrapage : au plus maxStepsPerAdvance ticks, retard excédentaire abandonné', () => {
    const loop = new FixedStepLoop(new World(1), { stepMs: 10, maxStepsPerAdvance: 4 });
    expect(loop.advance(1003)).toBe(4); // 100 pas dus, 4 exécutés
    expect(loop.accumulatorMs).toBeCloseTo(3, 9); // seule la fraction de pas est gardée
    expect(loop.droppedMs).toBeCloseTo(960, 9);
    expect(loop.advance(10)).toBe(1); // pas de rattrapage différé
    expect(loop.world.tick).toBe(5);
  });

  it('entrées invalides refusées', () => {
    const loop = new FixedStepLoop(new World(1));
    for (const bad of [-1, NaN, Infinity, -Infinity]) expect(() => loop.advance(bad)).toThrow(RangeError);
    expect(loop.world.tick).toBe(0);
    expect(() => new FixedStepLoop(new World(1), { stepMs: 0 })).toThrow(RangeError);
    expect(() => new FixedStepLoop(new World(1), { stepMs: NaN })).toThrow(RangeError);
    expect(() => new FixedStepLoop(new World(1), { maxStepsPerAdvance: 0 })).toThrow(RangeError);
    expect(() => new FixedStepLoop(new World(1), { maxStepsPerAdvance: 1.5 })).toThrow(RangeError);
  });
});
