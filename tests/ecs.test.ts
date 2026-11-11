import { describe, expect, it } from 'vitest';
import { entityGeneration, entityIndex, makeEntity, GENERATION_MASK } from '../src/core/ecs/entities.ts';
import { step, World } from '../src/core/ecs/world.ts';
import { hashWorld } from '../src/core/hash.ts';

function makeWorld(seed = 1, initialCapacity?: number) {
  const world = new World(seed, initialCapacity === undefined ? {} : { initialCapacity });
  const Pos = world.registerComponent('Pos', { y: 'f32', x: 'f32' });
  const Tag = world.registerComponent('Tag', { v: 'u8' });
  return { world, Pos, Tag };
}

describe('Poignées d\'entité', () => {
  it('encodage index + génération : valeurs littérales calculées à la main', () => {
    // poignée = (génération mod 2^21) × 2^32 + index
    expect(makeEntity(0, 0)).toBe(0);
    expect(makeEntity(5, 3)).toBe(12884901893); // 3 × 4294967296 + 5
    expect(makeEntity(0xffffffff, 2097151)).toBe(9007199254740991); // (2^21−1)·2^32 + (2^32−1) = 2^53 − 1 (Number.MAX_SAFE_INTEGER)
    expect(makeEntity(7, 2097152)).toBe(7); // 2^21 ≡ 0 (mod 2^21)
    expect(makeEntity(123456, 2097159)).toBe(30064894528); // 7 × 4294967296 + 123456
    expect(entityIndex(12884901893)).toBe(5);
    expect(entityGeneration(12884901893)).toBe(3);
    expect(entityIndex(9007199254740991)).toBe(4294967295);
    expect(entityGeneration(9007199254740991)).toBe(2097151);
    expect(GENERATION_MASK).toBe(2097151);
  });

  it('poignées non entières, négatives ou non sûres : jamais vivantes, toujours refusées', () => {
    const { world, Pos } = makeWorld();
    const e0 = world.createEntity();
    expect(e0).toBe(0);
    for (const bad of [0.5, -1, -0.5, NaN, Infinity, 2 ** 53, 1e300]) {
      expect(world.isAlive(bad), String(bad)).toBe(false);
      expect(() => world.destroyEntity(bad)).toThrow(/périmée/);
      expect(() => world.addComponent(bad, Pos)).toThrow(/périmée/);
    }
    expect(world.isAlive(e0)).toBe(true);
    expect(world.entities.aliveCount).toBe(1);
  });

  it('LIMITE CONNUE (décision ouverte avant T5) : après 2^21 recyclages d\'un emplacement, une poignée périmée redevient « vivante »', () => {
    // Génération sur 21 bits dans la poignée + liste libre LIFO : l'emplacement 0 est recyclé
    // à chaque cycle. Ce test DOCUMENTE le comportement actuel ; il n'est pas souhaitable.
    const { world } = makeWorld();
    const stale = world.createEntity();
    world.destroyEntity(stale);
    expect(world.isAlive(stale)).toBe(false);
    let current = world.createEntity();
    for (let k = 1; k < 2 ** 21; k++) {
      world.destroyEntity(current);
      current = world.createEntity();
    }
    expect(entityIndex(current)).toBe(0);
    expect(world.entities.generation[0]).toBe(2 ** 21); // génération complète conservée en uint32
    expect(world.isAlive(stale)).toBe(true); // ABA : la poignée de la 1re entité est acceptée
    expect(current).toBe(stale);
  });
});

describe('ECS : entités', () => {
  it('création, destruction, recyclage LIFO, génération incrémentée, poignée périmée détectée', () => {
    const { world } = makeWorld();
    const a = world.createEntity();
    const b = world.createEntity();
    const c = world.createEntity();
    expect([a, b, c].map(entityIndex)).toEqual([0, 1, 2]);
    expect(world.entities.highWater).toBe(3);
    expect(world.entities.aliveCount).toBe(3);

    world.destroyEntity(a);
    world.destroyEntity(c);
    expect(world.isAlive(a)).toBe(false);
    expect(world.isAlive(b)).toBe(true);
    expect(world.entities.generation[0]).toBe(1);
    expect(world.entities.aliveCount).toBe(1);

    // LIFO : c (index 2) libéré en dernier → réutilisé en premier.
    const d = world.createEntity();
    expect(entityIndex(d)).toBe(2);
    expect(entityGeneration(d)).toBe(1);
    const e = world.createEntity();
    expect(entityIndex(e)).toBe(0);
    const f = world.createEntity();
    expect(entityIndex(f)).toBe(3); // liste libre vide → nouvel emplacement
    expect(world.entities.highWater).toBe(4);

    // Poignées périmées : même index, ancienne génération.
    expect(world.isAlive(c)).toBe(false);
    expect(world.isAlive(d)).toBe(true);
    expect(() => world.destroyEntity(c)).toThrow(/périmée/);
    expect(() => world.destroyEntity(a)).toThrow(/périmée/);
  });

  it('croissance de capacité par doublement', () => {
    const { world, Pos } = makeWorld(1, 2);
    const handles = [];
    for (let i = 0; i < 9; i++) {
      const e = world.createEntity();
      const idx = world.addComponent(e, Pos);
      Pos.fields.x[idx] = i;
      handles.push(e);
    }
    expect(world.entities.capacity).toBe(16);
    expect(Pos.present.length).toBe(16);
    for (let i = 0; i < 9; i++) expect(Pos.fields.x[i]).toBe(i);
    expect(handles.every((h) => world.isAlive(h))).toBe(true);
  });
});

