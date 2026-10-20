<script setup>
import maplibregl from 'maplibre-gl'
import { defineAsyncComponent, onMounted, onUnmounted } from 'vue'

import {
  ACCENT,
  DARKER,
  DARKEST,
  EMBER,
  LIGHT,
  LIGHTER,
} from '../assets/palette'
import { parseColorU32 } from '../sim/colors'
import { createMapRenderer } from '../sim/createMapRenderer'
import { useMapStore } from '../stores/map'
import { useModelsStore } from '../stores/models'
import { useScenariosStore } from '../stores/scenarios'
import { useSimulationStore } from '../stores/simulation'
import MapLegend from './MapLegend.vue'
// MapControls moved into CentralControls
const CentralControls = defineAsyncComponent(() => import('./CentralControl.vue'))

// Agent-rendering color palette. These are the same values used for the
// pedestrian sprites; the cell-overlay palette (stall/furniture/shade/
// surface gradients) lives in the models store and is shipped to the
// worker on init.
const AGENT_U32 = parseColorU32(LIGHTER)
const SHOPPING_U32 = parseColorU32(EMBER)
const WAITING_U32 = parseColorU32(ACCENT)
const HIGHLIGHT_U32 = parseColorU32(ACCENT)

const rendererColors = {
  agent: AGENT_U32,
  shopping: SHOPPING_U32,
  waiting: WAITING_U32,
  highlight: HIGHLIGHT_U32,
}

let mapA = null
let mapB = null

onMounted(async () => {
  // Initialize stores
  const scenariosStore = useScenariosStore()
  const mapStore = useMapStore()
  // Load scenarios if not already loaded
  if (!scenariosStore.hasScenarios) {
    await scenariosStore.loadScenarios()
  }
  // Wait for scenarios to be ready
  if (!scenariosStore.isReady) {
    console.error('Failed to load scenarios:', scenariosStore.error)
    return
  }
  const scenarioA = scenariosStore.scenarioA
  const scenarioB = scenariosStore.scenarioB
  const sharedNodes = scenariosStore.sharedNodes
  if (!scenarioA || !scenarioB) {
    console.error('Scenarios missing after load')
    return
  }

  // Spawn worker + run scenario gen inside it. Returns SimView proxies
  // that the renderer reads from (instead of a live Simulation).
  const modelsStore = useModelsStore()
  const [modelA, modelB] = await modelsStore.initModel(scenarioA, scenarioB, sharedNodes)

  // Cell colors are baked inside the worker during INIT. No main-thread bake.

  // Selected spawn-node getter for the agent highlight. Resolves the
  // (possibly reactive) current selection to its interned node index.
  const selectedStartNodeIdx = (view) => {
    const id = modelsStore.selectedNodeId
    if (id == null) return -1
    return view.nodeIdxFor(id)
  }

  // Create renderers — each takes a SimView (worker-backed) and draws
  // whatever snapshot the worker has most recently delivered.
  const viewA = createMapRenderer(modelA, {
    selectedStartNodeIdx: () => selectedStartNodeIdx(modelA),
    colors: rendererColors,
  })
  const viewB = createMapRenderer(modelB, {
    selectedStartNodeIdx: () => selectedStartNodeIdx(modelB),
    colors: rendererColors,
  })

  // Build GeoJSON FeatureCollection of live agent positions for the heatmap layer
  function buildAgentGeoJSON(sim) {
    const features = []
    const alive = sim.pedAlive
    const x = sim.pedX
    const y = sim.pedY
    const n = sim.pedCount
    for (let i = 0; i < n; i++) {
      if (alive[i] === 0) continue
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [sim.xToLon(x[i]), sim.yToLat(y[i])] },
        properties: {},
      })
    }
    return { type: 'FeatureCollection', features }
  }

  // Update a map's heatmap source with current agent positions
  function updateHeatmap(map, model) {
    const src = map.getSource('src-agent-heatmap')
    if (src) src.setData(buildAgentGeoJSON(model))
  }

  // ===== Create maps using store configuration =====
  mapA = new maplibregl.Map({
    container: 'mapA',
    ...mapStore.baseConfig,
  })

  mapB = new maplibregl.Map({
    container: 'mapB',
    ...mapStore.baseConfig,
  })

  // Set up map synchronization
  mapStore.setMapReferences(mapA, mapB)

  // Setup maps with their respective scenarios, models, and views
  const mapConfigs = [
    { map: mapA, scenario: scenarioA, model: modelA, view: viewA },
    { map: mapB, scenario: scenarioB, model: modelB, view: viewB },
  ]

  for (const { map, scenario, model, view } of mapConfigs) {
    map.on('load', function () {
      // --- Sources ---
      map.addSource('sim-canvas', {
        type: 'canvas',
        canvas: view.canvas,
        coordinates: model.cellCornersGeoJSON(),
      })
      map.addSource('src-agent-heatmap', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addSource('src-surfaces', {
        type: 'geojson',
        data: scenario.surfaces,
      })
      map.addLayer({
        id: 'surfaces-fill',
        type: 'fill',
        source: 'src-surfaces',
        paint: {
          'fill-color': DARKEST,
          'fill-opacity': 0.25,
        },
      })
      map.addLayer({
        id: 'surfaces',
        type: 'line',
        source: 'src-surfaces',
        paint: {
          'line-color': LIGHTER,
          'line-opacity': 0.8,
          'line-width': 3,
        },
      })
      map.addSource('src-structures', {
        type: 'geojson',
        data: scenario.structures,
      })
      map.addLayer({
        id: 'structures-outline',
        type: 'line',
        source: 'src-structures',
        paint: {
          'line-color': LIGHT,
          'line-opacity': 0.5,
          'line-width': 1.5,
        },
      })
      map.addLayer({
        id: 'structures',
        type: 'fill-extrusion',
        source: 'src-structures',
        paint: {
          'fill-extrusion-color': DARKER,
          'fill-extrusion-opacity': 0.8,
          'fill-extrusion-height': ['*', ['to-number', ['get', 'floors'], 1], 3],
        },
      })

      // nodes: show a small circle and a label using the `name` property
      map.addSource('src-nodes-buffer', { type: 'geojson', data: scenariosStore.nodesBuffered })
      map.addLayer({
        id: 'nodes',
        type: 'line',
        source: 'src-nodes-buffer',
        paint: {
          'line-color': LIGHTER,
          'line-opacity': 0.5,
          'line-width': 2,
        },
      })
      map.addLayer({
        id: 'nodes-labels',
        type: 'symbol',
        source: 'src-nodes-buffer',
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 12,
          'text-offset': [0, 1.0],
          'text-anchor': 'top',
        },
        paint: {
          'text-color': LIGHT,
          'text-halo-color': DARKEST,
          'text-halo-width': 1,
        },
      })

      // stalls — outline (matches shopping-agent EMBER)
      map.addSource('src-stalls-buffer', { type: 'geojson', data: scenario.stalls })
      map.addLayer({
        id: 'stalls',
        type: 'line',
        source: 'src-stalls-buffer',
        paint: {
          'line-color': EMBER,
          'line-opacity': 0.5,
          'line-width': 1.5,
        },
      })

      // furniture (waiting areas) — outline
      map.addSource('src-furniture-buffer', { type: 'geojson', data: scenario.furniture })
      map.addLayer({
        id: 'furniture',
        type: 'line',
        source: 'src-furniture-buffer',
        paint: {
          'line-color': ACCENT,
          'line-opacity': 0.5,
          'line-width': 2,
        },
      })

      // shade (trees) — outline only, raster patches handle the fill.
      // Neutral LIGHT so the tree canopy reads as environmental context
      // rather than competing with the stall/furniture feature colours.
      map.addSource('src-shade', { type: 'geojson', data: scenario.shade })
      map.addLayer({
        id: 'shade',
        type: 'line',
        source: 'src-shade',
        paint: {
          'line-color': LIGHT,
          'line-opacity': 0.5,
          'line-width': 1.5,
        },
      })

      // --- Agent layers — on top of all site layers ---
      map.addLayer({
        id: 'sim-canvas-layer',
        type: 'raster',
        source: 'sim-canvas',
        paint: {
          'raster-resampling': 'linear',
          'raster-opacity': 0.7,
        },
      })
      map.addLayer({
        id: 'agent-heatmap',
        type: 'heatmap',
        source: 'src-agent-heatmap',
        paint: {
          'heatmap-weight': 0.3,
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 16, 8, 18, 20, 20, 50],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 16, 1.2, 18, 1.5, 20, 2],
          'heatmap-opacity': 0.5,
          // Heatmap ramp: transparent accent → translucent accent → warm ember.
          // Hex values include an alpha byte (MapLibre accepts #RRGGBBAA).
          'heatmap-color': [
            'interpolate',
            ['linear'],
            ['heatmap-density'],
            0,
            `${ACCENT}00`,
            0.4,
            `${ACCENT}80`,
            0.8,
            `${EMBER}b3`,
            1,
            `${EMBER}e6`,
          ],
        },
      })
    })
  }
  console.log('Maps initialized.')
  // Register the renderers with the simulation store. The store owns
  // a rAF loop that draws each frame + pushes per-tick spawns to the
  // worker. The sim itself runs inside the worker.
  const simStore = useSimulationStore()
  try {
    simStore.registerMasterControllers({
      viewA,
      viewB,
      onTick: () => {
        updateHeatmap(mapA, modelA)
        updateHeatmap(mapB, modelB)
      },
    })
  } catch (e) {
    console.error('Failed to register master controllers with simulation store', e)
  }
})

