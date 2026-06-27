/**
 * In-memory cache service for StellarKit.
 *
 * Strategy: simple key-value store with TTL-based expiry.
 * Keys are strings — callers use a consistent naming convention
 * such as `endpoint:param1:param2` (e.g. `account:GABC:balance`).
 * Values are stored as serialised JSON to allow any payload type.
 *
 * Limitations:
 * - Single-process only (no shared cache across instances)
 * - No persistence across restarts
 * - Memory grows until keys expire; no max-size eviction
 */
const cache = new Map();

/**
 * Store a value in the cache under the given key.
 *
 * @param {string} key   - Cache key, format: `scope:identifier[...params]`
 * @param {*}      value - Any JSON-serialisable value to cache
 * @param {number} ttlMs - Time-to-live in milliseconds; the entry is
 *                         automatically removed after this duration.
 *                         Use 0 to cache indefinitely (not recommended
 *                         for live Horizon data that changes frequently).
 */
export function set(key, value, ttlMs) {
  const expiresAt = ttlMs > 0 ? Date.now() + ttlMs : Infinity;
  cache.set(key, { value, expiresAt });
  if (ttlMs > 0) {
    // Schedule removal so the map never grows without bound.
    // clearTimeout is not called on overwrite; the stale timer fires
    // harmlessly on an already-removed key.
    setTimeout(() => cache.delete(key), ttlMs);
  }
}

/**
 * Retrieve a cached value.
 *
 * Returns `undefined` if the key does not exist or has expired.
 * Expired entries are deleted on first access to free memory eagerly.
 *
 * @param {string} key - Cache key to look up
 * @returns {*} The cached value, or `undefined` on miss/expiry
 */
export function get(key) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    // Eager eviction: remove the expired entry so it does not
    // accumulate memory beyond its TTL if the setTimeout fires late.
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

/**
 * Remove a single entry from the cache.
 *
 * Useful for explicit invalidation after a write operation,
 * for example after an account mutation to force a fresh fetch.
 *
 * @param {string} key - Cache key to delete
 */
export function del(key) {
  cache.delete(key);
}

/**
 * Remove all entries from the cache.
 *
 * Use with care in production — this will cause a thundering-herd
 * of Horizon requests immediately after the flush.
 */
export function flush() {
  cache.clear();
}

/**
 * Return the number of entries currently held in the cache.
 * Includes entries that have logically expired but not yet been
 * evicted by a get() call or their setTimeout.
 *
 * @returns {number}
 */
export function size() {
  return cache.size;
}
