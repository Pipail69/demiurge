/**
 * Grille du terrain, paramètres du monde et format de hash v2 (docs/models.md § 4 et § Grille).
 */
import { describe, expect, it } from 'vitest';
import { Grid, LAYER_TYPES, type LayerType } from '../src/core/grid.ts';
import { hashWorld, HASH_FORMAT_VERSION } from '../src/core/hash.ts';
import { World } from '../src/core/ecs/world.ts';

/** Les 9 couches de T1, dans l'ordre de generateWorld. */
const T1_LAYERS: readonly (readonly [string, LayerType])[] = [
  ['elevation', 'i32'], ['waterSurface', 'i32'], ['water', 'u8'], ['flowDir', 'u8'], ['discharge', 'u32'],
  ['river', 'u8'], ['temperatureMean', 'i16'], ['humidity', 'u8'], ['biome', 'u8'],
];

function worldWithGrid(w = 5, h = 3, layers = T1_LAYERS, params: readonly (readonly [string, number])[] = [['a', 1.5], ['b', -2]]) {
  const world = new World(7);
  for (const [n, v] of params) world.addParam(n, v);
  const grid = new Grid(w, h);
  for (const [n, t] of layers) grid.addLayer(n, t);
  // Données non triviales et déterministes : valeur = f(index de couche, cellule).
  grid.layers.forEach((l, li) => {
    for (let c = 0; c < grid.size; c++) l.data[c] = (li * 31 + c * 7) % 50;
  });
  world.setGrid(grid);
  return { world, grid };
}

describe('Grille', () => {
  it('dimensions, index y·W + x, couches entières uniquement, ordre d\'enregistrement conservé', () => {
    const g = new Grid(4, 3);
    expect(g.size).toBe(12);
    expect(g.index(3, 2)).toBe(11);
    const a = g.addLayer('zeta', 'u8');
    const b = g.addLayer('alpha', 'i32');
    expect(a).toBeInstanceOf(Uint8Array);
    expect(b).toBeInstanceOf(Int32Array);
    expect(a.length).toBe(12);
    expect(g.layers.map((l) => l.name)).toEqual(['zeta', 'alpha']); // pas de tri : ordre d'ajout
    expect(g.layer('alpha')).toBe(b);
    expect(LAYER_TYPES).toEqual(['i8', 'i16', 'i32', 'u8', 'u16', 'u32']);
  });

  it('refus : dimensions invalides, nom en double ou non ASCII, type flottant, couche absente', () => {
    for (const [w, h] of [[0, 3], [3, 0], [1.5, 2], [5000, 2], [Number.NaN, 2]] as const) {
      expect(() => new Grid(w, h), `${w}×${h}`).toThrow(RangeError);
    }
    const g = new Grid(2, 2);
    g.addLayer('x', 'u8');
    expect(() => g.addLayer('x', 'u8')).toThrow(/déjà/);
    expect(() => g.addLayer('é', 'u8')).toThrow(/invalide/);
    expect(() => g.addLayer('f', 'f32' as LayerType)).toThrow(/non entier/);
    expect(() => g.layer('absent')).toThrow(/absente/);
  });

  it('paramètres du monde : liste ordonnée, nom unique ASCII, valeur finie, −0 normalisé', () => {
    const w = new World(1);
    w.addParam('b', 2);
    w.addParam('a', -0);
    expect(w.params.map((p) => p.name)).toEqual(['b', 'a']);
    expect(Object.is(w.param('a'), 0)).toBe(true);
    expect(() => w.addParam('b', 3)).toThrow(/déjà/);
    expect(() => w.addParam('c', Number.NaN)).toThrow(RangeError);
    expect(() => w.addParam('c', Infinity)).toThrow(RangeError);
    expect(() => w.addParam('c d', 1)).toThrow(/invalide/);
    expect(() => w.param('zz')).toThrow(/absent/);
    expect(() => w.setGrid(new Grid(1, 1))).not.toThrow();
    expect(() => w.setGrid(new Grid(1, 1))).toThrow(/déjà/);
  });
});

