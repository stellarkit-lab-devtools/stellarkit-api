/**
 * In-process metrics counter for the StellarKit API.
 *
 * Tracks:
 *   - totalRequests     — incremented on every incoming request
 *   - totalErrors       — incremented on every error response (4xx / 5xx)
 *   - errorsByStatus    — map of HTTP status code → count, keyed as strings
 *                         e.g. { "400": 3, "404": 1, "500": 0, ... }
 *   - slowestEndpoints  — sorted list of the top 10 slowest endpoints by
 *                         average response time (descending), each with:
 *                         { route, method, averageResponseTimeMs, requestCount }
 *
 * Only the five status codes that operators care about most are pre-seeded
 * so the GET /metrics response is always a stable shape regardless of which
 * error types have fired so far:
 *   400, 404, 429, 500, 503
 *
 * Additional status codes are recorded as they occur.
 *
 * Usage:
 *   const metrics = require('./services/metrics');
 *   metrics.incrementRequests();
 *   metrics.incrementError(404);
 *   metrics.recordResponseTime("GET", "/account/:id", 120);
 *   const snap = metrics.getSnapshot();
 */

/** Status codes that are always present in the errorsByStatus map. */
const TRACKED_STATUSES = [400, 404, 429, 500, 503];

/** Maximum number of slowest endpoints to track. */
const MAX_SLOWEST_ENDPOINTS = 10;

class MetricsService {
  constructor() {
    this.reset();
  }

  /**
   * Reset all counters to zero.
   * Primarily used in tests (`beforeEach(() => metrics.reset())`).
   */
  reset() {
    this.totalRequests = 0;
    this.totalErrors = 0;
    /** @type {Record<string, number>} */
    this.errorsByStatus = {};
    // Pre-seed the five well-known status codes so the response shape is stable
    for (const code of TRACKED_STATUSES) {
      this.errorsByStatus[String(code)] = 0;
    }
    /**
     * Internal accumulator for per-route timing data.
     * Key: "<method>:<route>", value: { method, route, totalMs, count }
     * @type {Map<string, { method: string, route: string, totalMs: number, count: number }>}
     */
    this._routeTimings = new Map();
  }

  /**
   * Increment the total request counter.
   * Should be called once per incoming HTTP request (e.g. in a middleware).
   */
  incrementRequests() {
    this.totalRequests++;
  }

  /**
   * Increment the total error counter and the per-status-code counter.
   *
   * @param {number} statusCode - HTTP status code of the error response (e.g. 404).
   */
  incrementError(statusCode) {
    this.totalErrors++;
    const key = String(statusCode);
    this.errorsByStatus[key] = (this.errorsByStatus[key] ?? 0) + 1;
  }

  /**
   * Record the response time for a specific endpoint.
   *
   * Called from the response-finish hook in requestLogger so that every
   * completed request contributes to the per-route average.
   *
   * @param {string} method    - HTTP method (e.g. "GET", "POST").
   * @param {string} route     - Express matched route pattern (e.g. "/account/:id").
   *                             Falls back to the raw path when no pattern is matched.
   * @param {number} responseTimeMs - Elapsed response time in milliseconds.
   */
  recordResponseTime(method, route, responseTimeMs) {
    if (typeof responseTimeMs !== "number" || !Number.isFinite(responseTimeMs)) return;
    if (!method || !route) return;

    const key = `${method.toUpperCase()}:${route}`;
    const existing = this._routeTimings.get(key);

    if (existing) {
      existing.totalMs += responseTimeMs;
      existing.count += 1;
    } else {
      this._routeTimings.set(key, {
        method: method.toUpperCase(),
        route,
        totalMs: responseTimeMs,
        count: 1,
      });
    }
  }

  /**
   * Compute and return the top N slowest endpoints sorted by average response
   * time descending. The list is capped at MAX_SLOWEST_ENDPOINTS (10).
   *
   * @returns {Array<{ route: string, method: string, averageResponseTimeMs: number, requestCount: number }>}
   */
  _computeSlowestEndpoints() {
    const entries = Array.from(this._routeTimings.values()).map((entry) => ({
      route: entry.route,
      method: entry.method,
      averageResponseTimeMs: Math.round((entry.totalMs / entry.count) * 1000) / 1000,
      requestCount: entry.count,
    }));

    entries.sort((a, b) => b.averageResponseTimeMs - a.averageResponseTimeMs);

    return entries.slice(0, MAX_SLOWEST_ENDPOINTS);
  }

  /**
   * Return a snapshot of current metrics.
   *
   * @returns {{
   *   totalRequests: number,
   *   totalErrors: number,
   *   errorsByStatus: Record<string, number>,
   *   slowestEndpoints: Array<{ route: string, method: string, averageResponseTimeMs: number, requestCount: number }>
   * }}
   */
  getSnapshot() {
    return {
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors,
      errorsByStatus: { ...this.errorsByStatus },
      slowestEndpoints: this._computeSlowestEndpoints(),
    };
  }
}

// Export a singleton so all modules share one set of counters.
module.exports = new MetricsService();
