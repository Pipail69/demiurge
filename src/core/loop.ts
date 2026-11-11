/**
 * Boucle à pas fixe (accumulateur).
 *
 * Le cœur ne lit JAMAIS d'horloge : c'est l'appelant (rendu, Worker, script) qui mesure le
 * temps réel et le transmet à advance(elapsedMs). L'issue de la simulation ne dépend que du
 * NOMBRE de ticks exécutés, jamais du découpage du temps réel.
 */

import { step, type World } from './ecs/world.ts';

/** 30 ticks par seconde (cible de performance T9). Paramètre : voir docs/decisions.md. */
export const DEFAULT_STEP_MS = 1000 / 30;

/** Plafond de ticks par appel à advance (anti « spirale de la mort »). Valeur inventée. */
export const DEFAULT_MAX_STEPS_PER_ADVANCE = 8;

export interface FixedStepLoopOptions {
  stepMs?: number;
  maxStepsPerAdvance?: number;
}

export class FixedStepLoop {
  readonly world: World;
  readonly stepMs: number;
  readonly maxStepsPerAdvance: number;
  /** Temps réel accumulé non encore converti en ticks (toujours dans [0, stepMs) après advance). */
  accumulatorMs = 0;
  /** Cumul du retard abandonné à cause du plafond (observabilité uniquement). */
  droppedMs = 0;

  constructor(world: World, options: FixedStepLoopOptions = {}) {
    const stepMs = options.stepMs ?? DEFAULT_STEP_MS;
    const maxSteps = options.maxStepsPerAdvance ?? DEFAULT_MAX_STEPS_PER_ADVANCE;
    if (!Number.isFinite(stepMs) || stepMs <= 0) throw new RangeError(`stepMs invalide : ${String(stepMs)}`);
    if (!Number.isInteger(maxSteps) || maxSteps < 1) {
      throw new RangeError(`maxStepsPerAdvance invalide : ${String(maxSteps)}`);
    }
    this.world = world;
    this.stepMs = stepMs;
    this.maxStepsPerAdvance = maxSteps;
  }

  /**
   * Ajoute elapsedMs à l'accumulateur et exécute autant de ticks entiers que possible,
   * au plus maxStepsPerAdvance. S'il reste alors au moins un pas entier de retard, ce
   * retard est ABANDONNÉ (seule la fraction de pas résiduelle est conservée) et cumulé
   * dans droppedMs. Renvoie le nombre de ticks exécutés.
   */
  advance(elapsedMs: number): number {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
      throw new RangeError(`advance : durée écoulée invalide ${String(elapsedMs)} (attendu fini et ≥ 0)`);
    }
    this.accumulatorMs += elapsedMs;
    let ticks = 0;
    while (this.accumulatorMs >= this.stepMs && ticks < this.maxStepsPerAdvance) {
      step(this.world);
      this.accumulatorMs -= this.stepMs;
      ticks++;
    }
    if (this.accumulatorMs >= this.stepMs) {
      const remainder = this.accumulatorMs % this.stepMs;
      this.droppedMs += this.accumulatorMs - remainder;
      this.accumulatorMs = remainder;
    }
    return ticks;
  }
}
