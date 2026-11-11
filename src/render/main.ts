/**
 * Stub de rendu T0 : crée un monde (vide : aucun contenu de jeu en T0), avance quelques
 * ticks et écrit le tick et le hash sur un canvas. Rien de plus.
 * Le rendu peut importer le cœur ; l'inverse est interdit.
 */
import { hashWorld, step, World } from '../core/index.ts';

const SEED = 1;
const TICKS = 60;

const world = new World(SEED);
for (let t = 0; t < TICKS; t++) step(world);

const canvas = document.querySelector<HTMLCanvasElement>('#view');
const ctx = canvas?.getContext('2d');
if (!canvas || !ctx) throw new Error('Canvas 2D indisponible');
ctx.fillStyle = '#111';
ctx.fillRect(0, 0, canvas.width, canvas.height);
ctx.fillStyle = '#eee';
ctx.font = '14px monospace';
ctx.fillText(`seed ${SEED}  tick ${world.tick}`, 12, 28);
ctx.fillText(`hash ${hashWorld(world)}`, 12, 56);
