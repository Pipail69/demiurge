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

describe('Critère (b) : graines différentes → histoires différentes', () => {
  it('deux graines différentes : hashs différents dès le tick 0, à chaque point de contrôle et à la fin', () => {
    const seedA = DEMO_SEED;
    const seedB = DEMO_SEED + 1;
    const a = run(seedA, DEMO_TICKS);
    const b = run(seedB, DEMO_TICKS);
    console.log(`[charge] hash final graine ${seedB} : ${b.checkpoints.at(-1)!} (pop. finale ${b.world.entities.aliveCount})`);
    for (let k = 0; k < a.checkpoints.length; k++) expect(b.checkpoints[k]).not.toBe(a.checkpoints[k]);
  });

  // La graine figure elle-même dans le hash : des hashs différents ne prouvent donc PAS que
  // les histoires diffèrent. Ce test compare le CONTENU (PRNG, compteurs, données), hors graine.
  it('les histoires elles-mêmes diffèrent : état du PRNG, compteurs de la charge, données de composants', () => {
    const a = buildWorkload(DEMO_SEED);
    const b = buildWorkload(DEMO_SEED + 1);
    expect(Array.from(a.world.rng.getState())).not.toEqual(Array.from(b.world.rng.getState()));
    for (let t = 0; t < 3; t++) {
      step(a.world);
      step(b.world);
      expect(Array.from(a.world.rng.getState())).not.toEqual(Array.from(b.world.rng.getState()));
      const posA = a.world.components[0]!;
      const posB = b.world.components[0]!;
      const dataA = Array.from(posA.fieldArrays[0]!.subarray(0, a.world.entities.highWater));
      const dataB = Array.from(posB.fieldArrays[0]!.subarray(0, b.world.entities.highWater));
      expect(dataA).not.toEqual(dataB);
    }
    while (a.world.tick < 2000) {
      step(a.world);
      step(b.world);
    }
    const summary = (w: typeof a) => [w.stats.created, w.stats.destroyed, w.world.entities.aliveCount, w.stats.velocityAdded];
    expect(summary(a)).not.toEqual(summary(b));
  });
});

/*
 * VALEURS DE RÉFÉRENCE ÉPINGLÉES. Tout changement de l'une d'elles signifie un changement
 * du format de hash ou de l'histoire simulée (PRNG, amorçage, ECS, charge de test) : il doit
 * être voulu et justifié par une entrée dans docs/decisions.md, puis les valeurs mises à jour
 * ici, dans STATE.md et dans le rapport.
 * Épinglées le 2026-11-11 après le passage de l'amorçage à SplitMix64, puis RE-ÉPINGLÉES le
 * 2026-11-11 (T1) pour le format de hash v2 (sections paramètres et grille ajoutées, version
 * 1 → 2 ; decisions.md, T1) : l'histoire simulée et les compteurs sont INCHANGÉS.
 */
describe('Hashs et compteurs de référence épinglés', () => {
  it('graine 20261111 (ticks 0, 1 000, 10 000) et graine 20261112 (tick 10 000)', () => {
    const a = run(20261111, 10_000);
    expect(a.checkpoints[0]).toBe('ba2ffb046fbb5be80d5092472b4a079bd8bd55a46cf6751b93bb1fd0672a9e59');
    expect(a.checkpoints[1]).toBe('95a081bbc6c708309924aba83a76db8527bd52cb5ea99b7f6abbbe772e95aa8f');
    expect(a.checkpoints[10]).toBe('23438c0b488662788e07a374e34abb5ef25c6e3320926764fc7c339f07dde475');
    expect({ ...a.stats, alive: a.world.entities.aliveCount, highWater: a.world.entities.highWater, draws: a.rngDraws }).toEqual({
      created: 19960, destroyed: 19897, velocityAdded: 28511, velocityRemoved: 16183, peakPopulation: 97,
      alive: 63, highWater: 97, draws: 1547651,
    });
    const b = run(20261112, 10_000);
    expect(b.checkpoints[10]).toBe('0fb538dd7482a0ddb3c715667389d1096d4028ff3ccdf31857cff51b1ca31d59');
    expect({ ...b.stats, alive: b.world.entities.aliveCount, draws: b.rngDraws }).toEqual({
      created: 20055, destroyed: 19983, velocityAdded: 28705, velocityRemoved: 16237, peakPopulation: 105,
      alive: 72, draws: 1549727,
    });
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
