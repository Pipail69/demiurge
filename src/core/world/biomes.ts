/**
 * Biomes : classification TOTALE (toute combinaison → exactement un biome) à partir de la
 * classe d'eau, de la température moyenne annuelle (centièmes de °C) et de l'humidité (0..255).
 * Inspirée du diagramme de Whittaker (température × précipitations) ; seuils adaptés = choix
 * de jeu. Modèle et seuils : docs/models.md § Biomes.
 */

import { LAKE, OCEAN } from './hydrology.ts';

// Identifiants (ordre = valeur stockée dans la couche `biome`).
export const BIOME_OCEAN = 0;
export const BIOME_SEA_ICE = 1;
export const BIOME_LAKE = 2;
export const BIOME_ICE = 3;
export const BIOME_TUNDRA = 4;
export const BIOME_TAIGA = 5;
export const BIOME_GRASSLAND = 6;
export const BIOME_TEMPERATE_FOREST = 7;
export const BIOME_DESERT = 8;
export const BIOME_SAVANNA = 9;
export const BIOME_TROPICAL_DRY_FOREST = 10;
export const BIOME_RAINFOREST = 11;

/** Clés anglaises (identifiants) et noms affichés (français), index = identifiant. */
export const BIOME_KEYS: readonly string[] = [
  'ocean', 'seaIce', 'lake', 'ice', 'tundra', 'taiga',
  'grassland', 'temperateForest', 'desert', 'savanna', 'tropicalDryForest', 'rainforest',
];
export const BIOME_NAMES: readonly string[] = [
  'Océan', 'Banquise', 'Lac', 'Glace terrestre', 'Toundra', 'Taïga',
  'Prairie / steppe tempérée', 'Forêt tempérée', 'Désert', 'Savane', 'Forêt tropicale sèche', 'Forêt tropicale humide',
];
export const BIOME_COUNT = BIOME_KEYS.length;

/** Seuils de classification (centièmes de °C ; humidité 0..255). */
export interface BiomeThresholds {
  /** Océan à T ≤ seaIceMaxC → banquise (point de congélation de l'eau de mer). */
  seaIceMaxC: number;
  /** Terre à T < iceBelowC → glace terrestre. */
  iceBelowC: number;
  /** Terre à T < tundraBelowC → toundra. */
  tundraBelowC: number;
  /** Terre (non glace/toundra) à humidité < desertBelowH → désert. */
  desertBelowH: number;
  /** T < borealBelowC → taïga. */
  borealBelowC: number;
  /** T < tropicalFromC → tempéré, sinon tropical. */
  tropicalFromC: number;
  /** Tempéré : humidité < temperateForestFromH → prairie, sinon forêt tempérée. */
  temperateForestFromH: number;
  /** Tropical : humidité < tropicalDryForestFromH → savane. */
  tropicalDryForestFromH: number;
  /** Tropical : humidité ≥ rainforestFromH → forêt tropicale humide, sinon forêt sèche. */
  rainforestFromH: number;
}

/** Classification totale. water : 0 terre, 1 océan, 2 lac (toute autre valeur → terre). */
export function classifyBiome(water: number, tempC: number, humidity: number, t: BiomeThresholds): number {
  if (water === OCEAN) return tempC <= t.seaIceMaxC ? BIOME_SEA_ICE : BIOME_OCEAN;
  if (water === LAKE) return BIOME_LAKE;
  if (tempC < t.iceBelowC) return BIOME_ICE;
  if (tempC < t.tundraBelowC) return BIOME_TUNDRA;
  if (humidity < t.desertBelowH) return BIOME_DESERT;
  if (tempC < t.borealBelowC) return BIOME_TAIGA;
  if (tempC < t.tropicalFromC) return humidity < t.temperateForestFromH ? BIOME_GRASSLAND : BIOME_TEMPERATE_FOREST;
  if (humidity < t.tropicalDryForestFromH) return BIOME_SAVANNA;
  return humidity < t.rainforestFromH ? BIOME_TROPICAL_DRY_FOREST : BIOME_RAINFOREST;
}
