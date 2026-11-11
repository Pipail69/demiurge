import { afterEach, describe, expect, it, vi } from 'vitest';
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

  describe('sensibilité par section (états construits pour que la section compte seule)', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('graine : deux graines ramenées au même état PRNG → hashs différents', () => {
      const a = new World(1);
      const b = new World(2);
      b.rng.setState(a.rng.getState());
      expect(hashWorld(a)).not.toBe(hashWorld(b));
    });

    it('chacun des 4 mots du PRNG', () => {
      const base = new World(1);
      const h0 = hashWorld(base);
      const st = base.rng.getState();
      const seen = new Set([h0]);
      for (let k = 0; k < 4; k++) {
        const w = new World(1);
        const m = Array.from(st);
        m[k] = (m[k]! ^ 0x80000000) >>> 0;
        w.rng.setState(m);
        const h = hashWorld(w);
        expect(h, `mot ${k}`).not.toBe(h0);
        seen.add(h);
      }
      expect(seen.size).toBe(5);
    });

    it('highWater : emplacement supplémentaire entièrement nul', () => {
      const a = new World(1);
      const b = new World(1);
      b.entities.highWater = 1; // emplacement 0 : mort, génération 0, hors liste libre
      expect(hashWorld(a)).not.toBe(hashWorld(b));
    });

    it('alive, générations, liste libre : modification directe d\'un seul tableau', () => {
      const make = () => {
        const w = new World(1);
        for (let k = 0; k < 3; k++) w.createEntity();
        return w;
      };
      const h0 = hashWorld(make());
      const alive = make();
      alive.entities.alive[1] = 0;
      const gen = make();
      gen.entities.generation[2] = 5;
      const free = make();
      free.entities.freeList[0] = 1;
      free.entities.freeCount = 1;
      const hs = [hashWorld(alive), hashWorld(gen), hashWorld(free)];
      for (const h of hs) expect(h).not.toBe(h0);
      expect(new Set([h0, ...hs]).size).toBe(4);
    });

    it('nombre de composants, nom, schéma (mêmes données nulles)', () => {
      const mk = (name: string, schema: Record<string, 'u8' | 'i8'>, extra = false) => {
        const w = new World(1);
        w.registerComponent(name, schema);
        if (extra) w.registerComponent('Z', { z: 'u8' });
        w.createEntity();
        return hashWorld(w);
      };
      const h0 = mk('A', { v: 'u8' });
      const hs = [mk('B', { v: 'u8' }), mk('A', { v: 'i8' }), mk('A', { w: 'u8' }), mk('A', { v: 'u8' }, true)];
      expect(new Set([h0, ...hs]).size).toBe(5);
    });

    it('dernier emplacement [highWater−1] : alive, présence et chaque champ', () => {
      const mk = () => {
        const w = new World(1);
        const C = w.registerComponent('C', { a: 'f32', b: 'i32', c: 'u8' });
        for (let k = 0; k < 5; k++) w.createEntity();
        return { w, C, last: w.entities.highWater - 1 };
      };
      const h0 = hashWorld(mk().w);
      const mods: Array<(x: ReturnType<typeof mk>) => void> = [
        (x) => { x.w.entities.alive[x.last] = 0; },
        (x) => { x.C.present[x.last] = 1; },
        (x) => { x.C.fields.a[x.last] = 1; },
        (x) => { x.C.fields.b[x.last] = -1; },
        (x) => { x.C.fields.c[x.last] = 1; },
      ];
      const hs = mods.map((m) => {
        const x = mk();
        m(x);
        return hashWorld(x.w);
      });
      for (const h of hs) expect(h).not.toBe(h0);
      expect(new Set([h0, ...hs]).size).toBe(mods.length + 1);
    });

    it('emplacement d\'index ≥ 64 (au-delà de la capacité initiale) : présence et champs', () => {
      const mk = () => {
        const w = new World(1);
        const C = w.registerComponent('C', { a: 'f64', b: 'u16' });
        for (let k = 0; k < 130; k++) w.createEntity();
        return { w, C };
      };
      const h0 = hashWorld(mk().w);
      for (const idx of [64, 100, 129]) {
        const p = mk();
        p.C.present[idx] = 1;
        const a = mk();
        a.C.fields.a[idx] = 0.5;
        const b = mk();
        b.C.fields.b[idx] = 7;
        const hs = [hashWorld(p.w), hashWorld(a.w), hashWorld(b.w)];
        expect(new Set([h0, ...hs]).size, `index ${idx}`).toBe(4);
      }
    });

    it('hashWorld appelle effectivement la garde de boutisme (plateforme gros-boutiste simulée)', () => {
      const w = new World(1);
      expect(() => hashWorld(w)).not.toThrow();
      // Faux Uint16Array dont l'octet de poids faible est stocké en second (gros-boutiste).
      class BigEndianUint16 {
        readonly buffer = new Uint8Array([0, 1]).buffer;
      }
      vi.stubGlobal('Uint16Array', BigEndianUint16);
      expect(() => hashWorld(w)).toThrow(/gros-boutiste/);
    });
  });
});
