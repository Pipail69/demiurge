/**
 * Monde : graine, compteur de tick, PRNG unique, allocateur d'entités, composants
 * (tableau ordonné, id = ordre d'enregistrement), systèmes (tableau ordonné).
 *
 * Règles d'itération (query) — voir docs/models.md § ECS :
 *  - visite par index d'entité croissant ;
 *  - l'ensemble candidat est figé au début de l'itération (index + génération des entités
 *    qui possèdent alors tous les composants demandés) ;
 *  - au moment de sa visite, un candidat n'est visité que s'il est toujours vivant, de même
 *    génération, et possède toujours tous les composants demandés ;
 *  - conséquence : une entité créée (ou un composant ajouté) pendant l'itération n'est
 *    jamais visitée par cette itération ; une entité détruite (ou un composant retiré)
 *    avant sa visite est sautée.
 */

import { Rng } from '../rng.ts';
import type { Grid } from '../grid.ts';
import { assertValidName, ComponentStore, type Schema } from './component.ts';
import { EntityAllocator, entityIndex, type Entity } from './entities.ts';

export type System = (world: World) => void;

export interface WorldOptions {
  /** Capacité initiale des tableaux d'entités (doublée au besoin). N'affecte pas le hash. */
  initialCapacity?: number;
}

export const DEFAULT_INITIAL_CAPACITY = 64;

/**
 * Paramètre du monde : nom ASCII + valeur f64 finie. Les paramètres qui gouvernent l'évolution
 * future du monde (taille, coefficients, durée de l'année…) font partie de son état et sont
 * hachés dans l'ordre de la liste (docs/models.md § Hash v2).
 */
export interface WorldParam {
  readonly name: string;
  readonly value: number;
}

export class World {
  readonly seed: number;
  tick = 0;
  readonly rng: Rng;
  readonly entities: EntityAllocator;
  readonly components: ComponentStore[] = [];
  readonly systems: System[] = [];
  /** Paramètres du monde, liste ORDONNÉE (ordre d'ajout = ordre de hachage). */
  readonly params: WorldParam[] = [];
  /** Terrain : grille dense optionnelle (ressource du monde, pas des entités). */
  grid: Grid | null = null;

  constructor(seed: number, options: WorldOptions = {}) {
    this.rng = new Rng(seed); // valide la graine (uint32)
    this.seed = seed;
    this.entities = new EntityAllocator(options.initialCapacity ?? DEFAULT_INITIAL_CAPACITY);
  }

  registerComponent<S extends Schema>(name: string, schema: S): ComponentStore<S> {
    for (const c of this.components) {
      if (c.name === name) throw new Error(`Composant « ${name} » déjà enregistré`);
    }
    const store = new ComponentStore<S>(this.components.length, name, schema, this.entities.capacity);
    this.components.push(store as unknown as ComponentStore);
    return store;
  }

  /** Ajoute un paramètre (nom ASCII unique, valeur finie ; −0 normalisé en +0). */
  addParam(name: string, value: number): void {
    assertValidName(name, 'Nom de paramètre');
    if (!Number.isFinite(value)) throw new RangeError(`Paramètre « ${name} » : valeur non finie ${String(value)}`);
    for (const p of this.params) if (p.name === name) throw new Error(`Paramètre « ${name} » déjà défini`);
    this.params.push(Object.freeze({ name, value: value === 0 ? 0 : value }));
  }

  /** Valeur d'un paramètre ; erreur s'il est absent. */
  param(name: string): number {
    for (const p of this.params) if (p.name === name) return p.value;
    throw new Error(`Paramètre « ${name} » absent`);
  }

  /** Attache la grille du terrain (une seule fois). */
  setGrid(grid: Grid): void {
    if (this.grid !== null) throw new Error('setGrid : le monde a déjà une grille');
    this.grid = grid;
  }

  addSystem(system: System): void {
    this.systems.push(system);
  }

