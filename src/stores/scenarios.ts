import { buffer } from '@turf/turf'
import type { FeatureCollection, Geometry } from 'geojson'
import { defineStore } from 'pinia'
import { computed, markRaw, ref } from 'vue'

import { ScenarioContainer } from '../sim/scenarioGen'
import type { NodeState,ScenarioData } from './geo'
import {
  buildNodesFromCollection,
  computeNodeDistanceField,
  computeShortestPath,
  featureMask,
  type GridLike,
} from './geo'

// Re-export so existing imports from './scenarios' still work
export { buildNodesFromCollection,computeNodeDistanceField, computeShortestPath, featureMask }
export { ScenarioContainer }
export type { GridLike,NodeState, ScenarioData }

// Module-level helper: fetch and parse GeoJSON
export async function fetchGeoJSON(filename: string): Promise<FeatureCollection<Geometry>> {
  const url = new URL(filename, import.meta.url)
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Failed to fetch ${filename}: ${response.status} ${response.statusText}`)
  }

  const data = JSON.parse(await response.text()) as FeatureCollection<Geometry>

  // Basic validation
  if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
    throw new Error(`Invalid GeoJSON format in ${filename}`)
  }

  return data
}

// helper: buffer point features by their `dia` property (meters)
function bufferPointsByDia(fc: FeatureCollection<Geometry> | null) {
  if (!fc || !Array.isArray(fc.features)) {
    return { type: 'FeatureCollection' as const, features: [] }
  }

  const features = fc.features.map((f: any) => {
    const props = f.properties || {}
    const dia = Number(props.dia) || 5
    const radius = dia > 0 ? dia / 2 : 0

    if (radius > 0 && f.geometry && f.geometry.type === 'Point') {
      try {
        const buf = buffer(f as any, radius, { units: 'meters' })
        if (buf && buf.properties) {
          buf.properties = { ...props, dia }
        }
        return buf || { ...f, properties: { ...props, dia } }
      } catch (e) {
        return { ...f, properties: { ...props, dia } }
      }
    }

    return { ...f, properties: { ...props, dia } }
  })

  return { type: 'FeatureCollection' as const, features }
}

// Module-level loader that returns a ScenarioData object
export async function loadScenario(scenarioPath: string): Promise<ScenarioData> {
  const [furniture, stalls, structures, surfaces, shade] = await Promise.all([
    fetchGeoJSON(`/${scenarioPath}/furniture.geojson`),
    fetchGeoJSON(`/${scenarioPath}/stalls.geojson`),
    fetchGeoJSON(`/${scenarioPath}/structures.geojson`),
    fetchGeoJSON(`/${scenarioPath}/surfaces.geojson`),
    fetchGeoJSON(`/${scenarioPath}/trees.geojson`),
  ])

  return {
    furniture,
    stalls,
    structures,
    surfaces,
    shade,
  }
}

export const useScenariosStore = defineStore('scenarios', () => {
  // State: two ScenarioContainer instances
  const scenarioA = ref<ScenarioContainer | null>(null)
  const scenarioB = ref<ScenarioContainer | null>(null)
  const sharedNodes = ref<NodeState[]>([])
  const nodesBuffered = ref<FeatureCollection<Geometry> | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  const hasScenarios = computed(() => scenarioA.value !== null && scenarioB.value !== null)
  const isReady = computed(() => hasScenarios.value && !isLoading.value)

  async function loadScenarios() {
    if (isLoading.value) return
    isLoading.value = true
    try {
      // Load shared nodes first
      const sharedNodesGeoJSON = await fetchGeoJSON(`/nodes.geojson`)
      sharedNodes.value = buildNodesFromCollection(sharedNodesGeoJSON)
      nodesBuffered.value = bufferPointsByDia(sharedNodesGeoJSON)

      const [dataA, dataB] = await Promise.all([
        loadScenario('ft_before'),
        loadScenario('ft_after'),
      ])
      // markRaw: keeps Vue from deeply wrapping the FeatureCollection
      // fields in reactive proxies — necessary so the worker can
      // structured-clone them through postMessage().
      scenarioA.value = markRaw(new ScenarioContainer(dataA, 'ft_before'))
      scenarioB.value = markRaw(new ScenarioContainer(dataB, 'ft_after'))
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
      error.value = `Failed to load scenarios: ${errorMessage}`
      console.error('Error loading scenarios:', err)
    } finally {
      isLoading.value = false
    }
  }

  return {
    scenarioA,
    scenarioB,
    sharedNodes,
    nodesBuffered,
    isLoading,
    error,
    hasScenarios,
    isReady,
    loadScenarios,
  }
})
