/**
 * Charge de test / de démonstration — PAS du contenu de jeu.
 *
 * Sert à rendre les tests de déterminisme non triviaux : 3 composants, des systèmes qui
 * consomment le PRNG, déplacent, font naître et mourir des entités, ajoutent et retirent
 * des composants, de sorte que population, recyclage d'index et croissance de capacité
 * soient réellement sollicités. Partagée entre Vitest et `npm run headless`.
 *
 * Tous les paramètres numériques ici sont arbitraires (charge de test, voir decisions.md).
 */

import { World, type System } from '../../src/core/index.ts';

export const DEMO_SEED = 20261111;
export const DEMO_TICKS = 10_000;

export const ARENA_SIZE = 100;
export const MAX_POPULATION = 400;

export interface WorkloadStats {
  created: number;
  destroyed: number;
  velocityAdded: number;
  velocityRemoved: number;
  peakPopulation: number;
}

export interface Workload {
  world: World;
  stats: WorkloadStats;
}

export interface WorkloadOptions {
  /** Inverse l'ordre d'enregistrement des systèmes (contrôle négatif). */
  reverseSystems?: boolean;
  initialCapacity?: number;
}

/** Ramène v dans [0, ARENA_SIZE) en float32. */
function wrap(v: number): number {
  let r = Math.fround(v);
  if (r < 0) r = Math.fround(r + ARENA_SIZE);
  else if (r >= ARENA_SIZE) r = Math.fround(r - ARENA_SIZE);
  return r;
}

export function buildWorkload(seed: number, options: WorkloadOptions = {}): Workload {
  const world = new World(seed, options.initialCapacity === undefined ? {} : { initialCapacity: options.initialCapacity });
  const Position = world.registerComponent('Position', { x: 'f32', y: 'f32' });
  const Velocity = world.registerComponent('Velocity', { dx: 'f32', dy: 'f32' });
  const Energy = world.registerComponent('Energy', { value: 'i32', age: 'u16' });

  const stats: WorkloadStats = { created: 0, destroyed: 0, velocityAdded: 0, velocityRemoved: 0, peakPopulation: 0 };

  const giveVelocity = (index: number): void => {
    Velocity.fields.dx[index] = world.rng.nextFloat() - 0.5;
    Velocity.fields.dy[index] = world.rng.nextFloat() - 0.5;
  };

  // Naissances : 0..4 par tick (moyenne 2), tant que la population est sous le plafond.
  const spawn: System = (w) => {
    const births = w.rng.nextInt(5);
    for (let k = 0; k < births && w.entities.aliveCount < MAX_POPULATION; k++) {
      const e = w.createEntity();
      const i = w.addComponent(e, Position);
      Position.fields.x[i] = w.rng.nextFloat() * ARENA_SIZE;
      Position.fields.y[i] = w.rng.nextFloat() * ARENA_SIZE;
      w.addComponent(e, Energy);
      Energy.fields.value[i] = 40 + w.rng.nextInt(60);
      if (w.rng.nextInt(2) === 0) {
        w.addComponent(e, Velocity);
        giveVelocity(i);
        stats.velocityAdded++;
      }
      stats.created++;
    }
    if (w.entities.aliveCount > stats.peakPopulation) stats.peakPopulation = w.entities.aliveCount;
  };

  // Déplacement : position += vitesse, dans une arène torique.
  const move: System = (w) => {
    w.query([Position, Velocity], (i) => {
      Position.fields.x[i] = wrap(Position.fields.x[i]! + Velocity.fields.dx[i]!);
      Position.fields.y[i] = wrap(Position.fields.y[i]! + Velocity.fields.dy[i]!);
    });
  };

  // Métabolisme : l'énergie baisse de 1 ou 2 par tick, plus si l'entité se déplace ;
  // mort (destruction) à énergie ≤ 0.
  const metabolize: System = (w) => {
    w.query([Energy], (i) => {
      const cost = 1 + w.rng.nextInt(2) + Velocity.present[i]!;
      Energy.fields.value[i] = Energy.fields.value[i]! - cost;
      Energy.fields.age[i] = Energy.fields.age[i]! + 1;
      if (Energy.fields.value[i]! <= 0) {
        w.destroyEntity(w.entities.handleOf(i));
        stats.destroyed++;
      }
    });
  };

  // Bascule : 1 chance sur 20 par tick d'ajouter ou de retirer la vitesse.
  const toggle: System = (w) => {
    w.query([Position], (i) => {
      if (w.rng.nextInt(20) !== 0) return;
      const e = w.entities.handleOf(i);
      if (Velocity.present[i] === 1) {
        w.removeComponent(e, Velocity);
        stats.velocityRemoved++;
      } else {
        w.addComponent(e, Velocity);
        giveVelocity(i);
        stats.velocityAdded++;
      }
    });
  };

  const systems = [spawn, move, metabolize, toggle];
  if (options.reverseSystems === true) systems.reverse();
  for (const s of systems) world.addSystem(s);
  return { world, stats };
}
