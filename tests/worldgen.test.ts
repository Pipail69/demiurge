/**
 * Génération du monde (T1) : critères (a) déterminisme et (d) performance, monde-île, fraction
 * de terres, bilan de masse, paramètres hachés, tailles variées, API.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { step, World } from '../src/core/ecs/world.ts';
import { hashWorld } from '../src/core/hash.ts';
import { sha256Hex } from '../src/core/sha256.ts';
import { BIOME_COUNT } from '../src/core/world/biomes.ts';
import { generateWorld, WORLDGEN_STAGES } from '../src/core/world/generate.ts';
import { DEFAULT_WORLDGEN_PARAMS, PARAM_NAMES } from '../src/core/world/params.ts';
import { generated } from './helpers/worlds.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function layerChecksums(world: World): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of world.grid!.layers) out[l.name] = sha256Hex(new Uint8Array(l.data.buffer, l.data.byteOffset, l.data.byteLength));
  return out;
}

function isBorderCell(c: number, w: number, h: number): boolean {
  const x = c % w;
  const y = (c - x) / w;
  return x === 0 || y === 0 || x === w - 1 || y === h - 1;
}

describe('Critère (a) : déterminisme de la génération', () => {
  it('même graine → mêmes couches et même hash (deux générations indépendantes, 128×96)', () => {
    const a = new World(31);
    const b = new World(31);
    const sa = generateWorld(a, { width: 128, height: 96 });
    const sb = generateWorld(b, { width: 128, height: 96 });
    expect(sb).toEqual(sa);
    for (let i = 0; i < a.grid!.layers.length; i++) {
      expect(Array.from(b.grid!.layers[i]!.data)).toEqual(Array.from(a.grid!.layers[i]!.data));
    }
    expect(hashWorld(b)).toBe(hashWorld(a));
  });

  it('graines différentes → COUCHES différentes (données comparées, pas seulement le hash qui contient la graine)', () => {
    const a = generated(1, 128, 128).world.grid!;
    const b = generated(2, 128, 128).world.grid!;
    for (const name of ['elevation', 'water', 'humidity', 'biome', 'flowDir', 'temperatureMean']) {
      const da = a.layer(name);
      const db = b.layer(name);
      let diff = 0;
      for (let c = 0; c < a.size; c++) if (da[c] !== db[c]) diff++;
      expect(diff, name).toBeGreaterThan(a.size * 0.05);
    }
  });

  it('processus Node séparé (npm run worldgen, hors Vitest) → même hash que sous Vitest (64×64 et 160×96)', () => {
    for (const [w, h] of [[64, 64], [160, 96]] as const) {
      const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'worldgen.ts'), '20261111', String(w), String(h)], {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, NODE_OPTIONS: '' },
      });
      const m = /^HASH ([0-9a-f]{64})$/m.exec(out);
      expect(m, out).not.toBeNull();
      expect(m![1]).toBe(hashWorld(generated(20261111, w, h).world));
    }
  });

  /*
   * VALEURS ÉPINGLÉES (2026-11-11, T1, paramètres par défaut). Tout changement = changement du
   * format de hash, du PRNG, du pipeline ou d'un paramètre par défaut : à justifier dans
   * docs/decisions.md, puis à mettre à jour ici, dans STATE.md et dans le rapport.
   * Les sommes de contrôle par couche localisent l'étape fautive en cas d'écart.
   */
  it('hash et sommes de contrôle épinglés : graine 20261111, 64×64', () => {
    const { world, stats } = generated(20261111, 64, 64);
    expect(layerChecksums(world)).toEqual({
      elevation: '2322f3936d594ea66f78988427b284c405a23cc2c5227de13123fcfec5c647c2',
      waterSurface: '2608c6367ecfddc3d204c1fce233f12b80def0d682160c9bb64198bd126091e7',
      water: '71c0ee9f308ad37c96e7855c665e1d632bdcf2cf6a644548478374fc2f0b90ba',
      flowDir: '7d9acb68e8988f815ceb0b4dd8a2b89dc76b5aeebfcd5d32a40c79260ea2f960',
      discharge: 'a3fc28392c28568dbb7e1e8a4191a3c70d88d01a25f41dbe5e5eed97f72f04aa',
      river: '997643394f11fac481be07837ba697482eb55c8b793f65cbb262a5d5b78431a2',
      temperatureMean: '3da2f79465d02661e6b0939d289e5afdfcfcaa443fc8c2f7def5396b31f692a6',
      humidity: 'b6994b6f4a1c9b3d51672625cf4a9b18d8108a26e8069334da6064d6cb1c887d',
      biome: '8ca8061ebc1210a7675fa2940b1bd95ebc6713a9d9b6ac60e563b7bad2625c56',
    });
    expect({ land: stats.landCells, ocean: stats.oceanCells, lake: stats.lakeCells, river: stats.riverCells,
      eroded: stats.erodedTotal, filled: stats.filledTotal, draws: stats.rngDraws }).toEqual(
      { land: 1639, ocean: 2457, lake: 0, river: 213, eroded: 659923, filled: 76740, draws: 50701 });
    expect(hashWorld(world)).toBe('3ef9b72335e2f34f44ba3333ea99a403886d7cf87a52d379e73ba63076e607f9');
  });

  it('hash et sommes de contrôle épinglés : graine 20261111, 512×512', () => {
    const { world, stats } = generated(20261111, 512, 512);
    expect(layerChecksums(world)).toEqual({
      elevation: 'e8594df9ff91d1402513dafc70dce7c56635f15e28e817c4d5dd534f8177cb49',
      waterSurface: '2b59de68b9724c7269b7e3a7c978c3faa67106acbaba688471ababd34d4a49ff',
      water: '5aec62a48516c9bd7c92aba777f52edacf125bd7ab4da018a15f1702c3f1e4cc',
      flowDir: 'd33fcee69a52b4cadc4b81cd2bf4b6b31b27044ec97ae2e5e18f6ce68d80d258',
      discharge: '78365e1b9510e51234f57679487ef3f1b9d1dc9b746e011dca050fe2f4582c61',
      river: '5fcedf091926e56110e01192c099f441b840c9d7289dd5c46f76a802cffcdc09',
      temperatureMean: 'ae0996153b9706dddc59737a60d619070df17d3f132bcf22cb4a239be26f9a0f',
      humidity: '961fe326285ba052d7fa0a19fddefbdfb7e25b62c82aed906ea757ec8c308da8',
      biome: '2b3769c522a7329dffe8a250d9ea80cde8a4c739a8ccf6ec0e3192cdf2b20f64',
    });
    expect({ land: stats.landCells, ocean: stats.oceanCells, lake: stats.lakeCells, river: stats.riverCells,
      eroded: stats.erodedTotal, filled: stats.filledTotal, draws: stats.rngDraws }).toEqual(
      { land: 102395, ocean: 157138, lake: 2611, river: 1258, eroded: 11643165, filled: 847914, draws: 50701 });
    expect(hashWorld(world)).toBe('8cc05eedbf839f2bd948cc481afe1a804cb3db8373abd131879e0ecbaad5ab96');
  });

  it('un monde avec terrain qui avance de 5 000 ticks garde ses couches intactes', () => {
    const w = new World(77);
    generateWorld(w, { width: 64, height: 48 });
    const before = layerChecksums(w);
    for (let t = 0; t < 5000; t++) step(w);
    expect(layerChecksums(w)).toEqual(before);
  });

  it('tirages PRNG : exactement stats.rngDraws appels à nextU32 (et rien d\'autre ne tire)', () => {
    const w = new World(3);
    let draws = 0;
    const orig = w.rng.nextU32.bind(w.rng);
    w.rng.nextU32 = () => {
      draws++;
      return orig();
    };
    const s = generateWorld(w, { width: 100, height: 70 });
    expect(draws).toBe(s.rngDraws);
    expect(draws).toBeGreaterThan(1000);
  });
});