describe('Hash v2 : sensibilité par section', () => {
  it('version du format = 2', () => {
    expect(HASH_FORMAT_VERSION).toBe(2);
  });

  it('une cellule modifiée dans CHAQUE couche (première, milieu et dernière cellule) change le hash', () => {
    const h0 = hashWorld(worldWithGrid().world);
    const seen = new Set([h0]);
    let variants = 0;
    for (let li = 0; li < T1_LAYERS.length; li++) {
      for (const pick of ['first', 'middle', 'last'] as const) {
        const { world, grid } = worldWithGrid();
        const data = grid.layers[li]!.data;
        const c = pick === 'first' ? 0 : pick === 'middle' ? 7 : grid.size - 1;
        data[c] = data[c]! + 1;
        const h = hashWorld(world);
        expect(h, `${T1_LAYERS[li]![0]} / ${pick}`).not.toBe(h0);
        seen.add(h);
        variants++;
      }
    }
    expect(seen.size).toBe(variants + 1);
  });

  it('largeur et hauteur échangées à données identiques → hash différent', () => {
    const a = worldWithGrid(5, 3).world;
    const b = worldWithGrid(3, 5).world;
    for (let li = 0; li < T1_LAYERS.length; li++) {
      expect(Array.from(b.grid!.layers[li]!.data)).toEqual(Array.from(a.grid!.layers[li]!.data));
    }
    expect(hashWorld(a)).not.toBe(hashWorld(b));
  });

  it('nom de couche, type de couche (mêmes octets), nombre de couches', () => {
    const h0 = hashWorld(worldWithGrid().world);
    const renamed = T1_LAYERS.map(([n, t], i) => [i === 4 ? 'dischargX' : n, t] as const);
    // Même taille d'élément et mêmes valeurs (< 50) : seul le type change.
    const retyped = T1_LAYERS.map(([n, t], i) => [n, i === 7 ? ('i8' as LayerType) : t] as const);
    const fewer = T1_LAYERS.slice(0, -1);
    const hs = [renamed, retyped, fewer].map((ls) => hashWorld(worldWithGrid(5, 3, ls).world));
    for (const h of hs) expect(h).not.toBe(h0);
    expect(new Set([h0, ...hs]).size).toBe(4);
  });

  it('paramètres : valeur, nom, ordre, nombre ; valeur 1e-12 près', () => {
    const base: [string, number][] = [['a', 1.5], ['b', -2]];
    const h0 = hashWorld(worldWithGrid(5, 3, T1_LAYERS, base).world);
    const variants: [string, number][][] = [
      [['a', 1.5 + 1e-12], ['b', -2]],
      [['a', 1.5], ['c', -2]],
      [['b', -2], ['a', 1.5]],
      [['a', 1.5]],
      [['a', 1.5], ['b', -2], ['z', 0]],
    ];
    const hs = variants.map((v) => hashWorld(worldWithGrid(5, 3, T1_LAYERS, v).world));
    for (const h of hs) expect(h).not.toBe(h0);
    expect(new Set([h0, ...hs]).size).toBe(variants.length + 1);
  });

  it('monde sans grille ≠ monde avec grille vide (sans couche) ; un monde sans grille reste hachable', () => {
    const none = new World(7);
    const empty = new World(7);
    empty.setGrid(new Grid(1, 1));
    expect(hashWorld(none)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashWorld(none)).not.toBe(hashWorld(empty));
    const empty2 = new World(7);
    empty2.setGrid(new Grid(2, 1));
    expect(hashWorld(empty2)).not.toBe(hashWorld(empty)); // dimensions hachées même sans couche
  });

  it('deux mondes construits à l\'identique ont le même hash ; le hash ne modifie pas la grille', () => {
    const a = worldWithGrid();
    const before = a.grid.layers.map((l) => Array.from(l.data));
    expect(hashWorld(a.world)).toBe(hashWorld(worldWithGrid().world));
    expect(a.grid.layers.map((l) => Array.from(l.data))).toEqual(before);
  });
});
