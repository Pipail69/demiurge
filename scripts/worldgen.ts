/**
 * Génère un monde sous Node pur et imprime le temps de génération, le hash et les statistiques.
 * Usage : npm run worldgen -- <graine> <largeur> <hauteur>
 * (défauts : 20261111 512 512). L'horloge est lue ICI, jamais dans le cœur.
 */
import { BIOME_KEYS, generateWorld, hashWorld, World } from '../src/core/index.ts';

function arg(i: number, fallback: number, what: string): number {
  const raw = process.argv[i];
  if (raw === undefined) return fallback;
  const v = Number(raw);
  if (!Number.isInteger(v) || v < 0) throw new Error(`${what} invalide : ${raw}`);
  return v;
}

const seed = arg(2, 20261111, 'Graine');
const width = arg(3, 512, 'Largeur');
const height = arg(4, 512, 'Hauteur');

const world = new World(seed);
const t0 = performance.now();
const stats = generateWorld(world, { width, height });
const genMs = performance.now() - t0;
const t1 = performance.now();
const hash = hashWorld(world);
const hashMs = performance.now() - t1;

const pct = (x: number): string => `${(100 * x).toFixed(2)} %`;
console.log(`seed ${seed} size ${width}x${height}`);
console.log(`generation ${genMs.toFixed(1)} ms ; hash ${hashMs.toFixed(1)} ms`);
console.log(`terre ${pct(stats.landFraction)} ; océan ${pct(stats.oceanFraction)} ; lacs ${pct(stats.lakeFraction)} ; ` +
  `rivières ${stats.riverCells} cellules (seuil ${stats.riverThreshold})`);
console.log(`altitudes ${stats.minElevation} .. ${stats.maxElevation} cm ; érodé ${stats.erodedTotal} ; comblé ${stats.filledTotal} ; ` +
  `Σ init ${stats.elevationSumInitial} ; Σ final ${stats.elevationSumFinal} ; niveau de la mer relevé au bord : ${stats.seaLevelClamped}`);
console.log(`biomes ${stats.biomeCounts.map((n, b) => `${BIOME_KEYS[b]!}=${n}`).join(' ')}`);
console.log(`tirages PRNG ${stats.rngDraws}`);
console.log(`HASH ${hash}`);
