/**
 * createMapRenderer — paints cell + agent state onto an offscreen canvas
 * for maplibre's `type: 'canvas'` source.
 *
 * Replaces `agentscript/src/MapDraw`. Key differences:
 *
 *  - **Pre-baked cell colors**: the cell color buffer is computed once per
 *    scenario via `sim.bakeCellColors(palette)`. Per-frame cell rendering
 *    is then a single `pixelView.set(sim.cellColorBuffer)` memcpy plus one
 *    `putImageData` call — no per-cell callbacks, no allocation.
 *
 *  - **Batched agent rendering**: agents are bucketed by (color, radius)
 *    into a fixed 12-slot array (4 colors × 3 radii). Each bucket emits a
 *    single `beginPath` + `fill()`, collapsing what would be hundreds of
 *    per-agent `drawImage` calls into ~12 fills per frame.
 *
 *  - **Deterministic z-order**: buckets are drawn back-to-front as
 *    regular → shopping → waiting → highlighted, so highlighted agents
 *    always render on top.
 *
 *  - **No class inheritance**: the renderer is a factory function that
 *    returns an opaque `{ canvas, draw, destroy }` handle.
 *
 *  - **Upsampled canvas**: the rendered canvas is `width * PATCH_SIZE`
 *    by `height * PATCH_SIZE` pixels so sub-cell agent radii become
 *    real pixel radii. At PATCH_SIZE=4 an agent with radius 0.8 cells
 *    renders as a 3.2 pixel-radius circle — distinct from the cell
 *    background. At 1:1 (one pixel per cell) all agents collapsed to
 *    single antialiased pixels and looked like a heatmap blob.
 */

import { ENGAGEMENT_SHOPPING, ENGAGEMENT_WAITING } from './Simulation'

/**
 * Structural subset of `Simulation` that the renderer actually reads.
 * Both a live `Simulation` (used in tests and the baseline fixture) and
 * a `SimView` (used in production, backed by worker snapshots) satisfy
 * this interface.
 */
export interface RenderSimLike {
  readonly width: number
  readonly height: number
  readonly cellColorBuffer: Uint32Array
  readonly pedCount: number
  readonly pedAlive: Uint8Array
  readonly pedX: Float32Array
  readonly pedY: Float32Array
  readonly pedEngagementMode: Uint8Array
  readonly pedStartNodeIdx: Int32Array
  readonly pedIntimateViolations: Uint16Array
  readonly pedPersonalViolations: Uint16Array
  /**
   * Optional hint set to `true` by the worker-backed `SimView` — snapshots
   * are pre-compacted so every slot in `[0, pedCount)` is alive and the
   * renderer can skip the `pedAlive[i] === 0` check. A live main-thread
   * `Simulation` (used in tests and sandbox) omits this flag and the
   * renderer then does the normal check.
   */
  readonly snapshotIsCompacted?: boolean
}

/**
 * Pixels per cell in the rendered canvas.
 *
 * Matches `agentscript/src/TwoView.defaultOptions().patchSize` so the
 * visual output is indistinguishable from the legacy MapDraw renderer.
 * At 10 pixels/cell the 432×326 grid renders on a 4320×3260 canvas, and
 * maplibre resamples it down to whatever the viewport needs.
 */
const PATCH_SIZE = 10

export interface MapRendererOptions {
  /** Reactive getter for the interned node index of the highlighted spawn. -1 = no highlight. */
  selectedStartNodeIdx: () => number
  /** Color palette as pre-packed u32 values. */
  colors: {
    agent: number
    shopping: number
    waiting: number
    highlight: number
  }
}

export interface MapRenderHandle {
  readonly canvas: HTMLCanvasElement
  draw: () => void
  destroy: () => void
}

// Fixed bucket grid: 4 color slots × 3 radius slots = 12 buckets.
// Indices used at draw time — defined as module-level constants so the
// hot loop can reference them without any property lookup.
const COLOR_REGULAR = 0
const COLOR_SHOPPING = 1
const COLOR_WAITING = 2
const COLOR_HIGHLIGHT = 3
const COLOR_COUNT = 4

const RADIUS_INTIMATE = 0   // smallest (0.65)
const RADIUS_PERSONAL = 1   // middle   (0.7)
const RADIUS_PUBLIC = 2     // largest  (0.8)
const RADIUS_COUNT = 3