describe('Monde-île, terres, bilan de masse', () => {
  it('bordure 100 % océan sur 60 graines (48×40 et 40×56)', () => {
    for (let seed = 0; seed < 60; seed++) {
      const [w, h] = seed % 2 === 0 ? [48, 40] : [40, 56];
      const world = new World(seed);
      generateWorld(world, { width: w, height: h });
      const water = world.grid!.layer('water');
      for (let c = 0; c < w * h; c++) if (isBorderCell(c, w, h)) expect(water[c], `graine ${seed}, cellule ${c}`).toBe(1);
    }
  });

  it('fraction de terres émergées (terre + lacs) = cible ± 0,04 sur 8 graines (128×128)', () => {
    const target = DEFAULT_WORLDGEN_PARAMS.landFraction;
    for (let seed = 10; seed < 18; seed++) {
      const { stats } = generated(seed, 128, 128);
      const emerged = stats.landFraction + stats.lakeFraction;
      expect(Math.abs(emerged - target), `graine ${seed} : ${emerged}`).toBeLessThanOrEqual(0.04);
      expect(stats.seaLevelClamped).toBe(false);
    }
  });

  it('niveau de la mer relevé au bord quand la cible de terres l\'exige : bordure toujours océanique', () => {
    // Cible extrême (95 % de terres) et pas de terme de bord : le quantile tomberait sous le bord.
    for (const seed of [1, 2, 3]) {
      const w = new World(seed);
      const st = generateWorld(w, { width: 48, height: 48, landFraction: 0.95, edgeDrop: 0 });
      expect(st.seaLevelClamped, `graine ${seed}`).toBe(true);
      const water = w.grid!.layer('water');
      for (let c = 0; c < 48 * 48; c++) if (isBorderCell(c, 48, 48)) expect(water[c]).toBe(1);
      expect(st.landFraction + st.lakeFraction).toBeLessThan(0.95); // la cible n'est alors pas atteinte (documenté)
    }
  });

  it('bilan de masse EXACT : Σ final = Σ initial − érodé + comblé, recalculé depuis la couche', () => {
    for (const [seed, w, h] of [[1, 128, 128], [20261111, 512, 512]] as const) {
      const { world, stats } = generated(seed, w, h);
      const z = world.grid!.layer('elevation');
      let sum = 0;
      for (let c = 0; c < z.length; c++) sum += z[c]!;
      expect(sum).toBe(stats.elevationSumFinal);
      expect(stats.elevationSumFinal).toBe(stats.elevationSumInitial - stats.erodedTotal + stats.filledTotal);
      expect(stats.erodedTotal).toBeGreaterThan(0);
      expect(stats.filledTotal).toBeGreaterThan(0);
    }
  });

  it('cohérence des couches : surface = élévation sur terre, 0 sur l\'océan, ≥ fond sur les lacs ; océan ≤ 0 ; terre ≥ 1 cm', () => {
    const g = generated(20261111, 512, 512).world.grid!;
    const z = g.layer('elevation');
    const s = g.layer('waterSurface');
    const wat = g.layer('water');
    for (let c = 0; c < g.size; c++) {
      if (wat[c] === 0) {
        expect(s[c] === z[c] && z[c]! >= 1).toBe(true);
      } else if (wat[c] === 1) {
        expect(s[c] === 0 && z[c]! <= 0).toBe(true);
      } else {
        expect(wat[c]).toBe(2);
        expect(s[c]! - z[c]!).toBeGreaterThanOrEqual(DEFAULT_WORLDGEN_PARAMS.lakeMinDepthCm);
      }
    }
  });
});

