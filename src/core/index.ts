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
