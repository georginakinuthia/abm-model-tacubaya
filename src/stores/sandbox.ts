import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { TIMING } from '../config'
import { Simulation, type SpawnSpec } from '../sim/Simulation'
import { createLoop, type LoopHandle } from '../sim/tick'
import { useBehaviorStore } from './behavior'
import {
  buildNodesFromCollection,
  computePatchesWidth,
  type NodeState,
  spawnFromNodes as sharedSpawnFromNodes,
} from './geo'
import { SANDBOX_TERRAINS } from './sandboxTerrains'
import { ScenarioContainer } from './scenarios'

/**
 * Sandbox store — runs a single `Simulation` on the **main thread** via
 * `createLoop`, NOT in the Web Worker.
 *
 * **Why the asymmetry with the main corridor view (which uses the worker)?**
 *
 * 1. The sandbox view uses a Three.js `InstancedMesh` renderer
 *    ([ThreeView.ts](../rendering/ThreeView.ts)) that reads directly from
 *    a live `Simulation` (`sim.pedX`, `sim.pedY`, `sim.width`, etc.). It
 *    also needs `sim.nodeIdTable` for colour mapping. This is the same
 *    `RenderSimLike` structural interface that the map renderer expects,
 *    so it would technically work against a `SimView` — but:
 *
 * 2. Sandbox scenarios are small and agent counts are modest (≤200 typically),
 *    so moving the tick loop off the main thread provides marginal benefit
 *    while doubling the message protocol surface.
 *
 * 3. The sandbox's live-param updates (when `speedBase` or
 *    `behaviorDiversity` sliders change, we call `recomputeAgentParams`
 *    for every live agent) would require a new worker message type
 *    (`RECOMPUTE_AGENT_PARAMS`) that the main corridor view doesn't need.
 *
 * 4. Because `agentBehavior.ts` is pure — it reads a module-scoped
 *    `_p: BehaviorParams` via `setBehaviorParams(...)` — the same behavior
 *    pipeline runs identically on both threads. The Pinia adapter in
 *    [behavior.ts](./behavior.ts) keeps the main-thread `_p` in sync with
 *    the sliders, so the sandbox sim picks up changes immediately.
 *
 * If sandbox agent counts ever grow to the point where main-thread
 * stepping visibly stutters the UI, migrate by (a) constructing a
 * `SimWorkerClient` in single mode here, (b) pointing `ThreeView` at the
 * resulting `SimView`, and (c) adding a `RECOMPUTE_AGENT_PARAMS` message
 * for slider-driven live updates.
 */