onUnmounted(() => {
  const simStore = useSimulationStore()
  const mapStore = useMapStore()

  // Stop the sim worker, cancel the rAF loop, and clear the models
  // store's reactive state (views, nodes, stats). This fully tears down
  // the worker — re-mounting MapView respawns a fresh `SimWorkerClient`.
  simStore.destroy()

  // Destroy MapLibre maps (frees WebGL contexts, workers, event listeners)
  if (mapA) {
    mapA.remove()
    mapA = null
  }
  if (mapB) {
    mapB.remove()
    mapB = null
  }

  // Clear stale references in the map store
  mapStore.setMapReferences(null, null)
})
</script>

<template>
  <div class="page-grid bg-darkest">
    <div class="grid-sidebar">
      <CentralControls />
    </div>
    <div id="mapA" class="map-container grid-map-a relative">
      <MapLegend />
    </div>
    <div id="mapB" class="map-container grid-map-b relative">
      <MapLegend />
    </div>
  </div>
</template>

<style scoped>
@reference "../assets/tailwind.css";

.page-grid {
  @apply relative h-full w-full gap-1.5 p-1.5;
  display: grid;
  grid-template-columns: min(33.33%, 34rem) 1fr 1fr;
  grid-template-rows: 1fr;
}

.map-container {
  @apply overflow-hidden rounded-lg;
}

.grid-map-a {
  min-height: 0;
}

.grid-map-b {
  min-height: 0;
}

.grid-sidebar {
  @apply flex h-full w-full items-stretch overflow-hidden;
  min-height: 0;
}
</style>
