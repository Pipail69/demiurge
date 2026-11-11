/**
 * Critère T1 (b) : toute rivière descend strictement ou rejoint l'eau.
 *
 * Vérificateur INDÉPENDANT du code de génération : il ne lit que les couches et les paramètres
 * du monde, et réécrit lui-même la convention D8 et la formule d'apport (docs/models.md).
 */
import { describe, expect, it } from 'vitest';
import type { World } from '../src/core/ecs/world.ts';
import { generated } from './helpers/worlds.ts';

// Convention documentée (models.md § Hydrologie) : 0 E, 1 SE, 2 S, 3 SO, 4 O, 5 NO, 6 N, 7 NE ; 255 = pas d'aval.
const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];

interface Layers {
  W: number;
  H: number;
  elevation: Int32Array;
  water: Uint8Array;
  flowDir: Uint8Array;
  discharge: Uint32Array;
  river: Uint8Array;
  humidity: Uint8Array;
  runoffThreshold: number;
  riverThreshold: number;
}

function copyLayers(world: World): Layers {
  const g = world.grid!;
  return {
    W: g.width,
    H: g.height,
    elevation: g.layer('elevation').slice() as Int32Array,
    water: g.layer('water').slice() as Uint8Array,
    flowDir: g.layer('flowDir').slice() as Uint8Array,
    discharge: g.layer('discharge').slice() as Uint32Array,
    river: g.layer('river').slice() as Uint8Array,
    humidity: g.layer('humidity').slice() as Uint8Array,
    runoffThreshold: world.param('runoffHumidityThreshold'),
    riverThreshold: Math.max(1, Math.round(world.param('riverAreaFraction') * g.size * 255)),
  };
}

/** Liste des violations (vide = carte conforme). */
function verifyHydrology(L: Layers): string[] {
  const { W, H } = L;
  const N = W * H;
  const bad: string[] = [];
  const report = (s: string): void => {
    if (bad.length < 20) bad.push(s);
  };
  const down = new Int32Array(N).fill(-1);
  for (let c = 0; c < N; c++) {
    const d = L.flowDir[c]!;
    if (L.water[c] === 1) {
      if (d !== 255) report(`océan ${c} avec un aval ${d}`);
      continue;
    }
    if (d > 7) {
      report(`cellule ${c} (eau ${L.water[c]!}) sans aval`);
      continue;
    }
    const x = c % W;
    const y = (c - x) / W;
    const nx = x + DX[d]!;
    const ny = y + DY[d]!;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) {
      report(`cellule ${c} : aval hors carte`);
      continue;
    }
    const r = ny * W + nx;
    down[c] = r;
    // Toute cellule de terre (rivière ou non) : l'aval est de l'eau OU strictement plus bas.
    if (L.water[c] === 0 && L.water[r] === 0 && !(L.elevation[r]! < L.elevation[c]!)) {
      report(`terre ${c}${L.river[c] === 1 ? ' (rivière)' : ''} : aval ${r} non plus bas (${L.elevation[r]!} ≥ ${L.elevation[c]!})`);
    }
  }
  // Rivière = terre de débit ≥ seuil (et seulement elle).
  for (let c = 0; c < N; c++) {
    const expected = L.water[c] === 0 && L.discharge[c]! >= L.riverThreshold ? 1 : 0;
    if (L.river[c] !== expected) report(`cellule ${c} : river=${L.river[c]!}, attendu ${expected}`);
  }
  // Suivre l'écoulement : terre → océan ou lac ; lac → océan ; jamais de cycle.
  // state : 0 inconnu, 1 en cours, 2 atteint l'océan.
  const state = new Uint8Array(N);
  const path = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (L.water[s] === 1 || state[s] === 2) continue;
    let len = 0;
    let c = s;
    let ok = true;
    while (L.water[c] !== 1 && state[c] !== 2) {
      if (state[c] === 1 || down[c]! < 0) {
        report(`cycle ou impasse depuis ${s} (en ${c})`);
        ok = false;
        break;
      }
      state[c] = 1;
      path[len++] = c;
      c = down[c]!;
    }
    for (let i = 0; i < len; i++) state[path[i]!] = ok ? 2 : 3; // 3 : échec déjà signalé
    if (!ok) break;
  }
  // Débit exact : discharge = apport local + Σ débit des cellules amont.
  const sum = new Float64Array(N);
  for (let c = 0; c < N; c++) {
    const local = L.water[c] === 1 ? 0 : Math.max(0, L.humidity[c]! - L.runoffThreshold);
    sum[c] = sum[c]! + local;
    const r = down[c]!;
    if (r >= 0) sum[r] = sum[r]! + L.discharge[c]!;
  }
  for (let c = 0; c < N; c++) if (sum[c] !== L.discharge[c]) report(`débit ${c} : ${L.discharge[c]!} ≠ ${sum[c]!}`);
  return bad;
}

