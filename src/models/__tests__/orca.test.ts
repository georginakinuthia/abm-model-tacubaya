import { describe, expect,it } from 'vitest'

import { type OrcaAgent, type OrcaParams,solveORCA, SpatialHashGrid } from '../orca'

// --- SpatialHashGrid ---

describe('SpatialHashGrid', () => {
  // Helper: insert an agent using positional args (matches the hot-path API
  // used by Simulation.rebuildSpatialHash — no per-call object allocation).
  function insertAgent(grid: SpatialHashGrid, id: number, x: number, y: number): void {
    grid.insert(id, x, y, 0, 0, 0.3, 2)
  }

  it('returns agents within radius', () => {
    const grid = new SpatialHashGrid(10)
    insertAgent(grid, 1, 5, 5)
    insertAgent(grid, 2, 6, 5)
    insertAgent(grid, 3, 100, 100)

    const result = grid.queryNearest(5, 5, 10, -1, 10)
    expect(result.map((a) => a.id).sort()).toEqual([1, 2])
  })

  it('excludes the querying agent by id', () => {
    const grid = new SpatialHashGrid(10)
    insertAgent(grid, 1, 5, 5)
    insertAgent(grid, 2, 6, 5)

    const result = grid.queryNearest(5, 5, 10, 1, 10)
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe(2)
  })

  it('respects maxResults', () => {
    const grid = new SpatialHashGrid(10)
    for (let i = 0; i < 20; i++) {
      insertAgent(grid, i, 5 + i * 0.1, 5)
    }

    const result = grid.queryNearest(5, 5, 10, -1, 5)
    expect(result).toHaveLength(5)
  })

  it('returns results sorted by distance', () => {
    const grid = new SpatialHashGrid(10)
    insertAgent(grid, 1, 10, 0)
    insertAgent(grid, 2, 2, 0)
    insertAgent(grid, 3, 5, 0)

    const result = grid.queryNearest(0, 0, 15, -1, 10)
    expect(result.map((a) => a.id)).toEqual([2, 3, 1])
  })

  it('returns empty for no agents in range', () => {
    const grid = new SpatialHashGrid(10)
    insertAgent(grid, 1, 100, 100)

    const result = grid.queryNearest(0, 0, 5, -1, 10)
    expect(result).toHaveLength(0)
  })

  it('returns empty for empty grid', () => {
    const grid = new SpatialHashGrid(10)
    const result = grid.queryNearest(0, 0, 10, -1, 10)
    expect(result).toHaveLength(0)
  })

  it('finds agents at cell boundaries', () => {
    const grid = new SpatialHashGrid(10)
    // Agent right at the boundary between cells (9.99 and 10.01)
    insertAgent(grid, 1, 9.99, 0)
    insertAgent(grid, 2, 10.01, 0)

    // Query from cell 0, radius should reach into cell 1
    const result = grid.queryNearest(5, 0, 6, -1, 10)
    expect(result.map((a) => a.id).sort()).toEqual([1, 2])
  })

  it('clears all agents', () => {
    const grid = new SpatialHashGrid(10)
    insertAgent(grid, 1, 5, 5)
    grid.clear()

    const result = grid.queryNearest(5, 5, 10, -1, 10)
    expect(result).toHaveLength(0)
  })
})

// --- ORCA Solver ---

