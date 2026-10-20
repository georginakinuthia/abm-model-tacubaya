/**
 * Minimal frame-timing profiler for comparing sim performance before/after
 * the agentscript-removal refactor.
 *
 * Usage (in browser devtools):
 *
 *   window.__profile = true   // enable recording
 *   // ...start the sim, let it run for at least a few seconds...
 *   __simPerf.report()        // print summary to console
 *   __simPerf.reset()         // clear samples
 *   window.__profile = false  // disable
 *
 * Records per-tick-callback wall time (covers sim step + render for both
 * model A and B). Designed to be a zero-overhead no-op when disabled.
 *
 * This file is temporary scaffolding — remove after the refactor ships and
 * the perf comparison is captured in commit messages or a perf.md.
 */

// Window-global interface for devtools access without using `any`.
interface ProfileWindow extends Window {
  __profile?: boolean
  __simPerf?: {
    report: () => PerfReport | undefined
    reset: () => void
    raw: () => number[]
  }
}

function profileWindow(): ProfileWindow | undefined {
  return typeof window === 'undefined' ? undefined : (window as ProfileWindow)
}

// Ring buffer of most recent frame durations in ms
const CAPACITY = 2048
const samples = new Float64Array(CAPACITY)
let writeIdx = 0
let filled = 0

/**
 * Called with the wall-clock duration (ms) of one tick-callback invocation.
 * No-op when window.__profile is falsy.
 */
export function recordFrame(durationMs: number): void {
  const w = profileWindow()
  if (!w || !w.__profile) return
  samples[writeIdx] = durationMs
  writeIdx = (writeIdx + 1) % CAPACITY
  if (filled < CAPACITY) filled++
}

interface PerfReport {
  samples: number
  mean: string
  median: string
  p90: string
  p99: string
  max: string
  budget33ms: string  // % of frames under 33 ms (30 FPS budget)
  budget16ms: string  // % of frames under 16 ms (60 FPS budget)
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[i]!
}

function buildReport(): PerfReport | null {
  if (filled === 0) return null
  const active: number[] = []
  for (let i = 0; i < filled; i++) active.push(samples[i]!)
  active.sort((a, b) => a - b)

  const mean = active.reduce((a, b) => a + b, 0) / active.length
  const underBudget33 = active.filter((v) => v < 33).length / active.length
  const underBudget16 = active.filter((v) => v < 16).length / active.length

  return {
    samples: filled,
    mean: mean.toFixed(3),
    median: percentile(active, 50).toFixed(3),
    p90: percentile(active, 90).toFixed(3),
    p99: percentile(active, 99).toFixed(3),
    max: active[active.length - 1]!.toFixed(3),
    budget33ms: (underBudget33 * 100).toFixed(1) + '%',
    budget16ms: (underBudget16 * 100).toFixed(1) + '%',
  }
}

// Expose a small window-global for devtools access.
{
  const w = profileWindow()
  if (w) {
    w.__simPerf = {
      report() {
        const r = buildReport()
        if (!r) {
          console.warn('[__simPerf] no samples yet — set window.__profile = true and run the sim')
          return undefined
        }
        console.warn('[__simPerf] frame durations (ms):', r)
        return r
      },
      reset() {
        writeIdx = 0
        filled = 0
        console.warn('[__simPerf] cleared')
      },
      raw: () => {
        if (filled === 0) return []
        const active: number[] = []
        for (let i = 0; i < filled; i++) active.push(samples[i]!)
        return active
      },
    }
  }
}
