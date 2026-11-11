/**
 * Exécution du cœur sous Node pur (sans Vitest, sans Vite, sans navigateur).
 * Lancement : `npm run headless [-- <graine> <ticks>]`.
 * Mécanisme : effacement natif des types de Node ≥ 22.18 (voir docs/decisions.md).
 *
 * Imprime « tick <n> hash <hex> » tous les 1 000 ticks puis le bilan de la charge.
 */

import { hashWorld, step } from '../src/core/index.ts';
import { buildWorkload, DEMO_SEED, DEMO_TICKS } from '../tests/fixtures/workload.ts';

function parseArg(raw: string | undefined, fallback: number, what: string): number {
  if (raw === undefined) return fallback;
  const v = Number(raw);
  if (!Number.isInteger(v) || v < 0) throw new Error(`${what} invalide : ${raw}`);
  return v;
}

const seed = parseArg(process.argv[2], DEMO_SEED, 'Graine');
const ticks = parseArg(process.argv[3], DEMO_TICKS, 'Nombre de ticks');

const { world, stats } = buildWorkload(seed);
console.log(`seed ${seed} ticks ${ticks}`);
console.log(`tick ${world.tick} hash ${hashWorld(world)}`);
while (world.tick < ticks) {
  step(world);
  if (world.tick % 1000 === 0 || world.tick === ticks) {
    console.log(`tick ${world.tick} hash ${hashWorld(world)}`);
  }
}
console.log(
  `created ${stats.created} destroyed ${stats.destroyed} alive ${world.entities.aliveCount} ` +
    `peak ${stats.peakPopulation} highWater ${world.entities.highWater} capacity ${world.entities.capacity} ` +
    `velocityAdded ${stats.velocityAdded} velocityRemoved ${stats.velocityRemoved}`,
);
console.log(`FINAL tick ${world.tick} hash ${hashWorld(world)}`);
