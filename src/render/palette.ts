/**
 * Conversion « monde → tampon RGBA » : module PUR (aucun DOM), partagé par la page et par
 * scripts/map-png.ts, testé sous Node. Palette originale (une couleur par biome), rivières
 * dessinées par-dessus.
 */
import { BIOME_COUNT, type Grid } from '../core/index.ts';

/** Couleurs RGB par biome, index = identifiant de biome (voir src/core/world/biomes.ts). */
export const BIOME_COLORS: readonly (readonly [number, number, number])[] = [
  [38, 70, 128], // océan
  [214, 228, 240], // banquise
  [70, 128, 186], // lac
  [246, 249, 252], // glace terrestre
  [156, 160, 134], // toundra
  [52, 96, 74], // taïga
  [190, 186, 110], // prairie / steppe tempérée
  [72, 132, 60], // forêt tempérée
  [226, 204, 146], // désert
  [196, 170, 84], // savane
  [128, 146, 58], // forêt tropicale sèche
  [24, 106, 46], // forêt tropicale humide
];

export const RIVER_COLOR: readonly [number, number, number] = [86, 150, 214];

if (BIOME_COLORS.length !== BIOME_COUNT) throw new Error('palette : une couleur par biome attendue');

/** Couleur CSS d'un biome (légende). */
export function biomeCss(id: number): string {
  const c = BIOME_COLORS[id];
  if (c === undefined) throw new RangeError(`biome inconnu ${id}`);
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** Tampon RGBA (W·H·4 octets, opaque) : couleur du biome, ou couleur de rivière si river = 1. */
export function worldToRgba(grid: Grid): Uint8ClampedArray<ArrayBuffer> {
  const biome = grid.layer('biome');
  const river = grid.layer('river');
  const out = new Uint8ClampedArray(grid.size * 4);
  for (let c = 0; c < grid.size; c++) {
    const col = river[c] === 1 ? RIVER_COLOR : BIOME_COLORS[biome[c]!];
    if (col === undefined) throw new RangeError(`cellule ${c} : biome inconnu ${biome[c]!}`);
    const o = c * 4;
    out[o] = col[0];
    out[o + 1] = col[1];
    out[o + 2] = col[2];
    out[o + 3] = 255;
  }
  return out;
}