describe('ECS : validations', () => {
  it('poignée périmée refusée par addComponent / removeComponent / hasComponent / destroyEntity', () => {
    const { world, Pos } = makeWorld();
    const e = world.createEntity();
    world.addComponent(e, Pos);
    world.destroyEntity(e);
    const recycled = world.createEntity(); // même index, génération suivante
    world.addComponent(recycled, Pos);
    expect(entityIndex(recycled)).toBe(entityIndex(e));
    expect(() => world.addComponent(e, Pos)).toThrow(/périmée/);
    expect(() => world.removeComponent(e, Pos)).toThrow(/périmée/);
    expect(() => world.hasComponent(e, Pos)).toThrow(/périmée/);
    expect(() => world.destroyEntity(e)).toThrow(/périmée/);
    expect(world.isAlive(recycled)).toBe(true);
    expect(world.hasComponent(recycled, Pos)).toBe(true);
  });

  it('store d\'un autre monde refusé par addComponent / removeComponent / hasComponent / query', () => {
    const { world } = makeWorld();
    const other = makeWorld();
    const e = world.createEntity();
    expect(() => world.addComponent(e, other.Pos)).toThrow(/non enregistré/);
    expect(() => world.removeComponent(e, other.Pos)).toThrow(/non enregistré/);
    expect(() => world.hasComponent(e, other.Pos)).toThrow(/non enregistré/);
    expect(() => world.query([other.Pos], () => {})).toThrow(/non enregistré/);
  });

  it('release remet alive à 0 (observable par le tableau, isAlive et le hash)', () => {
    const { world } = makeWorld();
    const a = world.createEntity();
    world.createEntity();
    const h1 = hashWorld(world);
    world.destroyEntity(a);
    expect(world.entities.alive[0]).toBe(0);
    expect(world.isAlive(a)).toBe(false);
    expect(world.entities.aliveCount).toBe(1);
    expect(hashWorld(world)).not.toBe(h1);
  });

  it('la liste libre ne garde aucun résidu au-delà de freeCount ; pas de croissance si elle n\'est pas vide', () => {
    const { world } = makeWorld(1, 4);
    const es = Array.from({ length: 4 }, () => world.createEntity());
    world.destroyEntity(es[1]!);
    world.destroyEntity(es[2]!);
    world.createEntity();
    world.createEntity();
    expect(world.entities.freeCount).toBe(0);
    expect(Array.from(world.entities.freeList)).toEqual([0, 0, 0, 0]);
    expect(world.entities.capacity).toBe(4); // capacité pleine, liste libre utilisée d'abord
  });
});

describe('ECS : composants', () => {
  it('ordre des champs figé (tri) indépendamment de l\'ordre de déclaration ; id = ordre d\'enregistrement', () => {
    const { world, Pos, Tag } = makeWorld();
    expect(Pos.fieldNames).toEqual(['x', 'y']);
    expect(Pos.fieldTypes).toEqual(['f32', 'f32']);
    expect(Pos.id).toBe(0);
    expect(Tag.id).toBe(1);
    expect(world.components.map((c) => c.name)).toEqual(['Pos', 'Tag']);
    expect(() => world.registerComponent('Pos', { a: 'u8' })).toThrow(/déjà/);
    expect(() => world.registerComponent('bad name', { a: 'u8' })).toThrow(/invalide/);
    expect(() => world.registerComponent('Empty', {})).toThrow(/vide/);
    // @ts-expect-error type de champ inconnu
    expect(() => world.registerComponent('Bad', { a: 'u64' })).toThrow(/type inconnu/);
  });

  it('ajout / retrait de composant, avec mise à zéro au retrait', () => {
    const { world, Pos, Tag } = makeWorld();
    const e = world.createEntity();
    expect(world.hasComponent(e, Pos)).toBe(false);
    const i = world.addComponent(e, Pos);
    expect(Pos.fields.x[i]).toBe(0);
    Pos.fields.x[i] = 3.5;
    Pos.fields.y[i] = -2;
    expect(world.hasComponent(e, Pos)).toBe(true);
    expect(world.hasComponent(e, Tag)).toBe(false);
    expect(() => world.addComponent(e, Pos)).toThrow(/déjà présent/);
    world.removeComponent(e, Pos);
    expect(world.hasComponent(e, Pos)).toBe(false);
    expect(Pos.fields.x[i]).toBe(0);
    expect(Pos.fields.y[i]).toBe(0);
    expect(() => world.removeComponent(e, Pos)).toThrow(/absent/);
    // Composant d'un autre monde refusé.
    const other = makeWorld();
    expect(() => world.addComponent(e, other.Tag)).toThrow(/non enregistré/);
  });

  it('destruction : tous les composants remis à zéro, emplacement recyclé vierge', () => {
    const { world, Pos, Tag } = makeWorld();
    const e = world.createEntity();
    const i = world.addComponent(e, Pos);
    world.addComponent(e, Tag);
    Pos.fields.x[i] = 1;
    Pos.fields.y[i] = 2;
    Tag.fields.v[i] = 9;
    world.destroyEntity(e);
    expect(Pos.present[i]).toBe(0);
    expect(Tag.present[i]).toBe(0);
    expect(Pos.fields.x[i]).toBe(0);
    expect(Pos.fields.y[i]).toBe(0);
    expect(Tag.fields.v[i]).toBe(0);
    const f = world.createEntity();
    expect(entityIndex(f)).toBe(i);
    expect(world.hasComponent(f, Pos)).toBe(false);
  });

  it('forme canonique : créer puis détruire laisse le même hash que créer-détruire dans un autre ordre', () => {
    const w1 = makeWorld();
    const w2 = makeWorld();
    // w1 : crée, écrit des données, détruit. w2 : crée, détruit sans données.
    const e1 = w1.world.createEntity();
    const i1 = w1.world.addComponent(e1, w1.Pos);
    w1.Pos.fields.x[i1] = 42;
    w1.world.destroyEntity(e1);
    const e2 = w2.world.createEntity();
    w2.world.destroyEntity(e2);
    expect(hashWorld(w1.world)).toBe(hashWorld(w2.world));
  });
});