const SMALL: readonly (readonly [number, number, number])[] = [[1, 64, 64], [2, 64, 64], [3, 80, 64], [4, 64, 100], [5, 128, 128], [6, 200, 72]];

describe('Critère (b) : rivières et écoulement', () => {
  for (const [seed, w, h] of [...SMALL, [20261111, 512, 512] as const]) {
    it(`graine ${seed}, ${w}×${h} : conforme`, () => {
      const { world, stats } = generated(seed, w, h);
      const L = copyLayers(world);
      expect(verifyHydrology(L)).toEqual([]);
      expect(stats.riverThreshold).toBe(L.riverThreshold);
      if (w * h >= 128 * 128) {
        expect(stats.riverCells).toBeGreaterThan(0); // le test porte bien sur des rivières
      }
    });
  }

  it('il existe des rivières qui finissent dans l\'océan et d\'autres dans un lac (512×512)', () => {
    const L = copyLayers(generated(20261111, 512, 512).world);
    let toOcean = 0;
    let toLake = 0;
    for (let c = 0; c < L.W * L.H; c++) {
      if (L.river[c] !== 1) continue;
      const d = L.flowDir[c]!;
      const r = c + DY[d]! * L.W + DX[d]!;
      if (L.water[r] === 1) toOcean++;
      if (L.water[r] === 2) toLake++;
    }
    console.log(`[rivières] embouchures : ${toOcean} vers l'océan, ${toLake} vers un lac`);
    expect(toOcean).toBeGreaterThan(3);
    expect(toLake).toBeGreaterThan(0);
  });
});

describe('Contrôles négatifs : le vérificateur rejette les cartes corrompues', () => {
  const base = (): Layers => copyLayers(generated(5, 128, 128).world);
  const firstRiverWithLandReceiver = (L: Layers): [number, number] => {
    for (let c = 0; c < L.W * L.H; c++) {
      if (L.river[c] !== 1) continue;
      const d = L.flowDir[c]!;
      const r = c + DY[d]! * L.W + DX[d]!;
      if (L.water[r] === 0) return [c, r];
    }
    throw new Error('aucune rivière à aval terrestre');
  };

  it('carte saine acceptée (témoin)', () => {
    expect(verifyHydrology(base())).toEqual([]);
  });

  it('aval relevé (cellule aval d\'une rivière à la même altitude)', () => {
    const L = base();
    const [c, r] = firstRiverWithLandReceiver(L);
    L.elevation[r] = L.elevation[c]!;
    expect(verifyHydrology(L).some((s) => s.includes('non plus bas'))).toBe(true);
  });

  it('cycle introduit (deux cellules de terre qui s\'écoulent l\'une vers l\'autre)', () => {
    const L = base();
    const [c, r] = firstRiverWithLandReceiver(L);
    const d = L.flowDir[c]!;
    L.flowDir[r] = (d + 4) % 8; // direction opposée : r → c
    expect(verifyHydrology(L).some((s) => s.includes('cycle'))).toBe(true);
  });

  it('débit faussé d\'une unité', () => {
    const L = base();
    const [c] = firstRiverWithLandReceiver(L);
    L.discharge[c] = L.discharge[c]! + 1;
    expect(verifyHydrology(L).some((s) => s.startsWith('débit'))).toBe(true);
  });

  it('cellule d\'océan avec un aval ; lac sans aval ; drapeau rivière incohérent', () => {
    const L1 = base();
    const sea = Array.from(L1.water).indexOf(1);
    L1.flowDir[sea] = 0;
    expect(verifyHydrology(L1).length).toBeGreaterThan(0);
    const L2 = base();
    const lake = Array.from(L2.water).indexOf(2);
    if (lake >= 0) {
      L2.flowDir[lake] = 255;
      expect(verifyHydrology(L2).length).toBeGreaterThan(0);
    }
    const L3 = base();
    const land = Array.from(L3.river).indexOf(0, Array.from(L3.water).indexOf(0));
    L3.river[land] = 1;
    expect(verifyHydrology(L3).some((s) => s.includes('river='))).toBe(true);
  });
});
