/**
 * Pure helper for the worker's snapshot buffer pool. Extracted from
 * `worker.ts` so it can be unit-tested without instantiating a
 * `self.onmessage` handler.
 */

import type { SnapshotBuffers } from './workerProtocol'

/**
 * Release a snapshot-buffer bundle back to a pool, respecting the cap.
 * Returns true if the buffer was accepted (pool had room), false if it
 * was dropped so the GC can reclaim its underlying ArrayBuffers.
 */
export function releaseToPool(
  pool: SnapshotBuffers[],
  buffers: SnapshotBuffers,
  maxSize: number,
): boolean {
  if (pool.length >= maxSize) return false
  pool.push(buffers)
  return true
}
