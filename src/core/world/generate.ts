/**
 * Génération procédurale du monde (T1). Ordre du pipeline (sans circularité) :
 *   bruit → relief → érosion → hydrologie (océan, lacs, écoulement) → température →
 *   humidité → débit → rivières → biomes.
 * Tout l'aléa vient de world.rng (tirages du bruit uniquement). Modèles : docs/models.md.
 */

import type { World } from '../ecs/world.ts';
import { Grid } from '../grid.ts';
import { classifyBiome, BIOME_COUNT, type BiomeThresholds } from './biomes.ts';
import { computeHumidity, computeTemperature, localRunoff, mixHumidityVertically } from './climate.ts';
import { erode } from './erosion.ts';
import {
  accumulate, findLakes, findOcean, flowDirections, isBorder, priorityFlood, LAKE, LAND, OCEAN,
} from './hydrology.ts';
import { Fbm } from './noise.ts';
import { PARAM_NAMES, resolveParams, type WorldGenParams } from './params.ts';

/** Noms des étapes, dans l'ordre où le crochet onStage les annonce. */
export const WORLDGEN_STAGES: readonly string[] = [
  'noise', 'relief', 'erosion', 'hydrology', 'temperature', 'humidity', 'discharge', 'rivers', 'biomes', 'store',
];

export interface WorldGenHooks {
  /**
   * Appelé au début de chaque étape (nom de WORLDGEN_STAGES), puis avec 'done'. Sert à mesurer
   * les étapes DEPUIS L'EXTÉRIEUR (le cœur ne lit aucune horloge). Ne doit pas toucher au monde.
   */
  onStage?: (stage: string) => void;
}

export interface WorldGenStats {
  width: number;
  height: number;
  cells: number;
  landCells: number;
  oceanCells: number;
  lakeCells: number;
  riverCells: number;
  landFraction: number;
  oceanFraction: number;
  lakeFraction: number;
  /** Nombre de cellules par biome (index = identifiant). */
  biomeCounts: number[];
  /** Σ élévation (cm) après le relief, avant érosion. */
  elevationSumInitial: number;
  /** Total abaissé par l'érosion (cm·cellule). */
  erodedTotal: number;
  /** Total comblé par les dépôts dans les dépressions peu profondes (cm·cellule). */
  filledTotal: number;
  /** Σ élévation finale = initial − érodé + comblé (vérifié exactement). */
  elevationSumFinal: number;
  /** Seuil de débit d'une rivière (unités d'apport). */
  riverThreshold: number;
  /** Seuil de la mer relevé au maximum du bord (fraction de terres alors sous la cible). */
  seaLevelClamped: boolean;
  minElevation: number;
  maxElevation: number;
  /** Tirages nextU32 consommés. */
  rngDraws: number;
}

