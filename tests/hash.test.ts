import { describe, expect, it } from 'vitest';
import { assertLittleEndian, detectLittleEndian, hashWorld } from '../src/core/hash.ts';
import { step, World } from '../src/core/ecs/world.ts';
import { buildWorkload } from './fixtures/workload.ts';

function sample(seed = 9, initialCapacity?: number) {
  const world = new World(seed, initialCapacity === undefined ? {} : { initialCapacity });
  const A = world.registerComponent('A', { f: 'f64', i: 'i32' });
  const B = world.registerComponent('B', { u: 'u16' });
  const es = Array.from({ length: 10 }, () => world.createEntity());
  es.forEach((e, k) => {
    const i = world.addComponent(e, A);
    A.fields.f[i] = k * 1.25;
    A.fields.i[i] = -k;
    if (k % 3 === 0) {
      world.addComponent(e, B);
      B.fields.u[i] = 1000 + k;
    }
  });
  world.destroyEntity(es[4]!);
  return { world, A, B, es };
}

describe('hashWorld', () => {
  it('format : 64 caractères hexadécimaux ; la plateforme de test est petit-boutiste', () => {
    expect(hashWorld(new World(1))).toMatch(/^[0-9a-f]{64}$/);
    expect(detectLittleEndian()).toBe(true);
  });

  it('erreur explicite si la plateforme était gros-boutiste', () => {
    expect(() => assertLittleEndian(false)).toThrow(/gros-boutiste/);
    expect(() => assertLittleEndian(true)).not.toThrow();
  });

  it('deux mondes construits à l\'identique ont le même hash', () => {
    expect(hashWorld(sample().world)).toBe(hashWorld(sample().world));
  });

  it('la capacité allouée ne change pas le hash', () => {
    const small = sample(9, 1);
    const big = sample(9, 4096);
    expect(small.world.entities.capacity).not.toBe(big.world.entities.capacity);
    expect(hashWorld(small.world)).toBe(hashWorld(big.world));
    // Idem pour la charge de test après 300 ticks.
    const w1 = buildWorkload(3, { initialCapacity: 1 });
    const w2 = buildWorkload(3, { initialCapacity: 2048 });
    for (let t = 0; t < 300; t++) {
      step(w1.world);
      step(w2.world);
    }
    expect(w1.world.entities.capacity).not.toBe(w2.world.entities.capacity);
    expect(hashWorld(w1.world)).toBe(hashWorld(w2.world));
  });

  it('sensibilité : chaque modification élémentaire change le hash', () => {
    const base = hashWorld(sample().world);
    const variants: Record<string, (s: ReturnType<typeof sample>) => void> = {
      'valeur f64 d\'un composant': (s) => { s.A.fields.f[2] = s.A.fields.f[2]! + 1e-9; },
      'valeur i32 d\'un composant': (s) => { s.A.fields.i[7] = 12345; },
      'valeur u16 d\'un autre composant': (s) => { s.B.fields.u[0] = 1; },
      'tick': (s) => { s.world.tick++; },
      'état du PRNG': (s) => { s.world.rng.nextU32(); },
      'tuer une entité': (s) => { s.world.destroyEntity(s.es[8]!); },
      'retirer un composant': (s) => { s.world.removeComponent(s.es[0]!, s.B); },
      'ajouter un composant (champs nuls)': (s) => { s.world.addComponent(s.es[1]!, s.B); },
      'créer une entité sans composant': (s) => { s.world.createEntity(); },
      'enregistrer un composant de plus': (s) => { s.world.registerComponent('C', { z: 'u8' }); },
      '−0 au lieu de +0': (s) => { s.A.fields.f[0] = -0; },
    };
    const seen = new Set<string>([base]);
    for (const [name, mutate] of Object.entries(variants)) {
      const s = sample();
      mutate(s);
      const h = hashWorld(s.world);
      expect(h, name).not.toBe(base);
      seen.add(h);
    }
    expect(seen.size).toBe(Object.keys(variants).length + 1);
  });

  it('sensibilité : graine différente', () => {
    expect(hashWorld(sample(9).world)).not.toBe(hashWorld(sample(10).world));
  });

  it('sensibilité : ordre de la liste libre (il détermine les allocations futures)', () => {
    const s1 = sample();
    const s2 = sample();
    s1.world.destroyEntity(s1.es[1]!);
    s1.world.destroyEntity(s1.es[2]!);
    s2.world.destroyEntity(s2.es[2]!);
    s2.world.destroyEntity(s2.es[1]!);
    expect(hashWorld(s1.world)).not.toBe(hashWorld(s2.world));
  });

  it('le hash ne modifie pas le monde (idempotent)', () => {
    const s = sample();
    expect(hashWorld(s.world)).toBe(hashWorld(s.world));
  });
});