describe('ECS : requêtes et systèmes', () => {
  it('query visite par index croissant les entités possédant tous les composants', () => {
    const { world, Pos, Tag } = makeWorld();
    const es = Array.from({ length: 6 }, () => world.createEntity());
    for (const k of [4, 1, 3, 0]) world.addComponent(es[k]!, Pos);
    for (const k of [3, 0, 5]) world.addComponent(es[k]!, Tag);
    const seen: number[] = [];
    world.query([Pos], (i) => seen.push(i));
    expect(seen).toEqual([0, 1, 3, 4]);
    const both: number[] = [];
    world.query([Pos, Tag], (i) => both.push(i));
    expect(both).toEqual([0, 3]);
    expect(() => world.query([], () => {})).toThrow();
  });

  it('mutation pendant l\'itération : créées non visitées, détruites/retirées sautées, recyclage non visité', () => {
    const { world, Pos, Tag } = makeWorld();
    const es = Array.from({ length: 5 }, () => {
      const e = world.createEntity();
      world.addComponent(e, Pos);
      return e;
    });
    const seen: number[] = [];
    world.query([Pos], (i) => {
      seen.push(i);
      if (i === 0) {
        world.destroyEntity(es[3]!); // index 3 détruit avant sa visite → sauté
        world.removeComponent(es[2]!, Pos); // index 2 perd Pos avant sa visite → sauté
        // Recyclage de l'index 3 (LIFO) par une nouvelle entité AVEC Pos : génération
        // différente → pas visitée par cette itération.
        const r = world.createEntity();
        expect(entityIndex(r)).toBe(3);
        world.addComponent(r, Pos);
        // Nouvel emplacement au-delà du highWater initial → pas visité.
        const n = world.createEntity();
        world.addComponent(n, Pos);
        // Composant ajouté pendant l'itération à une entité non candidate : pas visitée.
        world.addComponent(es[1]!, Tag);
      }
    });
    expect(seen).toEqual([0, 1, 4]);
    // L'itération suivante voit le nouvel état.
    const after: number[] = [];
    world.query([Pos], (i) => after.push(i));
    expect(after).toEqual([0, 1, 3, 4, 5]);
  });

  it('mutation pendant l\'itération avec croissance de capacité : comportement correct', () => {
    const { world, Pos } = makeWorld(1, 2);
    for (let k = 0; k < 2; k++) world.addComponent(world.createEntity(), Pos);
    const seen: number[] = [];
    world.query([Pos], (i) => {
      seen.push(i);
      for (let k = 0; k < 10; k++) world.addComponent(world.createEntity(), Pos); // force la croissance
    });
    expect(seen).toEqual([0, 1]);
    expect(world.entities.capacity).toBe(32);
  });

  it('systèmes exécutés dans l\'ordre d\'enregistrement, tick incrémenté après', () => {
    const { world } = makeWorld();
    const log: string[] = [];
    world.addSystem((w) => log.push(`A${w.tick}`));
    world.addSystem((w) => log.push(`B${w.tick}`));
    world.addSystem((w) => {
      log.push(`C${w.tick}`);
      if (w.tick === 0) w.addSystem(() => log.push('D'));
    });
    step(world);
    expect(world.tick).toBe(1);
    step(world);
    expect(log).toEqual(['A0', 'B0', 'C0', 'A1', 'B1', 'C1', 'D']);
  });
});
