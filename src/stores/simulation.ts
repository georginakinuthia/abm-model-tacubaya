import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { TIMING } from '../config'
import { recordFrame } from './perfProfiler'
import { useModelsStore } from './models'

/**
 * Simulation store — thin proxy over the worker-owned Simulation loop.
 *
 * In the previous (pre-worker) architecture this store owned an
 * `Animator`/`createLoop` instance and called `modelA.step(); modelB.step()`
 * directly inside the callback. Now the worker owns the tick loop and
 * this store just issues commands (START/STOP/RESET/SET_FAST_MODE) and
 * exposes reactive state derived from worker STATS messages.
 *
 * The main thread keeps a rAF loop solely for rendering — it calls
 * `viewA.draw()` / `viewB.draw()` each frame so whatever snapshot the
 * worker has most recently delivered is painted onto the maplibre
 * canvas source. Spawn calculation lives inside the worker's tick loop
 * ([worker.ts](../sim/worker.ts)::tick), not here — see the commentary
 * in `frame()` for why.
 */
export const useSimulationStore = defineStore('simulation', () => {
  const modelsStore = useModelsStore()

  const isRunning = ref(false)
  const globalTick = ref(0)
  const elapsedSimSeconds = ref(0)
  const simulationDuration = TIMING.simulationDuration
  const fps = ref(TIMING.fps)
  const isFastMode = ref(false)
  const isIndefiniteMode = ref(true)
  const baseDeltaTime = ref(TIMING.baseDeltaTime)
  const deltaTime = computed(() => baseDeltaTime.value)

  const currentTime = computed(() => {
    if (isIndefiniteMode.value) {
      const elapsed = Math.floor(elapsedSimSeconds.value)
      const hours = Math.floor(elapsed / 3600)
      const minutes = Math.floor((elapsed % 3600) / 60)
      const seconds = elapsed % 60
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    }
    const remainingSeconds = Math.max(0, simulationDuration - elapsedSimSeconds.value)
    const hours = Math.floor(remainingSeconds / 3600)
    const minutes = Math.floor((remainingSeconds % 3600) / 60)
    const seconds = Math.floor(remainingSeconds % 60)
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  })

  /** rAF handle for the spawn+draw loop. */
  let rafHandle: number | null = null
  // View references are set by MapView on mount. Used to drive per-frame
  // rendering from the latest snapshot the worker has delivered.
  let viewA_ref: { draw: () => void } | null = null
  let viewB_ref: { draw: () => void } | null = null
  let onTick_ref: (() => void) | null = null

  /**
   * Register the renderers + optional per-frame UI callback.
   *
   * Installs a rAF callback that drives main-thread rendering:
   *   - calls `viewA.draw()` / `viewB.draw()` each frame so whatever
   *     snapshot the worker has most recently delivered is painted
   *   - runs the user `onTick` callback (heatmap rebuild, etc.)
   *   - records the frame time for the perf profiler
   *
   * Also pushes current fps / indefinite / fast-mode flags into the
   * worker so its tick loop picks up UI state set before `init()`.
   * Spawn calculation lives in the worker — this rAF loop does NOT
   * compute or push spawns. See the comment on `frame()` below.
   */
  function registerMasterControllers(opts: {
    viewA: { draw: () => void }
    viewB: { draw: () => void }
    onTick?: () => void
  }): void {
    clearLoop()
    viewA_ref = opts.viewA
    viewB_ref = opts.viewB
    onTick_ref = opts.onTick ?? null
    // Ensure the worker knows about the current fps/indefinite settings
    const client = modelsStore.getClient()
    if (client) {
      client.setFps(fps.value)
      client.setIndefiniteMode(isIndefiniteMode.value)
      client.setFastMode(isFastMode.value)
    }
  }

  function frame(_t: number): void {
    const t0 = performance.now()
    // The main-thread rAF loop ONLY renders — spawn calculation lives
    // inside the worker's tick loop (see `src/sim/worker.ts::tick`).
    // Computing spawns here used to produce race conditions: rAF at ~60 Hz
    // pushed batches into a `pendingSpawns` queue that the worker drained
    // at 30 Hz, doubling the effective spawn rate in regular mode and
    // halving it in fast mode depending on clock phase alignment.
    //
    // Draws are always run — the views reflect whatever snapshot the
    // worker has most recently delivered, even when the sim is paused.
    try { viewA_ref?.draw() } catch (e) { console.warn('viewA.draw failed', e) }
    try { viewB_ref?.draw() } catch (e) { console.warn('viewB.draw failed', e) }
    if (onTick_ref) onTick_ref()
    recordFrame(performance.now() - t0)
    rafHandle = requestAnimationFrame(frame)
  }

  function clearLoop(): void {
    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle)
      rafHandle = null
    }
  }

  function start(): void {
    isRunning.value = true
    const client = modelsStore.getClient()
    client?.start()
    if (rafHandle === null) rafHandle = requestAnimationFrame(frame)
  }

  function stop(): void {
    isRunning.value = false
    const client = modelsStore.getClient()
    client?.stop()
  }

  function destroy(): void {
    stop()
    clearLoop()
    viewA_ref = null
    viewB_ref = null
    onTick_ref = null
    modelsStore.disposeClient()
  }

  function reset(): void {
    stop()
    globalTick.value = -1
    elapsedSimSeconds.value = 0
    const client = modelsStore.getClient()
    client?.reset()
    globalTick.value = 0
    // Force an immediate redraw so the UI reflects the reset state
    try { viewA_ref?.draw() } catch (e) { console.warn('viewA.draw failed during reset', e) }
    try { viewB_ref?.draw() } catch (e) { console.warn('viewB.draw failed during reset', e) }
    if (onTick_ref) onTick_ref()
  }

  function ticks(): number {
    return globalTick.value
  }

  // Keep worker in sync when fast-mode or fps toggle.
  watch(isFastMode, (v) => {
    modelsStore.getClient()?.setFastMode(v)
  })
  watch(fps, (v) => {
    modelsStore.getClient()?.setFps(v)
  })
  watch(isIndefiniteMode, (v) => {
    modelsStore.getClient()?.setIndefiniteMode(v)
  })

  // Bridge worker STATS messages into our reactive globalTick + elapsed refs.
  // The models store re-exposes stats as reactive refs — we watch them here
  // so the UI clock and tick count match the worker's state.
  watch(
    () => modelsStore.statsA,
    (stats) => {
      if (!stats) return
      globalTick.value = stats.globalTick
      elapsedSimSeconds.value = stats.elapsedSimSeconds
    },
    { deep: true },
  )

  function modelStats(which: 'A' | 'B') {
    const stats = which === 'A' ? modelsStore.statsA : modelsStore.statsB
    if (!stats) {
      return {
        totalArrivals: 0,
        totalMinutesShopped: 0,
        totalMinutesWaited: 0,
        totalSteps: 0,
        totalNormalSteps: 0,
        totalNormalDistanceTraveled: 0,
        totalNormalTime: 0,
        totalPublicZoneSteps: 0,
        totalIntimateZoneSteps: 0,
        totalPersonalZoneSteps: 0,
        totalSocialZoneSteps: 0,
        currentAgents: 0,
        currentShopping: 0,
        currentWaiting: 0,
      }
    }
    return {
      totalArrivals: stats.totalArrivals,
      totalMinutesShopped: stats.totalMinutesShopped,
      totalMinutesWaited: stats.totalMinutesWaited,
      totalSteps: stats.totalSteps,
      totalNormalSteps: stats.totalNormalSteps,
      totalNormalDistanceTraveled: stats.totalNormalDistanceTraveled,
      totalNormalTime: stats.totalNormalTime,
      totalPublicZoneSteps: stats.totalPublicZoneSteps,
      totalIntimateZoneSteps: stats.totalIntimateZoneSteps,
      totalPersonalZoneSteps: stats.totalPersonalZoneSteps,
      totalSocialZoneSteps: stats.totalSocialZoneSteps,
      currentAgents: stats.currentAgents,
      currentShopping: stats.currentShopping,
      currentWaiting: stats.currentWaiting,
    }
  }

  return {
    registerMasterControllers,
    start,
    stop,
    reset,
    destroy,
    isRunning,
    isFastMode,
    isIndefiniteMode,
    ticks,
    currentTime,
    fps,
    globalTick,
    baseDeltaTime,
    deltaTime,
    modelAStats: () => modelStats('A'),
    modelBStats: () => modelStats('B'),
  }
})
