<script setup>
import { ACCENT, EMBER, LIGHT } from '../assets/palette'
</script>

<template>
  <div class="map-legend">
    <div class="legend-item">
      <span class="legend-swatch" :style="{ borderColor: EMBER }"></span>
      <span>Stalls</span>
    </div>
    <div class="legend-item">
      <span class="legend-swatch" :style="{ borderColor: ACCENT }"></span>
      <span>Waiting</span>
    </div>
    <div class="legend-item">
      <span class="legend-swatch" :style="{ borderColor: LIGHT }"></span>
      <span>Trees</span>
    </div>
    <div class="legend-item">
      <span
        class="legend-swatch-radial"
        :style="{ background: `radial-gradient(circle, ${EMBER} 0%, ${ACCENT} 100%)` }"
      ></span>
      <span>Crowds</span>
    </div>
  </div>
</template>

<style scoped>
@reference "../assets/tailwind.css";

.map-legend {
  /* Radius matches MapLibre's compact attribution pill
   * (.maplibregl-ctrl-attrib.maplibregl-compact → 12px = rounded-xl). */
  @apply overflow-hidden rounded-xl
         bg-dark text-lighter
         pointer-events-none absolute bottom-3 left-3 z-10
         flex items-center gap-4 px-4 py-1.5 text-xs;
}

.legend-item {
  @apply flex items-center gap-1.5 whitespace-nowrap;
}

.legend-swatch {
  @apply inline-block h-2.5 w-2.5 rounded-sm border-2;
}

.legend-swatch-radial {
  @apply inline-block h-3 w-3 rounded-full;
}
</style>
