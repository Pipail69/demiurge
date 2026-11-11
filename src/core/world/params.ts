/**
 * Paramètres de génération du monde. Statut de chaque valeur (source publiée, choix
 * d'ingénierie, paramètre inventé) : docs/models.md et docs/decisions.md (T1).
 *
 * Les paramètres effectivement utilisés sont enregistrés dans world.params dans l'ordre de
 * PARAM_NAMES (et hachés) : deux mondes de même hash ont le même futur.
 */

export interface WorldGenParams {
  // Grille
  width: number;
  height: number;
  // Bruit et relief
  noiseBaseCells: number;
  noiseOctaves: number;
  landFraction: number;
  edgeMarginFraction: number;
  edgeDrop: number;
  maxAltitudeM: number;
  oceanDepthM: number;
  // Érosion
  erosionIterations: number;
  erosionK: number;
  // Hydrologie
  fillEpsilonCm: number;
  lakeMinDepthCm: number;
  lakeMinCells: number;
  runoffHumidityThreshold: number;
  riverAreaFraction: number;
  // Température et saisons
  latNorthDeg: number;
  latSouthDeg: number;
  seaLevelT0C: number;
  seaLevelT2C: number;
  lapseRateCPerKm: number;
  seasonalAmplitudeC: number;
  ticksPerYear: number;
  // Humidité
  moistMax: number;
  evapRef: number;
  rainBaseRef: number;
  rainOro: number;
  airDescentCm: number;
  humidityMixRadiusRef: number;
  // Biomes (centièmes de °C, humidité 0..255)
  seaIceMaxC: number;
  iceBelowC: number;
  tundraBelowC: number;
  desertBelowH: number;
  borealBelowC: number;
  tropicalFromC: number;
  temperateForestFromH: number;
  tropicalDryForestFromH: number;
  rainforestFromH: number;
}

/** Ordre figé d'enregistrement et de hachage des paramètres. */
export const PARAM_NAMES: readonly (keyof WorldGenParams)[] = [
  'width', 'height',
  'noiseBaseCells', 'noiseOctaves', 'landFraction', 'edgeMarginFraction', 'edgeDrop', 'maxAltitudeM', 'oceanDepthM',
  'erosionIterations', 'erosionK',
  'fillEpsilonCm', 'lakeMinDepthCm', 'lakeMinCells', 'runoffHumidityThreshold', 'riverAreaFraction',
  'latNorthDeg', 'latSouthDeg', 'seaLevelT0C', 'seaLevelT2C', 'lapseRateCPerKm', 'seasonalAmplitudeC', 'ticksPerYear',
  'moistMax', 'evapRef', 'rainBaseRef', 'rainOro', 'airDescentCm', 'humidityMixRadiusRef',
  'seaIceMaxC', 'iceBelowC', 'tundraBelowC', 'desertBelowH', 'borealBelowC', 'tropicalFromC',
  'temperateForestFromH', 'tropicalDryForestFromH', 'rainforestFromH',
];

export const DEFAULT_WORLDGEN_PARAMS: Readonly<WorldGenParams> = Object.freeze({
  width: 512,
  height: 512,
  noiseBaseCells: 3,
  noiseOctaves: 7,
  landFraction: 0.4,
  edgeMarginFraction: 0.12,
  edgeDrop: 1,
  maxAltitudeM: 5000,
  oceanDepthM: 4000,
  erosionIterations: 8,
  erosionK: 0.002,
  fillEpsilonCm: 1,
  lakeMinDepthCm: 300,
  lakeMinCells: 9,
  runoffHumidityThreshold: 30,
  riverAreaFraction: 0.0006,
  latNorthDeg: 66,
  latSouthDeg: 0,
  seaLevelT0C: 14.9,
  seaLevelT2C: -28,
  lapseRateCPerKm: 6.5,
  seasonalAmplitudeC: 15.5,
  ticksPerYear: 7200,
  moistMax: 1_000_000,
  evapRef: 3000,
  rainBaseRef: 450,
  rainOro: 30,
  airDescentCm: 2000,
  humidityMixRadiusRef: 3,
  seaIceMaxC: -190,
  iceBelowC: -1000,
  tundraBelowC: -200,
  desertBelowH: 40,
  borealBelowC: 400,
  tropicalFromC: 2000,
  temperateForestFromH: 110,
  tropicalDryForestFromH: 100,
  rainforestFromH: 180,
});

