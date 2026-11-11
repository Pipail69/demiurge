import { describe, expect, it } from 'vitest';
import { hashWorld } from '../src/core/hash.ts';
import { DEFAULT_MAX_STEPS_PER_ADVANCE, DEFAULT_STEP_MS, FixedStepLoop } from '../src/core/loop.ts';
import { step, World } from '../src/core/ecs/world.ts';
import { buildWorkload } from './fixtures/workload.ts';

describe('Boucle à pas fixe', () => {
  it('valeurs par défaut : 1000/30 ms, plafond 8 — vérifiées par le comportement', () => {
    expect(DEFAULT_STEP_MS).toBe(1000 / 30);
    expect(DEFAULT_MAX_STEPS_PER_ADVANCE).toBe(8);
    const loop = new FixedStepLoop(new World(1));
    expect(loop.stepMs).toBe(1000 / 30);
    expect(loop.advance(1000)).toBe(8); // 30 pas dus, plafonnés à 8
    expect(loop.advance(1000 / 30)).toBe(1);
  });

  // Chiffres constatés par exécution (2026-11-11) avec stepMs = 1000/30 : la soustraction
  // répétée en double laisse un reste à peine inférieur à stepMs, d'où 2 ticks pour 100 ms.
  it('accumulateur réel : advance(100) → 2 ticks et reste conservé ; 10 × 100 ms → 29 ticks', () => {
    const a = new FixedStepLoop(new World(1));
    expect(a.advance(100)).toBe(2);
    expect(a.accumulatorMs).toBe(33.33333333333332);
    expect(a.accumulatorMs).toBeLessThan(a.stepMs);
    expect(a.advance(0.00001)).toBe(1); // le reste n'est pas perdu
    const b = new FixedStepLoop(new World(1));
    let total = 0;
    for (let i = 0; i < 10; i++) total += b.advance(100);
    expect(total).toBe(29);
    expect(b.world.tick).toBe(29);
  });

  it('24 h en trames de 1000/60 ms → exactement 2 592 000 ticks, rien d\'abandonné', () => {
    const loop = new FixedStepLoop(new World(1));
    const frames = 24 * 3600 * 60;
    let total = 0;
    for (let i = 0; i < frames; i++) total += loop.advance(1000 / 60);
    expect(total).toBe(2_592_000);
    expect(loop.world.tick).toBe(2_592_000);
    expect(loop.droppedMs).toBe(0);
  });

  it('appels produisant 1, 2, …, 8 ticks chacun (jusqu\'au plafond) : même état qu\'en pas à pas', () => {
    const seed = 777;
    for (let perCall = 1; perCall <= DEFAULT_MAX_STEPS_PER_ADVANCE; perCall++) {
      const viaLoop = buildWorkload(seed);
      const loop = new FixedStepLoop(viaLoop.world, { stepMs: 10 });
      const calls = Math.ceil(120 / perCall);
      for (let c = 0; c < calls; c++) expect(loop.advance(perCall * 10)).toBe(perCall);
      const direct = buildWorkload(seed);
      for (let t = 0; t < calls * perCall; t++) step(direct.world);
      expect(viaLoop.world.tick).toBe(calls * perCall);
      expect(hashWorld(viaLoop.world), `${perCall} ticks/appel`).toBe(hashWorld(direct.world));
    }
  });

  it('chemin plafonné + abandon : l\'état ne dépend que du nombre de ticks exécutés', () => {
    const viaLoop = buildWorkload(888);
    const loop = new FixedStepLoop(viaLoop.world, { stepMs: 10, maxStepsPerAdvance: 5 });
    const elapsed = [1000, 3, 57, 10_000, 25, 49.5, 70, 0, 12];
    let ticks = 0;
    for (const ms of elapsed) ticks += loop.advance(ms);
    expect(loop.droppedMs).toBeGreaterThan(0);
    const direct = buildWorkload(888);
    for (let t = 0; t < ticks; t++) step(direct.world);
    expect(viaLoop.world.tick).toBe(ticks);
    expect(hashWorld(viaLoop.world)).toBe(hashWorld(direct.world));
  });

  it('abandon dès qu\'il reste exactement un pas entier après le plafond', () => {
    const loop = new FixedStepLoop(new World(1), { stepMs: 10, maxStepsPerAdvance: 2 });
    expect(loop.advance(30)).toBe(2);
    expect(loop.accumulatorMs).toBe(0);
    expect(loop.droppedMs).toBe(10);
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
