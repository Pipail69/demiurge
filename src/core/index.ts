/** Point d'entrée public du cœur de simulation (pur, headless). */
export { Rng } from './rng.ts';
export { Sha256, sha256Hex, toHex } from './sha256.ts';
export { hashWorld, HASH_FORMAT_VERSION, assertLittleEndian, detectLittleEndian } from './hash.ts';
export { FixedStepLoop, DEFAULT_STEP_MS, DEFAULT_MAX_STEPS_PER_ADVANCE } from './loop.ts';
export type { FixedStepLoopOptions } from './loop.ts';
export { World, step, DEFAULT_INITIAL_CAPACITY } from './ecs/world.ts';
export type { System, WorldOptions } from './ecs/world.ts';
export { ComponentStore, FIELD_TYPES } from './ecs/component.ts';
export type { FieldType, Schema, Fields, FieldArray } from './ecs/component.ts';
export { EntityAllocator, makeEntity, entityIndex, entityGeneration, GENERATION_BITS, GENERATION_MASK } from './ecs/entities.ts';
export type { Entity } from './ecs/entities.ts';
export type { WorldParam } from './ecs/world.ts';
export { Grid, LAYER_TYPES, GRID_MAX_SIDE } from './grid.ts';
export type { LayerType, LayerArray, GridLayer } from './grid.ts';
export { GradientLattice, Fbm, fade, GRADIENT_X, GRADIENT_Y } from './world/noise.ts';
export { CellHeap } from './world/heap.ts';
export {
  D8_DX, D8_DY, NO_FLOW, LAND, OCEAN, LAKE, isBorder, findOcean, priorityFlood, flowDirections, receiverOf,
  accumulate, findLakes,
} from './world/hydrology.ts';
export type { FloodResult } from './world/hydrology.ts';
export { erode } from './world/erosion.ts';
export type { ErosionResult } from './world/erosion.ts';
export {
  bhaskaraSinDeg, latitudeOfRow, seaLevelTemperature, computeTemperature, windDirection, computeHumidity, localRunoff,
  mixHumidityVertically,
} from './world/climate.ts';
export type { TemperatureModel, HumidityModel } from './world/climate.ts';
export {
  classifyBiome, BIOME_COUNT, BIOME_KEYS, BIOME_NAMES, BIOME_OCEAN, BIOME_SEA_ICE, BIOME_LAKE, BIOME_ICE, BIOME_TUNDRA,
  BIOME_TAIGA, BIOME_GRASSLAND, BIOME_TEMPERATE_FOREST, BIOME_DESERT, BIOME_SAVANNA, BIOME_TROPICAL_DRY_FOREST,
  BIOME_RAINFOREST,
} from './world/biomes.ts';
export type { BiomeThresholds } from './world/biomes.ts';
export {
  seasonAt, yearAt, seasonalCycle, seasonalAmplitude, temperatureAt, SPRING, SUMMER, AUTUMN, WINTER, SEASON_NAMES,
} from './world/seasons.ts';
export { DEFAULT_WORLDGEN_PARAMS, PARAM_NAMES, resolveParams } from './world/params.ts';
export type { WorldGenParams } from './world/params.ts';
export { generateWorld, WORLDGEN_STAGES } from './world/generate.ts';
export type { WorldGenStats, WorldGenHooks } from './world/generate.ts';