  createEntity(): Entity {
    if (this.entities.needsGrowth()) this.growCapacity(this.entities.capacity * 2);
    return this.entities.allocate();
  }

  /** Détruit une entité vivante : retire tous ses composants (mise à zéro), puis libère l'index. */
  destroyEntity(e: Entity): void {
    this.assertAlive(e, 'destroyEntity');
    const index = entityIndex(e);
    for (const c of this.components) c.clear(index);
    this.entities.release(index);
  }

  isAlive(e: Entity): boolean {
    return this.entities.isAlive(e);
  }

  hasComponent(e: Entity, store: ComponentStore<Schema>): boolean {
    this.assertAlive(e, 'hasComponent');
    this.assertOwned(store);
    return store.present[entityIndex(e)] === 1;
  }

  /** Ajoute le composant (champs à zéro). Erreur s'il est déjà présent. */
  addComponent(e: Entity, store: ComponentStore<Schema>): number {
    this.assertAlive(e, 'addComponent');
    this.assertOwned(store);
    const index = entityIndex(e);
    if (store.present[index] === 1) throw new Error(`addComponent : « ${store.name} » déjà présent`);
    store.present[index] = 1;
    return index;
  }

  /** Retire le composant et remet ses champs à zéro. Erreur s'il est absent. */
  removeComponent(e: Entity, store: ComponentStore<Schema>): void {
    this.assertAlive(e, 'removeComponent');
    this.assertOwned(store);
    const index = entityIndex(e);
    if (store.present[index] !== 1) throw new Error(`removeComponent : « ${store.name} » absent`);
    store.clear(index);
  }

  /**
   * Appelle fn(index) pour chaque entité possédant tous les composants demandés,
   * par index croissant, selon les règles décrites en tête de fichier.
   */
  query(stores: readonly ComponentStore<Schema>[], fn: (index: number) => void): void {
    if (stores.length === 0) throw new Error('query : au moins un composant requis');
    for (const s of stores) this.assertOwned(s);
    const a = this.entities;
    const hw = a.highWater;
    const idx = new Uint32Array(hw);
    const gen = new Uint32Array(hw);
    let n = 0;
    for (let i = 0; i < hw; i++) {
      if (a.alive[i] !== 1 || !hasAll(stores, i)) continue;
      idx[n] = i;
      gen[n] = a.generation[i]!;
      n++;
    }
    for (let k = 0; k < n; k++) {
      const i = idx[k]!;
      // Relire a.alive / a.generation à chaque visite : les tableaux peuvent avoir été
      // remplacés par une croissance de capacité pendant fn.
      if (a.alive[i] !== 1 || a.generation[i] !== gen[k] || !hasAll(stores, i)) continue;
      fn(i);
    }
  }

  private growCapacity(newCapacity: number): void {
    this.entities.grow(newCapacity);
    for (const c of this.components) c.grow(newCapacity);
  }

  private assertAlive(e: Entity, op: string): void {
    if (!this.entities.isAlive(e)) throw new Error(`${op} : poignée d'entité périmée ou invalide (${e})`);
  }

  private assertOwned(store: ComponentStore<Schema>): void {
    if (this.components[store.id] !== (store as unknown as ComponentStore)) {
      throw new Error(`Composant « ${store.name} » non enregistré dans ce monde`);
    }
  }
}

function hasAll(stores: readonly ComponentStore<Schema>[], i: number): boolean {
  for (const s of stores) if (s.present[i] !== 1) return false;
  return true;
}

/** Avance le monde d'exactement un tick : exécute les systèmes dans l'ordre d'enregistrement. */
export function step(world: World): void {
  // Longueur figée : un système ajouté pendant le tick ne s'exécute qu'au tick suivant.
  const systems = world.systems;
  const n = systems.length;
  for (let i = 0; i < n; i++) systems[i]!(world);
  world.tick++;
}
