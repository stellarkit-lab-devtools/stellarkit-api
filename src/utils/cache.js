/**
 * Simple in-memory TTL cache
 * No external dependencies - uses native Map and Date
 */

class TTLCache {
  constructor(ttlMs = 5000) {
    this.ttlMs = ttlMs;
    this.cache = new Map();
  }

  /**
   * Get a value from cache if it exists and hasn't expired
   * @param {string} key - Cache key
   * @returns {any|null} Cached value or null if expired/missing
   */
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  /**
   * Set a value in cache with TTL
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   */
  set(key, value) {
    const expiresAt = Date.now() + this.ttlMs;
    this.cache.set(key, { value, expiresAt });
  }

  /**
   * Clear all cached entries
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Check if a key exists and is valid
   * @param {string} key - Cache key
   * @returns {boolean} True if key exists and hasn't expired
   */
  has(key) {
    return this.get(key) !== null;
  }

  /**
   * Delete a specific key
   * @param {string} key - Cache key
   */
  delete(key) {
    this.cache.delete(key);
  }
}

// Create cache instances with configurable TTL
const cacheTtlMs = parseInt(process.env.CACHE_TTL_MS || '5000', 10);

const networkStatusCache = new TTLCache(cacheTtlMs);
const feeEstimateCache = new TTLCache(cacheTtlMs);

module.exports = {
  TTLCache,
  networkStatusCache,
  feeEstimateCache,
};
