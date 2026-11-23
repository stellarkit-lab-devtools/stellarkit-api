/**
 * Per-route request counter middleware.
 *
 * Tracks total request counts per route path and HTTP method in memory.
 * Counters are stored as a plain Map keyed by "METHOD /path" strings so
 * they are fast to read and reset on every server restart.
 *
 * Usage:
 *   app.use(routeCounter);
 *
 *   // Later, read the accumulated counts:
 *   const { getRouteCounts } = require("./routeCounter");
 *   getRouteCounts(); // => { "GET /account/:id": 42, "POST /accounts/balances": 7, ... }
 *
 * Design notes:
 *   - The middleware runs AFTER the router layer so req.route is already
 *     populated and we can read the matched route pattern (e.g. "/:id")
 *     rather than the raw URL (e.g. "/GABC..."). When no route is matched
 *     (e.g. 404 paths) we fall back to req.path.
 *   - Counts are never persisted — they reset to zero on every restart.
 *     This is intentional; the spec says "Counters reset on server restart."
 */

/** @type {Map<string, number>} */
const counts = new Map();

/**
 * Build a human-readable route key for a request.
 *
 * Prefers the Express matched-route pattern ("/:id") over the raw URL
 * so that parametric routes are aggregated rather than split per value.
 *
 * @param {import("express").Request} req
 * @returns {string}  e.g. "GET /account/:id"
 */
function buildRouteKey(req) {
  // req.route is set by Express after a route handler is matched.
  // When the middleware runs after the router it is reliably present.
  const routePath = req.route ? req.route.path : null;

  // Express mounts routers under a base path stored in req.baseUrl.
  // Concatenating baseUrl + route.path gives the full matched pattern.
  const basePath = req.baseUrl || "";

  const fullPath = routePath
    ? `${basePath}${routePath === "/" ? "" : routePath}`
    : req.path;

  return `${req.method} ${fullPath || "/"}`;
}

/**
 * Express middleware that increments the request counter for the matched
 * route after the response is finished.
 *
 * Counting after "finish" (rather than at request start) means we only
 * record requests that completed a full round-trip, avoiding noise from
 * abandoned or mid-flight connections.
 *
 * @param {import("express").Request}  req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
function routeCounter(req, res, next) {
  res.on("finish", () => {
    const key = buildRouteKey(req);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  next();
}

/**
 * Returns a plain-object snapshot of all accumulated route counts.
 *
 * Shape:
 *   {
 *     "GET /account/:id":      42,
 *     "GET /fee-estimate":     18,
 *     "POST /accounts/balances": 7,
 *     ...
 *   }
 *
 * @returns {Record<string, number>}
 */
function getRouteCounts() {
  return Object.fromEntries(counts);
}

/**
 * Resets all counters to zero.
 * Primarily for use in tests so state does not leak between test suites.
 */
function resetRouteCounts() {
  counts.clear();
}

module.exports = routeCounter;
module.exports.getRouteCounts = getRouteCounts;
module.exports.resetRouteCounts = resetRouteCounts;
