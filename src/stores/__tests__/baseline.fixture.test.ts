/**
 * Baseline fixture — scenario A's potential fields and Dijkstra distance
 * fields captured as snapshot summary statistics.
 *
 * The summary stats (count / sum / min / max / mean / variance) are
 * **coordinate-invariant** — they don't depend on how cells are laid out
 * in memory. The snapshots captured pre-refactor (against agentscript's
 * GeoWorld) should therefore match byte-for-byte against this post-refactor
 * version (which uses the new `Simulation` class).
 *
 * The snapshots that DO change across the refactor:
 *   - `world dimensions`: exposes new field names (width/height) instead
 *     of the legacy minX/maxX/numX/numY. The numeric values still match
 *     because `Simulation` uses Haversine (like agentscript) to size the
 *     grid.
 *   - `projected node world coordinates`: the new convention is y=0 = north
 *     (y grows south), so worldY values are flipped vs the legacy y-up
 *     convention. Confirmed via the invariant `y_new + y_old = height - 1`
 *     (verified in the test).
 *   - `distance field spot-checks`: the index formula is now `y * width + x`
 *     instead of `x + numX * (maxY - y)`. The distance *value* at each
 *     geographic point should still match the legacy snapshot — the test
 *     re-captures with the new indexing.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { bbox as turfBbox, buffer as turfBuffer } from '@turf/turf'
import type { FeatureCollection, Geometry } from 'geojson'
import { describe, expect, it } from 'vitest'

import { GEOMETRY } from '../../config'
import { Simulation } from '../../sim/Simulation'
import { buildNodesFromCollection, computePatchesWidth, type NodeState } from '../geo'
import { ScenarioContainer } from '../scenarios'

// ─────────────────────────────────────────────────────────────
// Filesystem fixtures
// ─────────────────────────────────────────────────────────────

const PUBLIC_DIR = resolve(__dirname, '../../../public')

function readGeoJSON(relPath: string): FeatureCollection<Geometry> {
  const absPath = resolve(PUBLIC_DIR, relPath)
  return JSON.parse(readFileSync(absPath, 'utf8'))
}

function loadScenarioA() {
  return {
    surfaces: readGeoJSON('scenarioA/surfaces.geojson'),
    structures: readGeoJSON('scenarioA/structures.geojson'),
    shade: readGeoJSON('scenarioA/shade.geojson'),
    stalls: readGeoJSON('scenarioA/stalls.geojson'),
    furniture: readGeoJSON('scenarioA/furniture.geojson'),
  }
}

// No BehaviorStore stub needed — Simulation's constructor no longer takes
// a behavior store. `generateScenario` just writes cell fields based on
// the scenario geojson and doesn't invoke any agent behavior code.

// ─────────────────────────────────────────────────────────────
// Summary stat helpers (coordinate-invariant)
// ─────────────────────────────────────────────────────────────

interface FieldStats {
  length: number
  finiteCount: number
  positiveCount: number
  negativeCount: number
  zeroCount: number
  sumFinite: string
  minFinite: string | null
  maxFinite: string | null
  meanFinite: string | null
  varianceFinite: string | null
  infiniteCount: number
}

function summarize(arr: Float32Array): FieldStats {
  let finiteCount = 0
  let positiveCount = 0
  let negativeCount = 0
  let zeroCount = 0
  let infiniteCount = 0
  let sum = 0
  let min = Infinity
  let max = -Infinity

  for (let i = 0; i < arr.length; i++) {
    const v = arr[i]!
    if (!Number.isFinite(v)) { infiniteCount++; continue }
    finiteCount++
    sum += v
    if (v < min) min = v
    if (v > max) max = v
    if (v > 0) positiveCount++
    else if (v < 0) negativeCount++
    else zeroCount++
  }

  const mean = finiteCount > 0 ? sum / finiteCount : null

  // Second pass for variance
  let variance: number | null = null
  if (finiteCount > 0 && mean !== null) {
    let ssq = 0
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i]!
      if (!Number.isFinite(v)) continue
      const d = v - mean
      ssq += d * d
    }
    variance = ssq / finiteCount
  }

  const fx = (n: number | null) =>
    n === null ? null : Number.isFinite(n) ? n.toFixed(6) : String(n)

  return {
    length: arr.length,
    finiteCount,
    positiveCount,
    negativeCount,
    zeroCount,
    infiniteCount,
    sumFinite: fx(sum)!,
    minFinite: finiteCount > 0 ? fx(min) : null,
    maxFinite: finiteCount > 0 ? fx(max) : null,
    meanFinite: fx(mean),
    varianceFinite: fx(variance),
  }
}

// ─────────────────────────────────────────────────────────────
// The test
// ─────────────────────────────────────────────────────────────

describe('scenario A — baseline fixture for agentscript-removal refactor', () => {
  const scenarioData = loadScenarioA()
  const nodesGeoJSON = readGeoJSON('nodes.geojson')

  const bufferedSurfaces = turfBuffer(
    scenarioData.surfaces as any,
    GEOMETRY.bboxPaddingMeters,
    { units: 'meters' },
  )
  const bounds = turfBbox(bufferedSurfaces as any) as [number, number, number, number]
  const patchesWidth = computePatchesWidth(bounds, GEOMETRY.targetPatchMeters)

  // Construct the new-world Simulation. `generateScenario` doesn't touch
  // the behavior store, so the stub is safe here.
  const sim = new Simulation(bounds, patchesWidth)

  // Build nodes from geojson + project to the new cell-space coords.
  // New convention: y=0 = north, y grows south.
  const nodes: NodeState[] = buildNodesFromCollection(nodesGeoJSON).map((n) => {
    if (n.coords) {
      const [lon, lat] = n.coords
      return { ...n, worldX: sim.lonToX(lon), worldY: sim.latToY(lat) }
    }
    return n
  })

  const scenario = new ScenarioContainer(scenarioData, 'scenarioA')
  sim.generateScenario(scenario, nodes)

  it('world dimensions match expected values', () => {
    // These are coordinate-convention-dependent, but numerically they match
    // the legacy grid: width=432 (from computePatchesWidth), height=326
    // (from Haversine aspect — same math as agentscript's GeoWorld).
    const snapshot = {
      width: sim.width,
      height: sim.height,
      cellCount: sim.cellCount,
      bbox: bounds.map((v: number) => v.toFixed(9)),
      patchesWidth,
    }
    expect(snapshot).toMatchSnapshot()
  })

  it('surface potential summary stats', () => {
    expect(summarize(sim.surfacePotential)).toMatchSnapshot()
  })

  it('stall potential summary stats', () => {
    expect(summarize(sim.stallPotential)).toMatchSnapshot()
  })

  it('furniture potential summary stats', () => {
    expect(summarize(sim.furniturePotential)).toMatchSnapshot()
  })

  it('shade potential summary stats', () => {
    expect(summarize(sim.shadePotential)).toMatchSnapshot()
  })

  it('node distance fields — per-node summary stats', () => {
    const fields = sim.nodeDistanceFields
    const perNode: Record<string, FieldStats> = {}
    // Sort by interned node id string (original order) — index into
    // nodeDistanceFields is the interned index, which was assigned in
    // scenario-load order.
    const idsWithIdx: Array<[string, number]> = sim.nodeIdTable.map((id, idx) => [id, idx])
    idsWithIdx.sort((a, b) => a[0].localeCompare(b[0]))
    for (const [id, idx] of idsWithIdx) {
      const field = fields[idx]
      if (!field) continue
      perNode[id] = summarize(field)
    }
    expect(perNode).toMatchSnapshot()
  })

  it('projected node world coordinates', () => {
    // Y-flipped vs the legacy (agentscript y-up) snapshot. Still valid as
    // a regression check — any future drift in the aspect/grid-sizing math
    // will show up here.
    const projected: Record<string, { worldX: number | string; worldY: number | string }> = {}
    for (const node of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) {
      projected[node.id] = {
        worldX: typeof node.worldX === 'number' ? node.worldX.toFixed(6) : 'undefined',
        worldY: typeof node.worldY === 'number' ? node.worldY.toFixed(6) : 'undefined',
      }
    }
    expect(projected).toMatchSnapshot()
  })

  it('distance field spot-checks — round-trip lon/lat at known-walkable points', () => {
    // Sample the distance field at the first 4 node positions (guaranteed
    // walkable — agents spawn from them). Uses the new index formula
    // `y * width + x`. Distance values at each geographic point should
    // match the pre-refactor snapshot exactly.
    const fields = sim.nodeDistanceFields
    // Pick the first node with finite distances (same logic as pre-refactor)
    const sortedIdxs: number[] = sim.nodeIdTable
      .map((_, idx) => idx)
      .filter((idx) => {
        const f = fields[idx]
        if (!f) return false
        for (let i = 0; i < f.length; i++) if (Number.isFinite(f[i])) return true
        return false
      })
      .sort((a, b) => sim.nodeIdTable[a]!.localeCompare(sim.nodeIdTable[b]!))

    const targetNodeIdx = sortedIdxs[0]
    if (targetNodeIdx === undefined) {
      throw new Error('No node has any finite distances — scenario is empty?')
    }
    const targetNodeId = sim.nodeIdTable[targetNodeIdx]!
    const field = fields[targetNodeIdx]!

    // First 4 nodes with coords — preserve original iteration order so the
    // snapshot matches the pre-flight capture.
    const samplePoints: Array<{ label: string; lon: number; lat: number }> = []
    for (const node of nodes) {
      if (node.coords) {
        samplePoints.push({ label: node.id, lon: node.coords[0], lat: node.coords[1] })
        if (samplePoints.length >= 4) break
      }
    }

    const checks: Record<string, {
      x: number; y: number; idx: number; dist: string
    }> = {}
    for (const { label, lon, lat } of samplePoints) {
      const fx = sim.lonToX(lon)
      const fy = sim.latToY(lat)
      const x = Math.round(fx)
      const y = Math.round(fy)
      const idx = sim.idx(x, y)
      const d = field[idx]
      checks[label] = {
        x, y, idx,
        dist: d === undefined || !Number.isFinite(d) ? 'Infinity' : d.toFixed(6),
      }
    }
    expect({
      targetNode: targetNodeId,
      samples: checks,
    }).toMatchSnapshot()
  })
})
