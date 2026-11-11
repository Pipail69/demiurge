/**
 * Mondes générés partagés par les tests d'un même fichier (mémoïsés par graine et taille).
 * Côté tests uniquement.
 */
import { World } from '../../src/core/ecs/world.ts';
import { generateWorld, type WorldGenStats } from '../../src/core/world/generate.ts';
import type { WorldGenParams } from '../../src/core/world/params.ts';

export interface Generated {
  world: World;
  stats: WorldGenStats;
}

const cache: { key: string; value: Generated }[] = [];

export function generated(seed: number, width: number, height: number, extra: Partial<WorldGenParams> = {}): Generated {
  const key = `${seed}:${width}:${height}:${JSON.stringify(extra)}`;
  for (const e of cache) if (e.key === key) return e.value;
  const world = new World(seed);
  const stats = generateWorld(world, { width, height, ...extra });
  const value = { world, stats };
  cache.push({ key, value });
  return value;
}

/** Copie indépendante des couches (nom → tableau de nombres), pour comparer ou corrompre. */
export function layersOf(world: World): Map<string, Int32Array | Uint32Array | Int16Array | Uint8Array> {
  const out = new Map<string, Int32Array | Uint32Array | Int16Array | Uint8Array>();
  for (const l of world.grid!.layers) out.set(l.name, l.data.slice() as Int32Array);
  return out;
}
