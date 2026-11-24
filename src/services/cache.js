const NodeCache = require("node-cache");
const logger = require("../utils/logger");
const { getCoalescedRequests } = require("../utils/singleFlight");

// LRU cache enforcement constants
const CACHE_MAX_ENTRIES = parseInt(process.env.CACHE_MAX_ENTRIES, 10) || 5000;
const KEY_MAX_LENGTH = 512;

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
 *   - Cache is bounded by CACHE_MAX_ENTRIES with LRU eviction — the least
 *     recently read entry is removed when capacity is reached.
 *   - Cache keys longer than 512 characters are not cached (no error thrown).
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
 *   When the number of cached entries reaches CACHE_MAX_ENTRIES, the least
 *   recently accessed entry (tracked by read/write timestamps) is evicted to
 *   make room for new entries. TTL-based expiry still applies independently.
 *
 * Tracking:
 *   `this.hits` and `this.misses` are incremented on every `get` call so that
 *   `getStats()` can report a live hit-rate without an extra dependency.
 *   `this.evictions` counts both LRU-triggered evictions and manual deletes.
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
    // Counts entries removed via `delete()` (forced eviction), separate from
    // natural TTL expiry which node-cache handles internally and never routes
    // through this method.
    this.evictions = 0;

    // Opt-in stale-while-revalidate window (milliseconds). 0 disables SWR.
    // Configured through CACHE_SWR_MS; see src/config/cacheConfig.js.
    const configuredSwr = parseInt(process.env.CACHE_SWR_MS, 10);
    this.swrMs = Number.isFinite(configuredSwr) && configuredSwr > 0 ? configuredSwr : 0;

    // SWR metadata kept outside node-cache: node-cache drops entries at their
    // TTL, so we store the value for ttl + swrMs and track the real freshness
    // deadline ourselves. In-flight refreshes are tracked per key so exactly
    // one background refresh runs for a stale entry.
    this.swrMeta = new Map();
    this.swrInflight = new Set();

    // Track last access time for each key to enable LRU eviction
    this.accessOrder = new Map();
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
      // Update access order for LRU tracking (refresh recency on read)
      this.accessOrder.set(key, Date.now());
      if (process.env.NODE_ENV !== "test") {
        logger.debug(`Cache hit: ${key}`);
      }
      return value;
    }
    this.misses++;
    if (process.env.NODE_ENV !== "test") {
      logger.debug(`Cache miss: ${key}`);
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
   * Cache keys longer than KEY_MAX_LENGTH (512 characters) are skipped
   * without error; a debug log is emitted.
   *
   * When the cache reaches CACHE_MAX_ENTRIES capacity, the least recently
   * accessed entry is evicted to make room.
   *
   * @param {string} key        - The cache key (see key format convention above).
   * @param {any}    value      - Any JSON-serialisable value to cache.
   * @param {number} ttlSeconds - How long (in seconds) to keep this entry.
   * @returns {boolean} `true` if the value was stored successfully, `false` if skipped due to key length.
   */
  set(key, value, ttlSeconds) {
    // Skip caching if key exceeds maximum length
    if (key.length > KEY_MAX_LENGTH) {
      if (process.env.NODE_ENV !== "test") {
        logger.debug(
          `Cache key too long (${key.length} > ${KEY_MAX_LENGTH}): ${key.substring(0, 50)}...`
        );
      }
      return false;
    }

    // Enforce LRU eviction when at capacity
    const currentSize = this.cache.keys().length;
    if (currentSize >= CACHE_MAX_ENTRIES) {
      this._evictLru();
    }

    // Store the value and track access time
    const result = this.cache.set(key, value, ttlSeconds);
    if (result) {
      this.accessOrder.set(key, Date.now());
    }
    return result;
  }

  /**
   * Find and evict the least recently accessed entry.
   * @private
   */
  _evictLru() {
    // Find the entry with the oldest access time
    let oldestKey = null;
    let oldestTime = Infinity;

    for (const [key, time] of this.accessOrder.entries()) {
      if (time < oldestTime) {
        oldestTime = time;
        oldestKey = key;
      }
    }

    if (oldestKey !== null) {
      this.cache.del(oldestKey);
      this.accessOrder.delete(oldestKey);
      this.swrMeta.delete(oldestKey);
      this.evictions++;
      if (process.env.NODE_ENV !== "test") {
        logger.debug(`Cache evicted (LRU): ${oldestKey}`);
      }
    }
  }

  /**
   * Store a value with a stale-while-revalidate window.
   *
   * The node-cache entry lives for `ttlSeconds + swrMs` while `swrMeta`
   * remembers when the value actually became stale.
   *
   * @param {string} key        - Cache key.
   * @param {any}    value      - Value to cache.
   * @param {number} ttlSeconds - Fresh lifetime in seconds.
   * @param {number} [swrMs]    - Stale window in milliseconds.
   * @returns {boolean} True when stored.
   */
  setWithRevalidation(key, value, ttlSeconds, swrMs = this.swrMs) {
    const windowMs = Number.isFinite(swrMs) && swrMs > 0 ? swrMs : 0;
    this.swrMeta.set(key, {
      expiresAt: Date.now() + ttlSeconds * 1000,
      windowMs,
    });
    return this.cache.set(key, value, ttlSeconds + windowMs / 1000);
  }

  /**
   * Read a value with opt-in stale-while-revalidate support.
   *
   * Returns one of three states:
   *   - `HIT`: inside the fresh TTL.
   *   - `STALE`: past TTL but inside the SWR window; the stale value is served
   *     immediately while exactly one background refresh runs for this key.
   *   - `MISS`: no usable value.
   *
   * A failed background refresh keeps the stale value until the window closes
   * and logs a warning; it never throws into the request path.
   *
   * @param {string} key          - Cache key.
   * @param {number} ttlSeconds   - Fresh lifetime in seconds.
   * @param {Function} refresh    - Async function returning a fresh value.
   * @param {number} [swrMs]      - Stale window in milliseconds (0 disables SWR).
   * @returns {{ state: "HIT"|"STALE"|"MISS", value: any }}
   */
  getWithRevalidation(key, ttlSeconds, refresh, swrMs = this.swrMs) {
    const windowMs = Number.isFinite(swrMs) && swrMs > 0 ? swrMs : 0;
    const value = this.cache.get(key);

    if (value === undefined) {
      this.swrMeta.delete(key);
      this.misses++;
      if (process.env.NODE_ENV !== "test") logger.debug(`Cache miss: ${key}`);
      return { state: "MISS", value: undefined };
    }

    this.hits++;
    if (process.env.NODE_ENV !== "test") logger.debug(`Cache hit: ${key}`);

    const meta = this.swrMeta.get(key);
    const now = Date.now();

    if (windowMs === 0 || !meta || now < meta.expiresAt) {
      return { state: "HIT", value };
    }

    if (now <= meta.expiresAt + windowMs) {
      this.startBackgroundRefresh(key, value, ttlSeconds, refresh, windowMs);
      return { state: "STALE", value };
    }

    // Window closed — discard the stale entry and force a synchronous fetch.
    this.cache.del(key);
    this.swrMeta.delete(key);
    this.misses++;
    return { state: "MISS", value: undefined };
  }

  /**
   * Start (or reuse) the single in-flight refresh for a stale key.
   *
   * @private
   */
  startBackgroundRefresh(key, staleValue, ttlSeconds, refresh, windowMs) {
    if (this.swrInflight.has(key)) return;

    this.swrInflight.add(key);
    Promise.resolve()
      .then(() => refresh())
      .then((freshValue) => {
        if (freshValue !== undefined) {
          this.setWithRevalidation(key, freshValue, ttlSeconds, windowMs);
        }
      })
      .catch((err) => {
        // Keep the stale value until the window closes.
        logger.warn(
          `Background cache refresh failed for ${key}: ${err && err.message ? err.message : "unknown error"}`,
        );
      })
      .finally(() => {
        this.swrInflight.delete(key);
      });
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
    this.swrMeta.delete(key);
    this.accessOrder.delete(key);
    this.evictions++;
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
    this.accessOrder.clear();
    this.swrMeta.clear();
    this.swrInflight.clear();
  }

  /**
   * Return a snapshot of cache performance since the process started.
   *
   * `hitRate` is expressed as a percentage string ("72.50%").  A hitRate
   * close to 100% means the cache is working well; a low rate may indicate
   * TTLs are too short or keys are not being reused.
   *
   * `evictions` counts both LRU-triggered evictions and manual deletes.
   *
   * @returns {{ hits: number, misses: number, hitRate: string, cachedKeys: number, evictions: number, coalescedRequests: number }}
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
      evictions: this.evictions,
      // Requests that shared an upstream call via src/utils/singleFlight.js
      coalescedRequests: getCoalescedRequests(),
    };
  }
}

// Export a singleton so all consumers share one cache and one set of stats.
module.exports = new CacheService();
