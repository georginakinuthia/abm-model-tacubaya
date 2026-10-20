/**
 * Behavior store — Pinia adapter over the pure `agentBehavior` module.
 *
 * The per-agent simulation logic lives in `src/sim/agentBehavior.ts` as
 * plain functions reading from a module-scoped `BehaviorParams` object.
 * This store:
 *
 *   1. Owns the reactive refs that the UI sliders write to
 *   2. Watches those refs and pushes a fresh `BehaviorParams` snapshot to
 *      `agentBehavior` on every change (via `setBehaviorParams`)
 *   3. Re-exports the pure per-agent functions for consumers that still
 *      need the old `BehaviorStore` shape (the `Simulation` class)
 *
 * When the Web Worker lands (Category C later stages), the same Pinia
 * adapter will additionally post an `UPDATE_PARAMS` message to the worker
 * so its copy of `_p` stays in sync.
 */

import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import {
  DEFAULTS, FOLLOWING, GEOMETRY, MOMENTUM,
  ROUTE_CHOICE, TIMING,
} from '../config'
import {
  advanceAgent,
  type BehaviorParams,
  initialiseAgent,
  recomputeAgentParams,
  setBehaviorParams,
} from '../sim/agentBehavior'
import type { AdvanceResult, Simulation } from '../sim/Simulation'
import type { NodeState } from './scenarios'

// Re-export the pure functions so existing callers (Simulation) can still
// import them from this module if they want.
export { advanceAgent, initialiseAgent, recomputeAgentParams }

/**
 * Type of the behavior store object consumed by `Simulation`. Kept as an
 * explicit interface to avoid a circular type dep between the store and
 * the sim layer.
 */
export interface BehaviorStore {
  readonly minAgentSpacing: number
  readonly baseDeltaTime: number
  initialiseAgent: (
    sim: Simulation,
    i: number,
    startNode: NodeState,
    destNode: NodeState,
    shopProb: number,
    waitProb: number,
  ) => void
  advanceAgent: (sim: Simulation, i: number, out: AdvanceResult) => void
  recomputeAgentParams: (sim: Simulation, i: number) => void
}

export const useBehaviorStore = defineStore('behavior', () => {
  const defaults = DEFAULTS

  // User-facing parameters (reactive refs driven by UI sliders)
  const behaviorDiversity = ref(defaults.behaviorDiversity)
  const personalSpace = ref(defaults.personalSpace)
  const shoppingProbability = ref(defaults.shoppingProbability)
  const spareTimeProbability = ref(defaults.spareTimeProbability)
  const speedBase = ref(defaults.speedBase)

  // Global behavior parameters
  const targetPatchMeters = ref(GEOMETRY.targetPatchMeters)
  const isSunny = ref(false)
  const arrivalRadius = ref(GEOMETRY.arrivalRadius)
  const nearTargetRadius = ref(GEOMETRY.nearTargetRadius)

  // Debug toggles
  const debugOrcaEnabled = ref(true)
  const debugDensityEnabled = ref(true)
  const debugMomentumEnabled = ref(true)
  const debugDensityBeta = ref(ROUTE_CHOICE.beta.density)
  const debugMomentumBase = ref(MOMENTUM.base)
  const debugFollowingStrength = ref(FOLLOWING.blendStrength)

  // Derived parameters
  const routeDispersion = computed(() => behaviorDiversity.value)
  const minAgentSpacingComputed = computed(() => personalSpace.value)

  const baseDeltaTime = TIMING.baseDeltaTime

  /**
   * Build a plain-object snapshot of the current reactive state.
   * Used both by the main-thread pipeline (fed to `setBehaviorParams`)
   * and by the worker-update path (posted as a message).
   */
  function snapshotParams(): BehaviorParams {
    return {
      behaviorDiversity: behaviorDiversity.value,
      personalSpace: personalSpace.value,
      speedBase: speedBase.value,
      shoppingProbability: shoppingProbability.value,
      spareTimeProbability: spareTimeProbability.value,
      isSunny: isSunny.value,
      arrivalRadius: arrivalRadius.value,
      nearTargetRadius: nearTargetRadius.value,
      baseDeltaTime,
      debugOrcaEnabled: debugOrcaEnabled.value,
      debugDensityEnabled: debugDensityEnabled.value,
      debugMomentumEnabled: debugMomentumEnabled.value,
      debugDensityBeta: debugDensityBeta.value,
      debugMomentumBase: debugMomentumBase.value,
      debugFollowingStrength: debugFollowingStrength.value,
    }
  }

  // Push the current snapshot into `agentBehavior` immediately so the
  // main-thread pipeline sees the correct initial values.
  setBehaviorParams(snapshotParams())

  // Watch every reactive ref and push a fresh snapshot on any change.
  // `flush: 'sync'` is used so pipeline code reading `_p` inside the same
  // tick sees the latest values (no deferred update).
  watch(
    [
      behaviorDiversity,
      personalSpace,
      shoppingProbability,
      spareTimeProbability,
      speedBase,
      isSunny,
      arrivalRadius,
      nearTargetRadius,
      debugOrcaEnabled,
      debugDensityEnabled,
      debugMomentumEnabled,
      debugDensityBeta,
      debugMomentumBase,
      debugFollowingStrength,
    ],
    () => {
      setBehaviorParams(snapshotParams())
    },
    { flush: 'sync' },
  )

  function resetParams() {
    behaviorDiversity.value = defaults.behaviorDiversity
    personalSpace.value = defaults.personalSpace
    speedBase.value = defaults.speedBase
    shoppingProbability.value = defaults.shoppingProbability
    spareTimeProbability.value = defaults.spareTimeProbability
  }

  function resetExperimentalParams() {
    debugOrcaEnabled.value = true
    debugDensityEnabled.value = true
    debugMomentumEnabled.value = true
    debugDensityBeta.value = ROUTE_CHOICE.beta.density
    debugMomentumBase.value = MOMENTUM.base
    debugFollowingStrength.value = FOLLOWING.blendStrength
  }

  return {
    // User-facing parameters (UI sliders bind to these)
    behaviorDiversity,
    personalSpace,
    speedBase,
    shoppingProbability,
    spareTimeProbability,
    // Derived
    routeDispersion,
    minAgentSpacing: minAgentSpacingComputed,
    baseDeltaTime,
    // Global
    isSunny,
    targetPatchMeters,
    // Pure functions (re-exported so Simulation / worker proxies can
    // grab them from the store instance if they prefer that path)
    initialiseAgent,
    advanceAgent,
    recomputeAgentParams,
    // Lifecycle
    resetParams,
    resetExperimentalParams,
    // Debug toggles
    debugOrcaEnabled,
    debugDensityEnabled,
    debugMomentumEnabled,
    debugDensityBeta,
    debugMomentumBase,
    debugFollowingStrength,
    // Expose snapshotParams() for the worker-sync path
    snapshotParams,
  }
})
