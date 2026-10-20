import { difference, featureCollection } from '@turf/turf'
import type { Feature, FeatureCollection, Geometry, Point, Polygon } from 'geojson'

import { WGS84 } from '../config'

export interface SandboxTerrainDef {
  id: string
  label: string
  description: string
  surfaces: FeatureCollection<Geometry>
  structures: FeatureCollection<Geometry>
  stalls: FeatureCollection<Geometry>
  furniture: FeatureCollection<Geometry>
  shade: FeatureCollection<Geometry>
  nodes: FeatureCollection<Geometry>
  bbox: [number, number, number, number]
}

const M = WGS84.degPerMeterEquator

function makeRect(
  cx: number,
  cy: number,
  w: number,
  h: number,
): [number, number][] {
  const hw = w / 2
  const hh = h / 2
  return [
    [cx - hw, cy - hh],
    [cx + hw, cy - hh],
    [cx + hw, cy + hh],
    [cx - hw, cy + hh],
    [cx - hw, cy - hh], // close ring
  ]
}

function rectFeature(
  cx: number,
  cy: number,
  w: number,
  h: number,
): Feature<Polygon> {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [makeRect(cx * M, cy * M, w * M, h * M)],
    },
  }
}

function pointFeature(
  x: number,
  y: number,
  props: Record<string, unknown>,
): Feature<Point> {
  return {
    type: 'Feature',
    properties: props,
    geometry: { type: 'Point', coordinates: [x * M, y * M] },
  }
}

function circleFeature(
  cx: number,
  cy: number,
  r: number,
  n: number = 20,
): Feature<Polygon> {
  const coords: [number, number][] = []
  for (let i = 0; i <= n; i++) {
    const angle = (2 * Math.PI * i) / n
    coords.push([(cx + r * Math.cos(angle)) * M, (cy + r * Math.sin(angle)) * M])
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [coords] },
  }
}

function fc(features: Feature[] = []): FeatureCollection<Geometry> {
  return { type: 'FeatureCollection', features }
}

// bbox from half-extents: makeBbox(hw, hh) where hw/hh are half the terrain width/height + padding
function makeBbox(hw: number, hh: number): [number, number, number, number] {
  return [-hw * M, -hh * M, hw * M, hh * M]
}

// Subtract obstacle polygons from a surface polygon, producing a polygon with holes.
// The resulting surface has non-walkable voids where obstacles are.
function cutSurface(
  surface: Feature<Polygon>,
  obstacles: Feature<Polygon>[],
): Feature<Polygon> {
  if (obstacles.length === 0) return surface
  const result = difference(featureCollection([surface, ...obstacles]))
  return (result as Feature<Polygon>) ?? surface
}

// --- Terrain 1: Long Corridor ---
// 120m × 15m walkway with a row of trees along the south edge
function longCorridor(): SandboxTerrainDef {
  // Round trees: north row on left half, south row on right half
  const treeRadius = 2.5
  const treeY = 5.5
  const shade: Feature<Polygon>[] = []
  for (let x = -50; x <= 0; x += 6) {
    shade.push(circleFeature(x, treeY, treeRadius))   // north row, left half
  }
  for (let x = 0; x <= 50; x += 6) {
    shade.push(circleFeature(x, -treeY, treeRadius))  // south row, right half
  }

  return {
    id: 'long-corridor',
    label: 'Long Corridor',
    description: '120m × 15m walkway with shade on both sides. Tests shade preference and lane formation.',
    surfaces: fc([rectFeature(0, 0, 120, 15)]),
    structures: fc(),
    stalls: fc(),
    furniture: fc(),
    shade: fc(shade),
    nodes: fc([
      pointFeature(-55, 0, { id: 'node-1', name: 'West', pph: 3600, noEngagement: true }),
      pointFeature(55, 0, { id: 'node-2', name: 'East', pph: 3600, noEngagement: true }),
    ]),
    bbox: makeBbox(70, 15),
  }
}

// --- Terrain 2: Corridor with Obstruction ---
// 120m × 20m walkway with a central wall barrier
function corridorWithObstruction(): SandboxTerrainDef {
  const surface = rectFeature(0, 0, 120, 20)
  // Wall: 2m thick × 14m tall, leaving 3m gaps at top and bottom edges
  const wall = rectFeature(0, 0, 2, 14)

  return {
    id: 'corridor-obstruction',
    label: 'Corridor + Obstruction',
    description: '120m × 20m walkway with a central wall barrier. Tests routing around obstacles.',
    surfaces: fc([cutSurface(surface, [wall])]),
    structures: fc([wall]),
    stalls: fc(),
    furniture: fc(),
    shade: fc(),
    nodes: fc([
      pointFeature(-55, 0, { id: 'node-1', name: 'West', pph: 3600, noEngagement: true }),
      pointFeature(55, 0, { id: 'node-2', name: 'East', pph: 3600, noEngagement: true }),
    ]),
    bbox: makeBbox(70, 18),
  }
}