/** Paramètres qui doivent être des entiers. */
const INTEGER_PARAMS: readonly (keyof WorldGenParams)[] = [
  'width', 'height', 'noiseBaseCells', 'noiseOctaves', 'erosionIterations', 'fillEpsilonCm', 'lakeMinDepthCm',
  'lakeMinCells', 'runoffHumidityThreshold', 'ticksPerYear', 'moistMax', 'evapRef', 'rainBaseRef', 'rainOro', 'airDescentCm', 'humidityMixRadiusRef',
  'seaIceMaxC', 'iceBelowC', 'tundraBelowC', 'desertBelowH', 'borealBelowC', 'tropicalFromC',
  'temperateForestFromH', 'tropicalDryForestFromH', 'rainforestFromH',
];

/** Fusionne les surcharges avec les valeurs par défaut et valide. */
export function resolveParams(overrides: Partial<WorldGenParams> = {}): WorldGenParams {
  const p = { ...DEFAULT_WORLDGEN_PARAMS };
  for (const name of PARAM_NAMES) {
    const v = overrides[name];
    if (v !== undefined) p[name] = v;
  }
  for (const name of PARAM_NAMES) {
    const v = p[name];
    if (!Number.isFinite(v)) throw new RangeError(`Paramètre ${name} non fini : ${String(v)}`);
  }
  for (const name of INTEGER_PARAMS) {
    if (!Number.isInteger(p[name])) throw new RangeError(`Paramètre ${name} : entier attendu, reçu ${p[name]}`);
  }
  const check = (ok: boolean, msg: string): void => {
    if (!ok) throw new RangeError(`Paramètres de génération : ${msg}`);
  };
  check(p.width >= 16 && p.height >= 16 && p.width <= 4096 && p.height <= 4096, 'largeur et hauteur dans [16, 4096]');
  check(p.noiseBaseCells >= 1 && p.noiseOctaves >= 1 && p.noiseOctaves <= 12, 'bruit');
  check(p.landFraction > 0 && p.landFraction < 1, 'landFraction dans ]0, 1[');
  check(p.edgeMarginFraction > 0 && p.edgeMarginFraction <= 0.5 && p.edgeDrop >= 0, 'terme de bord');
  check(p.maxAltitudeM > 0 && p.maxAltitudeM <= 15000 && p.oceanDepthM > 0 && p.oceanDepthM <= 15000, 'altitudes');
  check(p.erosionIterations >= 0 && p.erosionIterations <= 100 && p.erosionK >= 0, 'érosion');
  check(p.fillEpsilonCm >= 1 && p.lakeMinDepthCm >= 1 && p.lakeMinCells >= 1, 'lacs');
  check(p.runoffHumidityThreshold >= 0 && p.runoffHumidityThreshold <= 255, 'seuil d\'apport');
  check(p.riverAreaFraction > 0 && p.riverAreaFraction < 1, 'riverAreaFraction');
  check(p.latNorthDeg >= 0 && p.latNorthDeg <= 90 && p.latSouthDeg >= 0 && p.latSouthDeg <= 90, 'latitudes dans [0, 90]');
  check(p.lapseRateCPerKm >= 0 && p.seasonalAmplitudeC >= 0, 'gradient et amplitude ≥ 0');
  check(p.ticksPerYear >= 8 && p.ticksPerYear % 8 === 0, 'ticksPerYear multiple de 8');
  check(p.moistMax >= 1 && p.moistMax <= 1e9, 'moistMax');
  check(p.evapRef >= 0 && p.evapRef <= 65536 && p.rainBaseRef >= 1 && p.rainBaseRef <= 65536 && p.rainOro >= 0 && p.humidityMixRadiusRef >= 0 && p.airDescentCm >= 0, 'humidité');
  return p;
}
