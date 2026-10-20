/**
 * Unit tests for the main-thread SimView proxy.
 *
 * Worker integration is out of scope here — these tests drive SimView in
 * isolation using hand-built SimSnapshot payloads (the same shape the
 * worker would ship over postMessage).
 */

import { describe, expect, it } from 'vitest'

import { createEmptySnapshot, type SimSnapshot } from '../SimSnapshot'
import { SimView } from '../SimView'

function makeView(nodeIdTable: string[] = ['nodeA', 'nodeB', 'nodeC']): SimView {
  return new SimView({
    width: 10,
    height: 10,
    bbox: [0, 0, 1, 1],
    cellColorBuffer: new Uint32Array(100),
    nodeIdTable,
  })
}

function makeSnapshot(pedCount: number, capacity = 256): SimSnapshot {
  const snap = createEmptySnapshot(capacity)
  snap.pedCount = pedCount
  return snap
}

describe('SimView', () => {
  it('exposes static state from the init options', () => {
    const view = makeView(['a', 'b'])
    expect(view.width).toBe(10)
    expect(view.height).toBe(10)
    expect(view.bbox).toEqual([0, 0, 1, 1])
    expect(view.cellColorBuffer.length).toBe(100)
    expect(view.nodeIdTable).toEqual(['a', 'b'])
  })

  it('marks snapshots as already-compacted so the renderer skips alive-checks', () => {
    const view = makeView()
    expect(view.snapshotIsCompacted).toBe(true)
  })

  it('returns -1 for null/undefined/unknown node ids in nodeIdxFor', () => {
    const view = makeView(['alpha', 'beta', 'gamma'])
    expect(view.nodeIdxFor(null)).toBe(-1)
    expect(view.nodeIdxFor(undefined)).toBe(-1)
    expect(view.nodeIdxFor('missing')).toBe(-1)
  })

  it('returns the interned index for known node ids via O(1) Map lookup', () => {
    const view = makeView(['alpha', 'beta', 'gamma'])
    expect(view.nodeIdxFor('alpha')).toBe(0)
    expect(view.nodeIdxFor('beta')).toBe(1)
    expect(view.nodeIdxFor('gamma')).toBe(2)
  })

  it('updateSnapshot swaps buffers and returns the previous snapshot', () => {
    const view = makeView()
    const first = view.snapshot
    const next = makeSnapshot(5)
    const returned = view.updateSnapshot(next)
    expect(returned).toBe(first)
    expect(view.snapshot).toBe(next)
    expect(view.pedCount).toBe(5)
  })

  it('pedAlive returns an all-ones buffer sized to the snapshot capacity', () => {
    const view = makeView()
    const alive = view.pedAlive
    expect(alive.length).toBeGreaterThanOrEqual(view.snapshot.capacity)
    for (let i = 0; i < 10; i++) expect(alive[i]).toBe(1)
  })

  it('pedAlive grows when a larger snapshot arrives', () => {
    const view = makeView()
    const big = makeSnapshot(1, 1024)
    view.updateSnapshot(big)
    const alive = view.pedAlive
    expect(alive.length).toBeGreaterThanOrEqual(1024)
    expect(alive[1023]).toBe(1)
  })

  it('lon/lat coordinate helpers match the half-cell offset convention', () => {
    const view = new SimView({
      width: 100,
      height: 100,
      bbox: [0, 0, 10, 10],
      cellColorBuffer: new Uint32Array(10_000),
      nodeIdTable: [],
    })
    // lonToX at minLon should land at -0.5 (west bbox edge is west of cell 0's center)
    expect(view.lonToX(0)).toBeCloseTo(-0.5, 10)
    // xToLon at x=-0.5 should round-trip back to minLon
    expect(view.xToLon(-0.5)).toBeCloseTo(0, 10)
    // latToY at maxLat should land at -0.5 (y grows south)
    expect(view.latToY(10)).toBeCloseTo(-0.5, 10)
    // yToLat round trip
    expect(view.yToLat(-0.5)).toBeCloseTo(10, 10)
  })

  it('cellCornersGeoJSON returns NW → NE → SE → SW tuples matching bbox', () => {
    const view = new SimView({
      width: 10,
      height: 10,
      bbox: [1, 2, 3, 4],
      cellColorBuffer: new Uint32Array(100),
      nodeIdTable: [],
    })
    const corners = view.cellCornersGeoJSON()
    expect(corners).toEqual([
      [1, 4],  // NW (minLon, maxLat)
      [3, 4],  // NE
      [3, 2],  // SE
      [1, 2],  // SW
    ])
  })
})
