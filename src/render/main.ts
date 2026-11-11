/**
 * Page T1 : génère le monde sur le fil principal (Web Worker reporté : la page est bloquée
 * pendant la génération, ≈ 0,5–1 s mesuré sous Node) et l'affiche : une couleur par biome,
 * rivières par-dessus, légende, ligne d'état (graine, taille, temps de génération, hash).
 * Graine lue dans l'URL : ?seed=<entier 0..4294967295> ; défaut DEFAULT_SEED.
 * Le rendu peut importer le cœur ; l'inverse est interdit.
 */
import { BIOME_COUNT, BIOME_NAMES, DEFAULT_WORLDGEN_PARAMS, generateWorld, hashWorld, World } from '../core/index.ts';
import { biomeCss, RIVER_COLOR, worldToRgba } from './palette.ts';

const DEFAULT_SEED = 20261111;

function seedFromUrl(): { seed: number; note: string } {
  const raw = new URLSearchParams(window.location.search).get('seed');
  if (raw === null) return { seed: DEFAULT_SEED, note: '' };
  const v = Number(raw);
  if (raw.trim() === '' || !Number.isInteger(v) || v < 0 || v > 0xffffffff) {
    return { seed: DEFAULT_SEED, note: ` (graine « ${raw} » invalide : entier 0..4294967295 attendu)` };
  }
  return { seed: v, note: '' };
}

const { seed, note } = seedFromUrl();
const { width, height } = DEFAULT_WORLDGEN_PARAMS;

const world = new World(seed);
const t0 = performance.now();
generateWorld(world, { width, height });
const genMs = performance.now() - t0;
const hash = hashWorld(world);

const canvas = document.querySelector<HTMLCanvasElement>('#map');
const ctx = canvas?.getContext('2d');
const status = document.querySelector<HTMLElement>('#status');
const legend = document.querySelector<HTMLElement>('#legend');
if (!canvas || !ctx || !status || !legend) throw new Error('Éléments de la page introuvables');

canvas.width = width;
canvas.height = height;
ctx.putImageData(new ImageData(worldToRgba(world.grid!), width, height), 0, 0);

status.textContent = `graine ${seed}${note} · ${width}×${height} · génération ${genMs.toFixed(0)} ms · hash ${hash}`;

const items: [string, string][] = [];
for (let b = 0; b < BIOME_COUNT; b++) items.push([biomeCss(b), BIOME_NAMES[b]!]);
items.push([`rgb(${RIVER_COLOR.join(', ')})`, 'Rivière']);
for (const [color, name] of items) {
  const li = document.createElement('li');
  const sw = document.createElement('span');
  sw.className = 'swatch';
  sw.style.background = color;
  li.append(sw, name);
  legend.append(li);
}