export function generateWorld(world: World, overrides: Partial<WorldGenParams> = {}, hooks: WorldGenHooks = {}): WorldGenStats {
  const p = resolveParams(overrides);
  if (world.grid !== null) throw new Error('generateWorld : le monde a déjà un terrain');
  if (world.tick !== 0) throw new Error('generateWorld : la genèse se fait au tick 0');
  for (const name of PARAM_NAMES) {
    for (const q of world.params) if (q.name === name) throw new Error(`generateWorld : paramètre ${name} déjà présent`);
  }
  const stage = hooks.onStage ?? ((): void => {});
  const W = p.width;
  const H = p.height;
  const N = W * H;

  // --- Bruit ---------------------------------------------------------------------------
  stage('noise');
  const fbm = new Fbm(world.rng, W, H, p.noiseBaseCells, p.noiseOctaves);
  const margin = p.edgeMarginFraction * (W < H ? W : H);
  const raw = new Float64Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x < W - 1 - x ? x : W - 1 - x;
      const dy = y < H - 1 - y ? y : H - 1 - y;
      const d = dx < dy ? dx : dy;
      const t = d >= margin ? 1 : d / margin;
      const u = 1 - t;
      raw[y * W + x] = fbm.sampleCell(x, y) - p.edgeDrop * u * u;
    }
  }

  // --- Relief --------------------------------------------------------------------------
  stage('relief');
  const sorted = raw.slice().sort();
  let k = Math.round((1 - p.landFraction) * N) - 1;
  if (k < 0) k = 0;
  if (k > N - 1) k = N - 1;
  let sea = sorted[k]!;
  let borderMax = -Infinity;
  for (let x = 0; x < W; x++) {
    const a = raw[x]!;
    const b = raw[(H - 1) * W + x]!;
    if (a > borderMax) borderMax = a;
    if (b > borderMax) borderMax = b;
  }
  for (let y = 0; y < H; y++) {
    const a = raw[y * W]!;
    const b = raw[y * W + W - 1]!;
    if (a > borderMax) borderMax = a;
    if (b > borderMax) borderMax = b;
  }
  const seaLevelClamped = borderMax > sea;
  if (seaLevelClamped) sea = borderMax;
  const rawMin = sorted[0]!;
  const rawMax = sorted[N - 1]!;
  const elevation = new Int32Array(N);
  const maxAltCm = p.maxAltitudeM * 100;
  const depthCm = p.oceanDepthM * 100;
  for (let c = 0; c < N; c++) {
    const r = raw[c]!;
    if (r > sea) {
      const h = (r - sea) / (rawMax - sea); // ]0, 1]
      const z = Math.round(maxAltCm * h * h);
      elevation[c] = z > 1 ? z : 1;
    } else {
      const dpt = sea > rawMin ? (sea - r) / (sea - rawMin) : 0; // [0, 1]
      elevation[c] = -Math.round(depthCm * dpt) | 0; // | 0 : jamais −0
    }
  }
  let elevationSumInitial = 0;
  for (let c = 0; c < N; c++) elevationSumInitial += elevation[c]!;

  // --- Érosion -------------------------------------------------------------------------
  stage('erosion');
  const { eroded } = erode(elevation, W, H, p.erosionIterations, p.erosionK, p.fillEpsilonCm);

  // --- Hydrologie ----------------------------------------------------------------------
  stage('hydrology');
  const grid = new Grid(W, H);
  const gElevation = grid.addLayer('elevation', 'i32');
  const gWaterSurface = grid.addLayer('waterSurface', 'i32');
  const gWater = grid.addLayer('water', 'u8');
  const gFlowDir = grid.addLayer('flowDir', 'u8');
  const gDischarge = grid.addLayer('discharge', 'u32');
  const gRiver = grid.addLayer('river', 'u8');
  const gTemperature = grid.addLayer('temperatureMean', 'i16');
  const gHumidity = grid.addLayer('humidity', 'u8');
  const gBiome = grid.addLayer('biome', 'u8');

  const isOcean = new Uint8Array(N);
  findOcean(elevation, W, H, isOcean);
  const flood = priorityFlood(elevation, isOcean, W, H, p.fillEpsilonCm);
  const isLake = new Uint8Array(N);
  findLakes(elevation, flood.filled, isOcean, W, H, p.lakeMinDepthCm, p.lakeMinCells, isLake);
  let filledTotal = 0;
  for (let c = 0; c < N; c++) {
    if (isOcean[c] === 1) {
      gWater[c] = OCEAN;
      gWaterSurface[c] = 0;
      gElevation[c] = elevation[c]!;
    } else if (isLake[c] === 1) {
      gWater[c] = LAKE;
      gWaterSurface[c] = flood.filled[c]!;
      gElevation[c] = elevation[c]!;
    } else {
      // Terre : dépression peu profonde comblée par dépôt (élévation relevée à la surface comblée).
      const f = flood.filled[c]!;
      filledTotal += f - elevation[c]!;
      gWater[c] = LAND;
      gElevation[c] = f;
      gWaterSurface[c] = f;
    }
  }
  flowDirections(gWaterSurface, isOcean, W, H, gFlowDir);

  // --- Température ---------------------------------------------------------------------
  stage('temperature');
  computeTemperature(gWaterSurface, W, H, p.latNorthDeg, p.latSouthDeg,
    { t0: p.seaLevelT0C, t2: p.seaLevelT2C, lapseRatePerKm: p.lapseRateCPerKm }, gTemperature);

  // --- Humidité ------------------------------------------------------------------------
  stage('humidity');
  const maxDim = W > H ? W : H;
  // Coefficients définis pour une carte de 512 cellules de côté, ramenés à la taille réelle.
  const evap = Math.min(65536, Math.round((p.evapRef * 512) / maxDim));
  const rainBase = Math.max(1, Math.min(65536, Math.round((p.rainBaseRef * 512) / maxDim)));
  computeHumidity(gWater, gWaterSurface, W, H, p.latNorthDeg, p.latSouthDeg,
    { moistMax: p.moistMax, evap, rainBase, rainOro: p.rainOro, airDescent: p.airDescentCm }, gHumidity);
  const mixRadius = Math.round((p.humidityMixRadiusRef * H) / 512);
  mixHumidityVertically(gWater, gHumidity, W, H, mixRadius);

  // --- Débit ---------------------------------------------------------------------------
  stage('discharge');
  const local = new Uint32Array(N);
  for (let c = 0; c < N; c++) local[c] = localRunoff(gWater[c]!, gHumidity[c]!, p.runoffHumidityThreshold);
  accumulate(flood.order, flood.count, gFlowDir, W, local, gDischarge);

  // --- Rivières ------------------------------------------------------------------------
  stage('rivers');
  const riverThreshold = Math.max(1, Math.round(p.riverAreaFraction * N * 255));
  let riverCells = 0;
  for (let c = 0; c < N; c++) {
    if (gWater[c] === LAND && gDischarge[c]! >= riverThreshold) {
      gRiver[c] = 1;
      riverCells++;
    }
  }

  // --- Biomes --------------------------------------------------------------------------
  stage('biomes');
  const thresholds: BiomeThresholds = p;
  const biomeCounts: number[] = [];
  for (let b = 0; b < BIOME_COUNT; b++) biomeCounts.push(0);
  for (let c = 0; c < N; c++) {
    const b = classifyBiome(gWater[c]!, gTemperature[c]!, gHumidity[c]!, thresholds);
    gBiome[c] = b;
    biomeCounts[b]!++;
  }

  // --- Enregistrement, assertions, statistiques ----------------------------------------
  stage('store');
  let landCells = 0;
  let oceanCells = 0;
  let lakeCells = 0;
  let elevationSumFinal = 0;
  let minElevation = Infinity;
  let maxElevation = -Infinity;
  for (let c = 0; c < N; c++) {
    const w = gWater[c]!;
    if (w === LAND) landCells++;
    else if (w === OCEAN) oceanCells++;
    else lakeCells++;
    const z = gElevation[c]!;
    elevationSumFinal += z;
    if (z < minElevation) minElevation = z;
    if (z > maxElevation) maxElevation = z;
  }
  // Assertion : tout le pourtour est de l'océan (monde-île, par construction).
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (isBorder(x, y, W, H) && gWater[y * W + x] !== OCEAN) {
        throw new Error(`generateWorld : cellule de bordure (${x}, ${y}) non océanique`);
      }
    }
  }
  // Assertion : bilan de masse exact.
  if (elevationSumFinal !== elevationSumInitial - eroded + filledTotal) {
    throw new Error('generateWorld : bilan de masse faux');
  }
  for (const name of PARAM_NAMES) world.addParam(name, p[name]);
  world.setGrid(grid);
  stage('done');

  return {
    width: W,
    height: H,
    cells: N,
    landCells,
    oceanCells,
    lakeCells,
    riverCells,
    landFraction: landCells / N,
    oceanFraction: oceanCells / N,
    lakeFraction: lakeCells / N,
    biomeCounts,
    elevationSumInitial,
    erodedTotal: eroded,
    filledTotal,
    elevationSumFinal,
    riverThreshold,
    seaLevelClamped,
    minElevation,
    maxElevation,
    rngDraws: fbm.draws,
  };
}