describe('solveORCA', () => {
  const defaultParams: OrcaParams = {
    timeHorizon: 2.0,
    agentRadius: 0.3,
    maxNeighbors: 8,
    neighborDist: 10,
    headOnBias: 0.4,
  }

  // Test helper — allocates a fresh result object per call. Production code
  // passes a reusable out-param to avoid per-tick allocation; tests can
  // afford the allocation for convenience.
  function solveOrca(
    agent: OrcaAgent,
    neighbors: OrcaAgent[],
    prefVx: number,
    prefVy: number,
    params: OrcaParams,
    dt: number,
  ): { vx: number; vy: number } {
    const out = { vx: 0, vy: 0 }
    solveORCA(agent, neighbors, prefVx, prefVy, params, dt, out)
    return out
  }

  it('returns preferred velocity when no neighbors', () => {
    const agent: OrcaAgent = { id: 0, x: 0, y: 0, vx: 1, vy: 0, radius: 0.3, maxSpeed: 2 }
    const result = solveOrca(agent, [], 1, 0, defaultParams, 0.25)
    expect(result.vx).toBeCloseTo(1, 5)
    expect(result.vy).toBeCloseTo(0, 5)
  })

  it('clamps preferred velocity to maxSpeed', () => {
    const agent: OrcaAgent = { id: 0, x: 0, y: 0, vx: 0, vy: 0, radius: 0.3, maxSpeed: 1 }
    const result = solveOrca(agent, [], 5, 0, defaultParams, 0.25)
    const speed = Math.hypot(result.vx, result.vy)
    expect(speed).toBeLessThanOrEqual(1 + EPSILON)
  })

  it('produces "pass on the right" avoidance for head-on agents', () => {
    // Distance 3m, closing speed 2 m/s → collision in ~1.2s, within 2s horizon
    const agentA: OrcaAgent = {
      id: 0, x: -1.5, y: 0, vx: 1, vy: 0, radius: 0.3, maxSpeed: 2,
    }
    const agentB: OrcaAgent = {
      id: 1, x: 1.5, y: 0, vx: -1, vy: 0, radius: 0.3, maxSpeed: 2,
    }

    const resultA = solveOrca(agentA, [agentB], 1, 0, defaultParams, 0.25)
    const resultB = solveOrca(agentB, [agentA], -1, 0, defaultParams, 0.25)

    // Both should deflect laterally (vy != 0)
    expect(Math.abs(resultA.vy)).toBeGreaterThan(0.01)
    expect(Math.abs(resultB.vy)).toBeGreaterThan(0.01)
    // "Pass on the right": A moves right (vy < 0 for rightward when heading +x),
    // B moves right (vy > 0 for rightward when heading -x) → they separate
    expect(resultA.vy).toBeLessThan(0)
    expect(resultB.vy).toBeGreaterThan(0)
  })

  it('does not produce NaN for overlapping agents', () => {
    const agent: OrcaAgent = {
      id: 0, x: 0, y: 0, vx: 1, vy: 0, radius: 0.3, maxSpeed: 2,
    }
    const neighbor: OrcaAgent = {
      id: 1, x: 0.1, y: 0, vx: -1, vy: 0, radius: 0.3, maxSpeed: 2,
    }

    const result = solveOrca(agent, [neighbor], 1, 0, defaultParams, 0.25)
    expect(Number.isFinite(result.vx)).toBe(true)
    expect(Number.isFinite(result.vy)).toBe(true)
  })

  it('output speed does not exceed maxSpeed', () => {
    const agent: OrcaAgent = {
      id: 0, x: 0, y: 0, vx: 1, vy: 0, radius: 0.3, maxSpeed: 1.5,
    }
    // Surround with several neighbors to stress the solver
    const neighbors: OrcaAgent[] = [
      { id: 1, x: 2, y: 0, vx: -1, vy: 0, radius: 0.3, maxSpeed: 2 },
      { id: 2, x: 0, y: 2, vx: 0, vy: -1, radius: 0.3, maxSpeed: 2 },
      { id: 3, x: -2, y: 0, vx: 1, vy: 0, radius: 0.3, maxSpeed: 2 },
      { id: 4, x: 0, y: -2, vx: 0, vy: 1, radius: 0.3, maxSpeed: 2 },
    ]

    const result = solveOrca(agent, neighbors, 1, 0, defaultParams, 0.25)
    const speed = Math.hypot(result.vx, result.vy)
    expect(speed).toBeLessThanOrEqual(1.5 + 0.01)
  })

  it('avoids a stationary obstacle ahead', () => {
    // Agent heading toward a close off-axis obstacle. Combined radius > distance
    // triggers the overlap escape path (dt-based), which always produces avoidance.
    const agent: OrcaAgent = {
      id: 0, x: 0, y: 0, vx: 1, vy: 0, radius: 0.5, maxSpeed: 2,
    }
    const obstacle: OrcaAgent = {
      id: 1, x: 0.8, y: 0.2, vx: 0, vy: 0, radius: 0.5, maxSpeed: 0,
    }

    const result = solveOrca(agent, [obstacle], 1, 0, defaultParams, 0.25)
    // Should deflect laterally or slow down
    const lateralDeflection = Math.abs(result.vy)
    const speedReduction = result.vx < 1
    expect(lateralDeflection > 0.01 || speedReduction).toBe(true)
  })
})

const EPSILON = 1e-4