/**
 * Per-slot turtle SIZES (cell diameters) — these are the exact values the
 * legacy `turtlesSize` callback in MapView.vue returned. Named `SIZES` not
 * `RADII` because the agentscript convention is that `size` is the sprite
 * diameter in cell units; the drawn circle has pixel radius
 * `Math.ceil(size * patchSize) / 2`.
 */
const BUCKET_SIZES = [0.65, 0.7, 0.8]
const BUCKET_COUNT = COLOR_COUNT * RADIUS_COUNT

/**
 * Pre-compute each bucket's pixel radius using the same formula as
 * agentscript's `Shapes.shapeToImage`: sprite side = `Math.ceil(size * patchSize)`,
 * drawn circle radius = `spriteSide / 2`.
 *
 * For `patchSize = 10`:
 *   size 0.65 → ceil(6.5) = 7 → radius 3.5
 *   size 0.70 → ceil(7.0) = 7 → radius 3.5
 *   size 0.80 → ceil(8.0) = 8 → radius 4.0
 */
const BUCKET_PIXEL_RADII = BUCKET_SIZES.map(
  (size) => Math.ceil(size * PATCH_SIZE) / 2,
)

function bucketKey(colorSlot: number, radiusSlot: number): number {
  return colorSlot * RADIUS_COUNT + radiusSlot
}

