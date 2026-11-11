/**
 * Critère T1 (c) : aucun biome incohérent avec ses variables.
 *
 * Le vérificateur N'UTILISE PAS classifyBiome (ce serait tautologique) : il applique une table
 * déclarative INDÉPENDANTE de contraintes physiques par biome, plus larges que les seuils de
 * classification (une contrainte dit ce qui serait absurde, pas où passe la frontière).
 */
import { describe, expect, it } from 'vitest';
import {
  BIOME_COUNT, BIOME_DESERT, BIOME_ICE, BIOME_KEYS, BIOME_NAMES, BIOME_RAINFOREST, BIOME_TAIGA, classifyBiome,
} from '../src/core/world/biomes.ts';
import { DEFAULT_WORLDGEN_PARAMS as D } from '../src/core/world/params.ts';
import { generated } from './helpers/worlds.ts';

/** Bornes en °C (pas en centièmes) et en humidité 0..255 ; water : 0 terre, 1 océan, 2 lac. */
interface Constraint {
  water: number;
  minC?: number;
  maxC?: number;
  minH?: number;
  maxH?: number;
}

/**
 * Table indépendante, écrite d'après le sens physique de chaque biome (Whittaker : axes
 * température × précipitations ; eau de mer gelée sous ≈ −1,9 °C) :
 */
const CONSTRAINTS: Record<string, Constraint> = {
  ocean: { water: 1, minC: -1.9 }, // eau de mer liquide en moyenne annuelle
  seaIce: { water: 1, maxC: -1.5 }, // banquise : pas au-dessus du point de congélation de l'eau de mer
  lake: { water: 2 },
  ice: { water: 0, maxC: -5 }, // glace permanente : jamais au-dessus de −5 °C en moyenne annuelle
  tundra: { water: 0, maxC: 2 }, // toundra : climat froid
  taiga: { water: 0, minC: -6, maxC: 8, minH: 20 }, // forêt boréale : froid mais pas glacial, pas aride
  grassland: { water: 0, minC: -5, maxC: 25, minH: 20 }, // steppe tempérée : semi-aride à sub-humide
  temperateForest: { water: 0, minC: 0, maxC: 25, minH: 80 }, // forêt tempérée : humide, tempéré
  desert: { water: 0, minC: -5, maxH: 60 }, // désert : sec (chaud ou froid, pas glacial)
  savanna: { water: 0, minC: 15, minH: 20, maxH: 140 }, // savane : chaud, saisonnièrement sec
  tropicalDryForest: { water: 0, minC: 15, minH: 60, maxH: 220 }, // forêt tropicale sèche : chaud, intermédiaire
  rainforest: { water: 0, minC: 18, minH: 150 }, // forêt tropicale humide : chaud ET très humide
};

/** Renvoie la liste des violations (vide si la carte est cohérente). Ne lit que les couches. */
function verifyBiomes(water: ArrayLike<number>, temp: ArrayLike<number>, hum: ArrayLike<number>, biome: ArrayLike<number>): string[] {
  const bad: string[] = [];
  for (let c = 0; c < biome.length; c++) {
    const key = BIOME_KEYS[biome[c]!];
    if (key === undefined) {
      bad.push(`cellule ${c} : biome inconnu ${biome[c]!}`);
      continue;
    }
    const k = CONSTRAINTS[key]!;
    const t = temp[c]! / 100;
    const h = hum[c]!;
    const why: string[] = [];
    if (water[c] !== k.water) why.push(`water=${water[c]!}`);
    if (k.minC !== undefined && t < k.minC) why.push(`T=${t} < ${k.minC}`);
    if (k.maxC !== undefined && t > k.maxC) why.push(`T=${t} > ${k.maxC}`);
    if (k.minH !== undefined && h < k.minH) why.push(`H=${h} < ${k.minH}`);
    if (k.maxH !== undefined && h > k.maxH) why.push(`H=${h} > ${k.maxH}`);
    if (why.length > 0 && bad.length < 20) bad.push(`cellule ${c} (${key}) : ${why.join(', ')}`);
    else if (why.length > 0) bad.push('…');
  }
  return bad;
}

function layers(seed: number, w: number, h: number) {
  const g = generated(seed, w, h).world.grid!;
  return { water: g.layer('water'), temp: g.layer('temperatureMean'), hum: g.layer('humidity'), biome: g.layer('biome') };
}

