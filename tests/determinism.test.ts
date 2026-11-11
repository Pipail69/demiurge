/**
 * Critères d'acceptation T0 (a) et (b), plus contrôles négatifs (preuve que ces tests
 * PEUVENT échouer) et vérification que la charge de test est vivante.
 */
import { describe, expect, it } from 'vitest';
import { hashWorld } from '../src/core/hash.ts';
import { step, type World } from '../src/core/ecs/world.ts';
import { buildWorkload, DEMO_SEED, DEMO_TICKS, type WorkloadOptions } from './fixtures/workload.ts';

const CHECKPOINT_EVERY = 1000;

interface Run {
  checkpoints: string[]; // hash à t = 0, 1000, …, DEMO_TICKS
  world: World;
  stats: ReturnType<typeof buildWorkload>['stats'];
  rngDraws: number;
  ms: number;
}

function run(seed: number, ticks: number, options: WorkloadOptions = {}, extra?: (w: World) => void): Run {
  const t0 = performance.now(); // mesure côté test uniquement
  const { world, stats } = buildWorkload(seed, options);
  if (extra) world.addSystem(extra);
  // Compteur de tirages : instrumentation côté test (nextFloat/nextInt passent par this.nextU32).
  let rngDraws = 0;
  const original = world.rng.nextU32.bind(world.rng);
  world.rng.nextU32 = () => {
    rngDraws++;
    return original();
  };
  const checkpoints = [hashWorld(world)];
  for (let t = 1; t <= ticks; t++) {
    step(world);
    if (t % CHECKPOINT_EVERY === 0) checkpoints.push(hashWorld(world));
  }
  return { checkpoints, world, stats, rngDraws, ms: performance.now() - t0 };
}

describe('Critère (a) : même graine → même histoire', () => {
  it(`${DEMO_TICKS} ticks deux fois avec la même graine : hashs identiques à chaque point de contrôle`, () => {
    const r1 = run(DEMO_SEED, DEMO_TICKS);
    const r2 = run(DEMO_SEED, DEMO_TICKS);
    expect(r1.world.tick).toBe(DEMO_TICKS);
    expect(r1.checkpoints).toHaveLength(DEMO_TICKS / CHECKPOINT_EVERY + 1);
    expect(r2.checkpoints).toEqual(r1.checkpoints);
    // Les points de contrôle sont tous distincts : l'état évolue réellement.
    expect(new Set(r1.checkpoints).size).toBe(r1.checkpoints.length);

    // La charge est vivante (chiffres imprimés pour le rapport).
    const { stats, world } = r1;
    console.log(
      `[charge] graine ${DEMO_SEED} : ${DEMO_TICKS} ticks en ${r1.ms.toFixed(0)} ms (1re exécution), ${r2.ms.toFixed(0)} ms (2e) ; ` +
        `créées ${stats.created}, détruites ${stats.destroyed}, population finale ${world.entities.aliveCount}, ` +
        `pic ${stats.peakPopulation}, highWater ${world.entities.highWater}, capacité ${world.entities.capacity}, ` +
        `Velocity +${stats.velocityAdded}/−${stats.velocityRemoved}, tirages PRNG (nextU32) ${r1.rngDraws}`,
    );
    console.log(`[charge] hash final graine ${DEMO_SEED} : ${r1.checkpoints.at(-1)!}`);
    expect(stats.created).toBeGreaterThan(10_000);
    expect(stats.destroyed).toBeGreaterThan(10_000);
    expect(world.entities.aliveCount).toBeGreaterThan(0);
    expect(stats.created - stats.destroyed).toBe(world.entities.aliveCount); // conservation
    expect(world.entities.highWater).toBeLessThan(stats.created); // recyclage réellement sollicité
    expect(stats.velocityRemoved).toBeGreaterThan(1000);
    expect(r1.rngDraws).toBe(r2.rngDraws);
    expect(r1.rngDraws).toBeGreaterThan(100_000);
  });
});

describe('Critère (b) : graines différentes → hashs différents', () => {
  it('deux graines différentes : hashs différents dès le tick 0, à chaque point de contrôle et à la fin', () => {
    const seedA = DEMO_SEED;
    const seedB = DEMO_SEED + 1;
    const a = run(seedA, DEMO_TICKS);
    const b = run(seedB, DEMO_TICKS);
    console.log(`[charge] hash final graine ${seedB} : ${b.checkpoints.at(-1)!} (pop. finale ${b.world.entities.aliveCount})`);
    for (let k = 0; k < a.checkpoints.length; k++) expect(b.checkpoints[k]).not.toBe(a.checkpoints[k]);
    // Dès les premiers ticks.
    const a1 = buildWorkload(seedA);
    const b1 = buildWorkload(seedB);
    for (let t = 0; t < 3; t++) {
      step(a1.world);
      step(b1.world);
      expect(hashWorld(a1.world)).not.toBe(hashWorld(b1.world));
    }
  });
});

describe('Contrôles négatifs : les tests de déterminisme peuvent échouer', () => {
  it('une variante avec un système utilisant Math.random diverge entre deux exécutions', () => {
    // Système fautif (autorisé ici car dans tests/, jamais dans src/core).
    const impure = (w: World): void => {
      const pos = w.components[0]!;
      w.query([pos], (i) => {
        if (Math.random() < 0.01) pos.fieldArrays[0]![i] = Math.random() * 100;
      });
    };
    const r1 = run(DEMO_SEED, 1000, {}, impure);
    const r2 = run(DEMO_SEED, 1000, {}, impure);
    expect(r1.checkpoints[0]).toBe(r2.checkpoints[0]); // état initial identique
    expect(r1.checkpoints.at(-1)).not.toBe(r2.checkpoints.at(-1));
  });

  it('une variante avec l\'ordre des systèmes inversé produit un hash différent', () => {
    const normal = run(DEMO_SEED, 1000);
    const reversed = run(DEMO_SEED, 1000, { reverseSystems: true });
    expect(reversed.checkpoints[0]).toBe(normal.checkpoints[0]); // même monde initial
    expect(reversed.checkpoints.at(-1)).not.toBe(normal.checkpoints.at(-1));
  });
});
