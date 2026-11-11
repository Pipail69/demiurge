/**
 * Conversion monde → tampon RGBA (src/render/palette.ts), module pur testé sous Node.
 */
import { describe, expect, it } from 'vitest';
import { BIOME_COUNT } from '../src/core/world/biomes.ts';
import { BIOME_COLORS, biomeCss, RIVER_COLOR, worldToRgba } from '../src/render/palette.ts';
import { generated } from './helpers/worlds.ts';

describe('Palette', () => {
  it('une couleur par biome, toutes distinctes entre elles et de la couleur des rivières', () => {
    expect(BIOME_COLORS).toHaveLength(BIOME_COUNT);
    const keys = new Set([...BIOME_COLORS, RIVER_COLOR].map((c) => c.join(',')));
    expect(keys.size).toBe(BIOME_COUNT + 1);
    for (const c of BIOME_COLORS) for (const v of c) expect(Number.isInteger(v) && v >= 0 && v <= 255).toBe(true);
    expect(biomeCss(0)).toBe(`rgb(${BIOME_COLORS[0]!.join(', ')})`);
    expect(() => biomeCss(BIOME_COUNT)).toThrow(RangeError);
  });

  for (const [seed, w, h] of [[1, 128, 128], [2, 200, 72]] as const) {
    it(`graine ${seed}, ${w}×${h} : taille W·H·4, chaque pixel = rivière ou couleur du biome de sa cellule, opaque`, () => {
      const g = generated(seed, w, h).world.grid!;
      const rgba = worldToRgba(g);
      expect(rgba).toBeInstanceOf(Uint8ClampedArray);
      expect(rgba.length).toBe(w * h * 4);
      const biome = g.layer('biome');
      const river = g.layer('river');
      let rivers = 0;
      for (let c = 0; c < g.size; c++) {
        const expected = river[c] === 1 ? RIVER_COLOR : BIOME_COLORS[biome[c]!]!;
        if (river[c] === 1) rivers++;
        const px = [rgba[4 * c], rgba[4 * c + 1], rgba[4 * c + 2], rgba[4 * c + 3]];
        if (px.join() !== [...expected, 255].join()) throw new Error(`pixel ${c} : ${px.join()} ≠ ${expected.join()}`);
      }
      expect(rivers).toBeGreaterThan(0);
    });
  }
});