export const useSandboxStore = defineStore('sandbox', () => {
  const behaviorStore = useBehaviorStore()

  const currentTerrainId = ref(SANDBOX_TERRAINS[0]!.id)
  // Raw (non-reactive) model reference — Simulation's internal typed arrays
  // don't survive Vue's reactive wrapper well, so we hold it outside the ref.
  let rawModel: Simulation | null = null
  const nodes = ref<NodeState[]>([])
  const isRunning = ref(false)
  const globalTick = ref(0)
  const elapsedSimSeconds = ref(0)
  const simulationDuration = TIMING.simulationDuration

  let masterLoop: LoopHandle | null = null
  let viewRef: { draw?: () => void; agentCount?: number; cameraInfo?: { zoom: number; centerX: number; centerY: number } } | null = null

  const fps = ref(TIMING.fps)
  const measuredFps = ref(0)
  const agentCount = ref(0)
  const cameraInfo = ref({ zoom: 1, centerX: 0, centerY: 0 })
  let _lastFrameTime = 0
  let _frameAccum = 0
  let _fpsTimer = 0
  const isFastMode = ref(false)
  const isIndefiniteMode = ref(true)
  const spawnRateMultiplier = ref(1.2)
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

  const currentTerrain = computed(() =>
    SANDBOX_TERRAINS.find((t) => t.id === currentTerrainId.value) ?? SANDBOX_TERRAINS[0]!,
  )

  async function initTerrain(terrainId?: string) {
    if (terrainId) currentTerrainId.value = terrainId

    const terrain = currentTerrain.value

    // Build scenario from terrain data
    const scenario = new ScenarioContainer(
      {
        surfaces: terrain.surfaces,
        structures: terrain.structures,
        stalls: terrain.stalls,
        furniture: terrain.furniture,
        shade: terrain.shade,
      },
      terrain.id,
    )

    // Build nodes — sandbox agents never shop or wait
    const terrainNodes = buildNodesFromCollection(terrain.nodes)
    for (const node of terrainNodes) node.noEngagement = true

    const patchesWidth = computePatchesWidth(terrain.bbox, behaviorStore.targetPatchMeters)

    const m = new Simulation(terrain.bbox as [number, number, number, number], patchesWidth)

    // Compute node world coords using the new Simulation's projection
    for (const node of terrainNodes) {
      if (node.coords) {
        node.worldX = m.lonToX(node.coords[0])
        node.worldY = m.latToY(node.coords[1])
      }
    }

    m.generateScenario(scenario, terrainNodes)

    rawModel = m
    nodes.value = terrainNodes

    return m
  }

  function getModel(): Simulation | null {
    return rawModel
  }

  function setView(view: typeof viewRef) {
    viewRef = view
  }

  function clearLoop() {
    if (masterLoop) {
      try {
        masterLoop.stop()
      } catch (_) {
        /* ignore */
      }
      masterLoop = null
    }
  }

  function registerLoop() {
    clearLoop()

    const m = rawModel
    if (!m) {
      console.error('Cannot register sandbox loop — no model initialised.')
      return
    }

    const loop = createLoop(
      () => {
        if (!isRunning.value) return

        // Measure actual FPS
        const now = performance.now()
        if (_lastFrameTime > 0) {
          _frameAccum++
          _fpsTimer += now - _lastFrameTime
          if (_fpsTimer >= 1000) {
            measuredFps.value = Math.round((_frameAccum * 1000) / _fpsTimer)
            _frameAccum = 0
            _fpsTimer = 0
          }
        }
        _lastFrameTime = now

        // In fast mode, run multiple sim steps per render frame
        const stepsPerFrame = isFastMode.value ? TIMING.fastModeMultiplier : 1

        for (let s = 0; s < stepsPerFrame; s++) {
          m.pendingSpawns = spawnFromNodes() as SpawnSpec[]
          m.step()

          globalTick.value++
          elapsedSimSeconds.value += baseDeltaTime.value

          if (!isIndefiniteMode.value && elapsedSimSeconds.value >= simulationDuration) {
            stop()
            break
          }
        }

        agentCount.value = viewRef?.agentCount ?? 0
        if (viewRef?.cameraInfo) cameraInfo.value = viewRef.cameraInfo
        if (viewRef?.draw) viewRef.draw()
      },
      {
        fps: fps.value,
        totalTicks: isIndefiniteMode.value ? undefined : Math.ceil(simulationDuration / baseDeltaTime.value),
      },
    )

    masterLoop = loop
  }

  function spawnFromNodes() {
    return sharedSpawnFromNodes(nodes.value, deltaTime.value, spawnRateMultiplier.value)
  }

  function start() {
    isRunning.value = true
    masterLoop?.start()
  }

  function stop() {
    isRunning.value = false
    if (masterLoop) {
      try {
        masterLoop.stop()
      } catch (_) {
        /* ignore */
      }
    }
  }

  function destroy() {
    stop()
    clearLoop()
    rawModel = null
    viewRef = null
  }

  function reset() {
    stop()
    globalTick.value = 0
    elapsedSimSeconds.value = 0
    measuredFps.value = 0
    _lastFrameTime = 0
    _frameAccum = 0
    _fpsTimer = 0

    if (rawModel) {
      try {
        rawModel.reset()
      } catch (_) {
        /* ignore */
      }
    }

    registerLoop()

    if (viewRef?.draw) {
      try {
        viewRef.draw()
      } catch (_) {
        /* ignore */
      }
    }
  }

  // Live-update existing agents when speed/diversity sliders change
  watch(
    [() => behaviorStore.speedBase, () => behaviorStore.behaviorDiversity],
    () => {
      if (!rawModel) return
      const m = rawModel
      const alive = m.pedAlive
      const n = m.pedCount
      for (let i = 0; i < n; i++) {
        if (alive[i] === 0) continue
        behaviorStore.recomputeAgentParams(m, i)
      }
    },
  )

  return {
    currentTerrainId,
    currentTerrain,
    getModel,
    nodes,
    isRunning,
    isFastMode,
    isIndefiniteMode,
    spawnRateMultiplier,
    globalTick,
    elapsedSimSeconds,
    currentTime,
    deltaTime,
    measuredFps,
    agentCount,
    cameraInfo,
    initTerrain,
    setView,
    registerLoop,
    start,
    stop,
    reset,
    destroy,
  }
})