describe('API et tailles', () => {
  it('tailles 64×64 à 512×512, cartes non carrées : génération valide et statistiques cohérentes', () => {
    for (const [w, h] of [[64, 64], [96, 200], [300, 80], [256, 256], [512, 384]] as const) {
      const { world, stats } = generated(42, w, h);
      const g = world.grid!;
      expect([g.width, g.height, g.size]).toEqual([w, h, w * h]);
      expect(stats.landCells + stats.oceanCells + stats.lakeCells).toBe(w * h);
      expect(stats.biomeCounts.reduce((a, b) => a + b, 0)).toBe(w * h);
      expect(stats.biomeCounts).toHaveLength(BIOME_COUNT);
      expect(g.layers.map((l) => `${l.name}:${l.type}`)).toEqual([
        'elevation:i32', 'waterSurface:i32', 'water:u8', 'flowDir:u8', 'discharge:u32', 'river:u8',
        'temperatureMean:i16', 'humidity:u8', 'biome:u8',
      ]);
    }
  });

  it('paramètres enregistrés dans le monde, dans l\'ordre de PARAM_NAMES, avec les valeurs utilisées', () => {
    const { world } = generated(42, 96, 200);
    expect(world.params.map((p) => p.name)).toEqual([...PARAM_NAMES]);
    expect(world.param('width')).toBe(96);
    expect(world.param('height')).toBe(200);
    expect(world.param('ticksPerYear')).toBe(DEFAULT_WORLDGEN_PARAMS.ticksPerYear);
    expect(Object.isFrozen(DEFAULT_WORLDGEN_PARAMS)).toBe(true);
  });

  it('un paramètre différent donne un hash différent (deux mondes de même hash ont le même futur)', () => {
    const a = new World(5);
    const b = new World(5);
    generateWorld(a, { width: 64, height: 64 });
    generateWorld(b, { width: 64, height: 64, ticksPerYear: DEFAULT_WORLDGEN_PARAMS.ticksPerYear + 8 });
    for (let i = 0; i < a.grid!.layers.length; i++) {
      expect(Array.from(b.grid!.layers[i]!.data)).toEqual(Array.from(a.grid!.layers[i]!.data)); // terrain identique
    }
    expect(hashWorld(a)).not.toBe(hashWorld(b)); // mais calendrier différent → hash différent
  });

  it('seuil de rivière inclusif : une cellule de débit exactement égal au seuil est une rivière', () => {
    const base = generated(12, 64, 64).world.grid!;
    const water = base.layer('water');
    const q = base.layer('discharge');
    let cell = -1;
    for (let c = 0; c < base.size; c++) if (water[c] === 0 && q[c]! > 1000 && q[c]! < 20000) { cell = c; break; }
    expect(cell).toBeGreaterThanOrEqual(0);
    const d = q[cell]!;
    const w = new World(12);
    const st = generateWorld(w, { width: 64, height: 64, riverAreaFraction: d / (64 * 64 * 255) });
    expect(st.riverThreshold).toBe(d);
    expect(w.grid!.layer('discharge')[cell]).toBe(d); // le terrain ne dépend pas de ce paramètre
    expect(w.grid!.layer('river')[cell]).toBe(1);
  });

  it('crochet onStage : toutes les étapes dans l\'ordre, puis « done » ; sans effet sur le résultat', () => {
    const stages: string[] = [];
    const w = new World(9);
    generateWorld(w, { width: 64, height: 64 }, { onStage: (s) => stages.push(s) });
    expect(stages).toEqual([...WORLDGEN_STAGES, 'done']);
    const w2 = new World(9);
    generateWorld(w2, { width: 64, height: 64 });
    expect(hashWorld(w2)).toBe(hashWorld(w));
  });

  it('refus : terrain déjà présent, tick ≠ 0, paramètres invalides', () => {
    const w = new World(1);
    generateWorld(w, { width: 32, height: 32 });
    expect(() => generateWorld(w, { width: 32, height: 32 })).toThrow(/déjà/);
    const t = new World(1);
    t.tick = 3;
    expect(() => generateWorld(t, { width: 32, height: 32 })).toThrow(/tick 0/);
    for (const bad of [{ width: 8 }, { width: 33.5 }, { landFraction: 1 }, { ticksPerYear: 100 }, { noiseOctaves: 0 }, { latNorthDeg: 95 }]) {
      expect(() => generateWorld(new World(1), { width: 32, height: 32, ...bad }), JSON.stringify(bad)).toThrow(RangeError);
    }
  });
});

describe('Critère (d) : performance 512×512', () => {
  it('5 générations 512×512, chacune < 5 s (mesurée ici ; horloge interdite dans le cœur)', () => {
    const times: number[] = [];
    for (let r = 0; r < 5; r++) {
      const t0 = performance.now();
      generateWorld(new World(20261111 + r), { width: 512, height: 512 });
      times.push(performance.now() - t0);
    }
    const s = [...times].sort((a, b) => a - b);
    console.log(`[perf] 512×512, 5 graines : min ${s[0]!.toFixed(0)} ms, médiane ${s[2]!.toFixed(0)} ms, max ${s[4]!.toFixed(0)} ms`);
    for (const t of times) expect(t).toBeLessThan(5000);
  });
});
