<script setup>
import { Play24Regular } from '@vicons/fluent'
import { onMounted, onUnmounted, ref } from 'vue'

import { AMETHYST, EMBER, NFI_GREEN, SOLAR } from '../assets/palette'
import { ThreeView } from '../rendering/ThreeView'
import { useSandboxStore } from '../stores/sandbox'
import SandboxControls from './SandboxControls.vue'

const sandboxStore = useSandboxStore()
const isReady = ref(false)

let threeView = null

// Per-origin color palette — distinct hues for up to 4 nodes, drawn from
// the sanctioned NFI gradient-ramp identity colours.
const originPalette = [EMBER, NFI_GREEN, SOLAR, AMETHYST]

function buildNodeColorMap() {
  const colorMap = new Map()
  const nodes = sandboxStore.nodes
  for (let i = 0; i < nodes.length; i++) {
    colorMap.set(nodes[i].id, originPalette[i % originPalette.length])
  }
  return colorMap
}

async function setupScene() {
  const terrain = sandboxStore.currentTerrain
  const model = sandboxStore.getModel()
  if (!model) return

  const container = document.getElementById('sandbox-map')
  if (!container) return

  const nodeColorMap = buildNodeColorMap()

  threeView = new ThreeView({
    container,
    model,
    terrain,
    nodeColorMap,
  })

  sandboxStore.setView(threeView)
  sandboxStore.registerLoop()
  isReady.value = true
}

async function switchTerrain(terrainId) {
  if (terrainId === sandboxStore.currentTerrainId) return

  sandboxStore.stop()

  if (threeView) {
    threeView.dispose()
    threeView = null
  }

  await sandboxStore.initTerrain(terrainId)
  await setupScene()
}

function handlePlay() {
  sandboxStore.start()
}

onMounted(async () => {
  await sandboxStore.initTerrain()
  await setupScene()
})

onUnmounted(() => {
  sandboxStore.destroy()
  if (threeView) {
    threeView.dispose()
    threeView = null
  }
})
</script>

<template>
  <div class="page-grid bg-darkest">
    <div class="grid-sidebar flex items-stretch overflow-hidden">
      <SandboxControls @switch-terrain="switchTerrain" />
    </div>
    <div
      id="sandbox-map"
      class="border-grey grid-canvas relative overflow-hidden rounded-lg border-2"
    >
      <!-- Play overlay -->
      <button
        v-if="isReady && !sandboxStore.isRunning"
        class="absolute inset-0 z-10 flex cursor-pointer items-center justify-center transition-opacity"
        @click="handlePlay"
      >
        <Play24Regular class="h-16 w-16 text-lighter opacity-80" />
      </button>

      <!-- Stats overlay -->
      <div
        v-if="sandboxStore.isRunning"
        class="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center"
      >
        <div class="font-mono text-2xl text-lighter/30">
          {{ sandboxStore.agentCount }} agents &middot; {{ sandboxStore.measuredFps }} fps
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "../assets/tailwind.css";

.page-grid {
  @apply relative h-full w-full gap-1.5 p-1.5;
  display: grid;
  grid-template-columns: min(33.33%, 34rem) 1fr;
  grid-template-rows: 1fr;
}

.grid-canvas {
  min-height: 0;
}

.grid-sidebar {
  @apply flex h-full w-full items-stretch overflow-hidden;
  min-height: 0;
}
</style>
