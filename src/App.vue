<template>
  <main class="flex h-screen w-screen">
    <MapView v-if="mode === 'freetown'" />
    <SandboxView v-else />
  </main>
</template>

<script setup lang="ts">
import 'maplibre-gl/dist/maplibre-gl.css'

import { defineAsyncComponent,provide, ref } from 'vue'

import MapView from './components/MapView.vue'

const SandboxView = defineAsyncComponent(() => import('./components/SandboxView.vue'))

const mode = ref<'freetown' | 'sandbox'>('freetown')
provide('appMode', mode)
</script>