// --- Terrain 3: Open Plaza ---
// 100m × 100m square
function openPlaza(): SandboxTerrainDef {
  return {
    id: 'open-plaza',
    label: 'Open Plaza',
    description: '100m × 100m open square. Tests crowd dynamics in unconstrained space.',
    surfaces: fc([rectFeature(0, 0, 100, 100)]),
    structures: fc(),
    stalls: fc(),
    furniture: fc(),
    shade: fc(),
    nodes: fc([
      pointFeature(-40, -40, { id: 'node-1', name: 'SW', pph: 3600 }),
      pointFeature(40, -40, { id: 'node-2', name: 'SE', pph: 3600 }),
      pointFeature(40, 40, { id: 'node-3', name: 'NE', pph: 3600 }),
      pointFeature(-40, 40, { id: 'node-4', name: 'NW', pph: 3600 }),
    ]),
    bbox: makeBbox(75, 75),
  }
}

// --- Terrain 4: Plaza with Obstructions ---
// 100m × 100m square with scattered barriers and stalls
function plazaWithObstructions(): SandboxTerrainDef {
  const surface = rectFeature(0, 0, 100, 100)

  // All obstacles are cut from the surface so they act as hard walls.
  // Obstacle layout — no overlaps. Extents listed for verification.
  const obstacles = [
    // Barrier blocks — large enough to force meaningful detours
    rectFeature(-20, 28, 24, 6),   //  1: x -32..-8,  y 25..31
    rectFeature(-33, 12, 6, 20),   //  2: x -36..-30, y  2..22
    rectFeature(0, 0, 14, 14),     //  3: x  -7.. 7,  y -7.. 7
    rectFeature(25, 8, 6, 28),     //  4: x  22..28,  y -6..22
    rectFeature(-15, -22, 20, 6),  //  5: x -25..-5,  y-25..-19
    rectFeature(14, -26, 12, 10),  //  6: x   8..20,  y-31..-21
    rectFeature(-8, -35, 14, 6),   //  7: x -15..-1,  y-38..-32
    rectFeature(32, 30, 16, 10),   //  8: x  24..40,  y 25..35
    rectFeature(-14, 10, 10, 6),   //  9: x -19..-9,  y  7..13
    rectFeature(30, -18, 6, 20),   // 10: x  27..33,  y-28.. -8
    // Market stalls
    rectFeature(-35, -2, 10, 6),   // 11: x -40..-30, y -5.. 1
    rectFeature(-35, -12, 10, 6),  // 12: x -40..-30, y-15.. -9
    rectFeature(15, 34, 6, 12),    // 13: x  12..18,  y 28..40
    rectFeature(10, -14, 6, 10),   // 14: x   7..13,  y-19.. -9
  ]

  // Furniture — also cut from surface as hard walls
  const furnitureItems = [
    rectFeature(0, 36, 6, 6),     // x -3..3,   y 33..39
    rectFeature(-25, -32, 6, 6),  // x-28..-22, y-35..-29
  ]

  const allWalls = [...obstacles, ...furnitureItems]

  return {
    id: 'plaza-obstructions',
    label: 'Plaza + Obstructions',
    description: '100m × 100m plaza with dense obstacles and stalls. Tests complex routing.',
    surfaces: fc([cutSurface(surface, allWalls)]),
    structures: fc(allWalls),
    stalls: fc(),
    furniture: fc(),
    shade: fc(),
    nodes: fc([
      pointFeature(-40, -40, { id: 'node-1', name: 'SW', pph: 3600 }),
      pointFeature(40, -40, { id: 'node-2', name: 'SE', pph: 3600 }),
      pointFeature(40, 40, { id: 'node-3', name: 'NE', pph: 3600 }),
      pointFeature(-40, 40, { id: 'node-4', name: 'NW', pph: 3600 }),
    ]),
    bbox: makeBbox(75, 75),
  }
}

export const SANDBOX_TERRAINS: SandboxTerrainDef[] = [
  longCorridor(),
  corridorWithObstruction(),
  openPlaza(),
  plazaWithObstructions(),
]
