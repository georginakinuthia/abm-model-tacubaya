/**
 * Fixed-interval tick loop. Replaces `agentscript/src/Animator`.
 *
 * Differences from Animator:
 *  - Does NOT auto-start in constructor (caller invokes `handle.start()`).
 *    This lets the simulation store drop its auto-start-suppress workaround.
 *  - No Stats UI integration, no idle mode, no restart/toggle helpers.
 *  - Not a class — just a factory returning a handle.
 */

export interface LoopHandle {
  start: () => void
  stop: () => void
  readonly running: boolean
  readonly tickCount: number
}

export function createLoop(
  fn: () => void,
  opts: { fps?: number; totalTicks?: number } = {},
): LoopHandle {
  const ms = 1000 / (opts.fps ?? 30)
  const totalTicks = opts.totalTicks
  let intervalId: ReturnType<typeof setInterval> | null = null
  let ticks = 0

  const handle: LoopHandle = {
    start() {
      // Idempotent — double start is a no-op
      if (intervalId !== null) return
      intervalId = setInterval(() => {
        if (totalTicks !== undefined && ticks >= totalTicks) {
          handle.stop()
          return
        }
        fn()
        ticks++
      }, ms)
    },
    stop() {
      if (intervalId !== null) {
        clearInterval(intervalId)
        intervalId = null
      }
    },
    get running() { return intervalId !== null },
    get tickCount() { return ticks },
  }

  return handle
}
