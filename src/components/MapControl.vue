<script setup lang="ts">
import {
  ArrowCircleDown24Regular,
  ArrowCircleLeft24Regular,
  ArrowCircleRight24Regular,
  ArrowCircleUp24Regular,
  BoxToolbox20Regular,
  ZoomIn24Regular,
  ZoomOut24Regular,
} from '@vicons/fluent'
import { computed, inject } from 'vue'

import { useMapStore } from '../stores/map'

const appMode = inject('appMode')
const mapStore = useMapStore()

// Check if zoom buttons should be disabled
const isMaxZoom = computed(() => mapStore.zoom >= mapStore.zoomMax)
const isMinZoom = computed(() => mapStore.zoom <= mapStore.zoomMin)

function zoomIn() {
  mapStore.zoomBy(0.5)
}
function zoomOut() {
  mapStore.zoomBy(-0.5)
}
function panUp() {
  mapStore.panBy([0, -30])
}
function panDown() {
  mapStore.panBy([0, 30])
}
function panLeft() {
  mapStore.panBy([-30, 0])
}
function panRight() {
  mapStore.panBy([30, 0])
}
</script>

<template>
  <div class="bg-dark flex w-full rounded-lg px-1 py-2 align-middle">
    <!-- Zoom controls -->
    <div class="flex flex-1 items-center justify-center gap-2">
      <button
        class="btn btn-icon"
        :class="{ 'btn-disabled': isMaxZoom }"
        :disabled="isMaxZoom"
        :title="isMaxZoom ? 'Maximum zoom reached' : 'Zoom in'"
        @click="zoomIn"
      >
        <ZoomIn24Regular />
      </button>
      <button
        class="btn btn-icon"
        :class="{ 'btn-disabled': isMinZoom }"
        :disabled="isMinZoom"
        :title="isMinZoom ? 'Minimum zoom reached' : 'Zoom out'"
        @click="zoomOut"
      >
        <ZoomOut24Regular />
      </button>
    </div>
    <div class="border-dark w-1 border-l"></div>
    <!-- Navigation controls - plus/cross shape using CSS Grid -->
    <div class="flex flex-1 items-center justify-center">
      <div class="nav-grid">
        <button class="btn btn-icon h-9 w-9" style="grid-area: up" @click="panUp">
          <ArrowCircleUp24Regular />
        </button>
        <button class="btn btn-icon h-9 w-9" style="grid-area: left" @click="panLeft">
          <ArrowCircleLeft24Regular />
        </button>
        <button class="btn btn-icon h-9 w-9" style="grid-area: right" @click="panRight">
          <ArrowCircleRight24Regular />
        </button>
        <button class="btn btn-icon h-9 w-9" style="grid-area: down" @click="panDown">
          <ArrowCircleDown24Regular />
        </button>
      </div>
    </div>
    <div class="border-dark w-1 border-l"></div>
    <!-- Mode switch -->
    <div class="flex flex-1 items-center justify-center">
      <button
        class="btn btn-icon"
        title="Sandbox mode"
        @click="appMode = 'sandbox'"
      >
        <BoxToolbox20Regular />
      </button>
    </div>
  </div>
</template>

<style scoped>
@reference "../assets/tailwind.css";

.nav-grid {
  @apply grid rounded;
  grid-template-areas:
    '. up .'
    'left . right'
    '. down .';
  grid-template-columns: repeat(3, 2rem);
  grid-template-rows: repeat(3, 2rem);
}
</style>
