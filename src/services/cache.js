const NodeCache = require("node-cache");

/**
 * Centralised in-memory TTL cache service backed by node-cache.
 *
 * Caching strategy:
 *   - All Horizon responses that are safe to reuse within a short window are
 *     cached here under a descriptive string key.
 *   - Each entry has its own TTL (in seconds).  When a TTL expires node-cache
 *     silently drops the entry; the next `get` call returns `undefined` (a
 *     cache miss) and the caller is expected to re-fetch and re-set.
 *   - A singleton instance is exported so every route and middleware shares
 *     the same key-space and the same hit/miss counters.
 *
 * Key format convention:
 *   Use colon-delimited namespaces that describe the endpoint and any
 *   variable parts, e.g.:
 *     "network-status"
 *     "fee-estimate:1"          (one operation)
 *     "asset:USDC:GA123..."
 *   This makes keys human-readable in debug logs and avoids accidental
 *   collisions between endpoints.
 *
 * Cache-full behaviour:
 *   node-cache stores entries in a plain JS object; there is no hard entry
 *   limit.  If memory pressure is a concern, set an explicit `maxKeys` option
 *   in the NodeCache constructor.  Expired entries are lazily removed on
 *   access and periodically swept by the internal check-period timer
 *   (configured below as 20% of the default TTL).
 *
 * Tracking:
 *   `this.hits` and `this.misses` are incremented on every `get` call so that
 *   `getStats()` can report a live hit-rate without an extra dependency.
 */
class CacheService {
  /**
   * @param {number} defaultTtlSeconds - Fallback TTL used when `set` is
   *   called without an explicit TTL.  Defaults to 60 seconds.
   */
  constructor(defaultTtlSeconds = 60) {
    this.cache = new NodeCache({
      stdTTL: defaultTtlSeconds,
      // Sweep expired keys every 20 % of the default TTL to keep memory tidy
      // without hammering the GC on every operation.
      checkperiod: defaultTtlSeconds * 0.2,
      // Do not clone values on get/set — we only cache plain JSON-serialisable
      // objects, so cloning would be wasteful overhead.
      useClones: false,
    });
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Retrieve a cached value.
   *
   * Returns `undefined` on a cache miss (key never set, or TTL expired).
   * Callers should treat `undefined` as a signal to fetch fresh data and
   * call `set` to repopulate the cache.
   *
   * Debug-level logs are emitted outside of the test environment so
   * cache behaviour is observable during development without polluting
   * test output.
   *
   * @param {string} key - The cache key (see key format convention above).
   * @returns {any|undefined} The cached value, or `undefined` on a miss.
   */
  get(key) {
    const value = this.cache.get(key);
    if (value !== undefined) {
      this.hits++;
      if (process.env.NODE_ENV !== "test") {
        console.debug(`[CACHE HIT] ${key}`);
      }
      return value;
    }
    this.misses++;
    if (process.env.NODE_ENV !== "test") {
      console.debug(`[CACHE MISS] ${key}`);
    }
    return undefined;
  }

  /**
   * Store a value in the cache with an explicit TTL.
   *
   * If `ttlSeconds` is 0 the entry will never expire (use with care).
   * Passing a TTL shorter than the node-cache `checkperiod` means the
   * entry may briefly outlive its intended lifetime before the next sweep.
   *
   * @param {string} key        - The cache key (see key format convention above).
   * @param {any}    value      - Any JSON-serialisable value to cache.
   * @param {number} ttlSeconds - How long (in seconds) to keep this entry.
   * @returns {boolean} `true` if the value was stored successfully.
   */
  set(key, value, ttlSeconds) {
    return this.cache.set(key, value, ttlSeconds);
  }

  /**
   * Immediately remove a single entry from the cache.
   *
   * Use this when you know the underlying data has changed and you want
   * the next request to receive fresh data rather than waiting for the
   * TTL to expire naturally (e.g. after a write operation).
   *
   * @param {string} key - The cache key to evict.
   */
  delete(key) {
    this.cache.del(key);
  }

  /**
   * Remove every entry from the cache at once.
   *
   * Primarily used in tests (`beforeEach(() => cacheService.flush())`) to
   * guarantee a clean slate between test cases.  In production this would
   * cause a thundering-herd of cache misses — use with caution.
   */
  flush() {
    this.cache.flushAll();
  }

  /**
   * Return a snapshot of cache performance since the process started.
   *
   * `hitRate` is expressed as a percentage string ("72.50%").  A hitRate
   * close to 100% means the cache is working well; a low rate may indicate
   * TTLs are too short or keys are not being reused.
   *
   * @returns {{ hits: number, misses: number, hitRate: string, cachedKeys: number }}
   */
  getStats() {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? ((this.hits / total) * 100).toFixed(2) : "0.00";
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: `${hitRate}%`,
      // Number of keys that are currently live (not yet expired or deleted)
      cachedKeys: this.cache.keys().length,
    };
  }
}

// Export a singleton so all consumers share one cache and one set of stats.
module.exports = new CacheService();