describe('Classification des biomes', () => {
  it('liste : 12 biomes, clés et noms alignés, une contrainte indépendante par biome', () => {
    expect(BIOME_COUNT).toBe(12);
    expect(BIOME_NAMES).toHaveLength(BIOME_COUNT);
    expect(Object.keys(CONSTRAINTS).sort()).toEqual([...BIOME_KEYS].sort());
  });

  it('fonction TOTALE : tout (eau, T ∈ i16 entier, H ∈ 0..255) donne exactement un biome valide', () => {
    // Balayage exhaustif de T (pas 1) sur [−100 °C, +100 °C] et par pas de 97 sur tout l'intervalle i16.
    const temps: number[] = [];
    for (let t = -10000; t <= 10000; t++) temps.push(t);
    for (let t = -32768; t <= 32767; t += 97) temps.push(t);
    temps.push(-32768, 32767);
    const seen = new Uint32Array(BIOME_COUNT);
    let n = 0;
    for (const w of [0, 1, 2]) {
      for (const t of temps) {
        for (let h = 0; h <= 255; h++) {
          const b = classifyBiome(w, t, h, D);
          if (!(Number.isInteger(b) && b >= 0 && b < BIOME_COUNT)) throw new Error(`hors domaine : ${w}, ${t}, ${h} → ${b}`);
          seen[b]!++;
          n++;
        }
      }
    }
    expect(n).toBe(3 * temps.length * 256);
    for (let b = 0; b < BIOME_COUNT; b++) expect(seen[b], BIOME_KEYS[b]).toBeGreaterThan(0); // chaque biome atteignable
  });

  it('la classification par défaut respecte la table indépendante sur la plage réaliste (−60..+45 °C)', () => {
    const t: number[] = [];
    const hh: number[] = [];
    const ww: number[] = [];
    const bb: number[] = [];
    for (const w of [0, 1, 2]) {
      for (let tc = -6000; tc <= 4500; tc += 5) {
        for (let h = 0; h <= 255; h++) {
          ww.push(w);
          t.push(tc);
          hh.push(h);
          bb.push(classifyBiome(w, tc, h, D));
        }
      }
    }
    expect(verifyBiomes(ww, t, hh, bb)).toEqual([]);
  });

  it('cas témoins : glace à −20 °C, désert à humidité 10 et 30 °C, forêt humide à 27 °C / 230, taïga à 0 °C / 150', () => {
    expect(classifyBiome(0, -2000, 100, D)).toBe(BIOME_ICE);
    expect(classifyBiome(0, 3000, 10, D)).toBe(BIOME_DESERT);
    expect(classifyBiome(0, 2700, 230, D)).toBe(BIOME_RAINFOREST);
    expect(classifyBiome(0, 0, 150, D)).toBe(BIOME_TAIGA);
  });

  it('frontières exactes (égalités de seuil) : chaque seuil appartient au bon côté', () => {
    // Seuils par défaut : banquise T ≤ −190 ; glace T < −1000 ; toundra T < −200 ; désert H < 40 ;
    // taïga T < 400 ; tropical T ≥ 2000 ; forêt tempérée H ≥ 110 ; forêt sèche H ≥ 100 ; humide H ≥ 180.
    expect(classifyBiome(1, -190, 0, D)).toBe(1);
    expect(classifyBiome(1, -189, 0, D)).toBe(0);
    expect(classifyBiome(0, -1001, 200, D)).toBe(BIOME_ICE);
    expect(classifyBiome(0, -1000, 200, D)).toBe(4); // toundra
    expect(classifyBiome(0, -200, 200, D)).toBe(BIOME_TAIGA);
    expect(classifyBiome(0, -201, 200, D)).toBe(4);
    expect(classifyBiome(0, 1000, 39, D)).toBe(BIOME_DESERT);
    expect(classifyBiome(0, 1000, 40, D)).toBe(6); // prairie
    expect(classifyBiome(0, 399, 150, D)).toBe(BIOME_TAIGA);
    expect(classifyBiome(0, 400, 150, D)).toBe(7); // forêt tempérée
    expect(classifyBiome(0, 1000, 109, D)).toBe(6);
    expect(classifyBiome(0, 1000, 110, D)).toBe(7);
    expect(classifyBiome(0, 1999, 50, D)).toBe(6);
    expect(classifyBiome(0, 2000, 50, D)).toBe(9); // savane
    expect(classifyBiome(0, 2500, 99, D)).toBe(9);
    expect(classifyBiome(0, 2500, 100, D)).toBe(10); // forêt tropicale sèche
    expect(classifyBiome(0, 2500, 179, D)).toBe(10);
    expect(classifyBiome(0, 2500, 180, D)).toBe(BIOME_RAINFOREST);
    expect(classifyBiome(2, 5000, 0, D)).toBe(2); // lac quelle que soit la température
  });
});

describe('Critère (c) sur des cartes générées', () => {
  for (const [seed, w, h] of [[1, 128, 128], [2, 160, 96], [3, 96, 160], [20261111, 512, 512]] as const) {
    it(`graine ${seed}, ${w}×${h} : aucune cellule incohérente`, () => {
      const L = layers(seed, w, h);
      expect(verifyBiomes(L.water, L.temp, L.hum, L.biome)).toEqual([]);
      // La carte n'est pas triviale : au moins 6 biomes présents.
      expect(new Set(Array.from(L.biome)).size).toBeGreaterThanOrEqual(6);
    });
  }

  it('contrôle négatif : une carte corrompue (glace à 25 °C, forêt humide dans le désert, banquise tiède) est rejetée', () => {
    const L = layers(1, 128, 128);
    const land = Array.from(L.water).findIndex((v) => v === 0);
    const sea = Array.from(L.water).findIndex((v) => v === 1);
    const corrupt = (f: (b: Uint8Array, t: Int16Array, h: Uint8Array) => void): string[] => {
      const b = L.biome.slice() as Uint8Array;
      const t = L.temp.slice() as Int16Array;
      const h = L.hum.slice() as Uint8Array;
      f(b, t, h);
      return verifyBiomes(L.water, t, h, b);
    };
    expect(corrupt((b, t) => { b[land] = BIOME_ICE; t[land] = 2500; })).toHaveLength(1);
    expect(corrupt((b, t, h) => { b[land] = BIOME_RAINFOREST; t[land] = 2700; h[land] = 5; })).toHaveLength(1);
    expect(corrupt((b, t) => { b[sea] = 1; t[sea] = 1500; })).toHaveLength(1);
    expect(corrupt((b) => { b[sea] = BIOME_DESERT; })).toHaveLength(1); // désert sur l'océan
  });
});