export function createMapRenderer(
  sim: RenderSimLike,
  options: MapRendererOptions,
): MapRenderHandle {
  // Main canvas — upsampled so agent sprites have visible pixel radii.
  const canvas = document.createElement('canvas')
  canvas.width = sim.width * PATCH_SIZE
  canvas.height = sim.height * PATCH_SIZE
  const ctx = canvas.getContext('2d', { willReadFrequently: false })!
  // Cells are deliberately drawn at 1-pixel-per-cell resolution on a
  // scratch canvas, then scaled up with nearest-neighbor interpolation —
  // this preserves crisp cell boundaries and lets maplibre do the final
  // zoom-dependent resampling.
  ctx.imageSmoothingEnabled = false

  // Scratch canvas for the per-cell ImageData write. The prebaked
  // `sim.cellColorBuffer` is a single u32 per cell (length = cellCount),
  // so we putImageData at cell resolution here, then drawImage it up to
  // the main canvas.
  const scratchCanvas = document.createElement('canvas')
  scratchCanvas.width = sim.width
  scratchCanvas.height = sim.height
  const scratchCtx = scratchCanvas.getContext('2d', { willReadFrequently: false })!
  const imageData = scratchCtx.createImageData(sim.width, sim.height)
  const pixelView = new Uint32Array(imageData.data.buffer)

  // 12 fixed bucket buffers. Each holds flat [x0, y0, x1, y1, ...] coords.
  // Grow geometrically on demand but reuse across frames — zero per-frame
  // allocation in the steady state.
  const bucketCoords: Float32Array[] = new Array(BUCKET_COUNT)
  for (let b = 0; b < BUCKET_COUNT; b++) bucketCoords[b] = new Float32Array(64)
  const bucketCounts = new Int32Array(BUCKET_COUNT)

  // Pre-computed CSS strings per color slot — avoids per-draw string formatting.
  const cssByColorSlot: string[] = [
    u32ToCssRGBA(options.colors.agent),
    u32ToCssRGBA(options.colors.shopping),
    u32ToCssRGBA(options.colors.waiting),
    u32ToCssRGBA(options.colors.highlight),
  ]

  function pushAgent(colorSlot: number, radiusSlot: number, x: number, y: number): void {
    const b = bucketKey(colorSlot, radiusSlot)
    let buf = bucketCoords[b]!
    const len = bucketCounts[b]!
    if (len + 2 > buf.length) {
      const next = new Float32Array(buf.length * 2)
      next.set(buf)
      bucketCoords[b] = next
      buf = next
    }
    buf[len] = x
    buf[len + 1] = y
    bucketCounts[b] = len + 2
  }

  function draw(): void {
    // Clear the canvas first. Without this, every frame's drawImage() and
    // arc/fill() alpha-blends on top of the previous frame's content:
    //
    //   - Surfaces use RGBA `#5076ff10` (alpha 16/255 = 6%). Alpha
    //     accumulates via Porter-Duff source-over across frames, and
    //     after ~50 ticks the cells saturate toward fully opaque blue.
    //   - Agent circles leave long trails as each tick's new circle blends
    //     over the previous tick's still-visible circle.
    //
    // agentscript's PatchesView/TurtlesView draw flow implicitly reset the
    // canvas every frame via `putImageData` (which REPLACES pixels) +
    // canvas clearing inside TwoDraw. Because our pipeline splits the
    // cell blit into scratch→main via `drawImage` (for the nearest-neighbor
    // upscale), we need an explicit clearRect here.
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // ---------- Cell phase: memcpy pre-baked buffer → scratch → main ----------
    pixelView.set(sim.cellColorBuffer)
    scratchCtx.putImageData(imageData, 0, 0)
    // Nearest-neighbor upscale to the main canvas. `imageSmoothingEnabled`
    // was set to false on `ctx` — cell boundaries stay crisp.
    ctx.drawImage(scratchCanvas, 0, 0, canvas.width, canvas.height)

    // ---------- Agent phase: bucket, then batched fill ----------
    bucketCounts.fill(0)

    const x = sim.pedX
    const y = sim.pedY
    const mode = sim.pedEngagementMode
    const startIdx = sim.pedStartNodeIdx
    const intimate = sim.pedIntimateViolations
    const personal = sim.pedPersonalViolations
    const n = sim.pedCount
    const selected = options.selectedStartNodeIdx()
    // Worker-backed SimView provides pre-compacted snapshots: every slot in
    // [0, pedCount) is alive. Main-thread Simulation has holes from
    // soft-kill → end-of-tick compaction, so it still needs the check.
    const compacted = sim.snapshotIsCompacted === true
    const alive = compacted ? null : sim.pedAlive

    for (let i = 0; i < n; i++) {
      if (alive !== null && alive[i] === 0) continue

      // Color slot — highlight takes precedence over engagement mode
      let colorSlot: number
      if (selected >= 0 && startIdx[i] === selected)     colorSlot = COLOR_HIGHLIGHT
      else if (mode[i] === ENGAGEMENT_SHOPPING)           colorSlot = COLOR_SHOPPING
      else if (mode[i] === ENGAGEMENT_WAITING)            colorSlot = COLOR_WAITING
      else                                                colorSlot = COLOR_REGULAR

      // Radius slot — smallest = worst violation, matches legacy turtlesSize callback
      let radiusSlot: number
      if (intimate[i]! > 0)      radiusSlot = RADIUS_INTIMATE
      else if (personal[i]! > 0) radiusSlot = RADIUS_PERSONAL
      else                       radiusSlot = RADIUS_PUBLIC

      // Agent positions are stored in cell-space — scale up to the
      // upsampled canvas pixel space.
      pushAgent(colorSlot, radiusSlot, x[i]! * PATCH_SIZE, y[i]! * PATCH_SIZE)
    }

    // Deterministic draw order: regular → shopping → waiting → highlighted.
    // Highlighted agents are guaranteed to render on top of all others.
    for (let c = 0; c < COLOR_COUNT; c++) {
      const css = cssByColorSlot[c]!
      for (let r = 0; r < RADIUS_COUNT; r++) {
        const b = bucketKey(c, r)
        const len = bucketCounts[b]!
        if (len === 0) continue
        // Pre-computed to match agentscript's `pixels = ceil(size * patchSize);
        // radius = pixels / 2` sprite convention exactly.
        const radius = BUCKET_PIXEL_RADII[r]!
        const coords = bucketCoords[b]!
        ctx.fillStyle = css
        ctx.beginPath()
        for (let j = 0; j < len; j += 2) {
          const px = coords[j]!
          const py = coords[j + 1]!
          // moveTo before arc — otherwise arc implicitly draws a line from
          // the previous subpath's end point to its own start.
          ctx.moveTo(px + radius, py)
          ctx.arc(px, py, radius, 0, Math.PI * 2)
        }
        ctx.fill()
      }
    }
  }

  function destroy(): void {
    // Typed arrays are GC'd when the handle is dropped. Canvas element is
    // owned by whoever attaches it to the DOM.
  }

  return { canvas, draw, destroy }
}

function u32ToCssRGBA(pixel: number): string {
  const r = pixel & 0xff
  const g = (pixel >>> 8) & 0xff
  const b = (pixel >>> 16) & 0xff
  const a = ((pixel >>> 24) & 0xff) / 255
  return `rgba(${r},${g},${b},${a})`
}
