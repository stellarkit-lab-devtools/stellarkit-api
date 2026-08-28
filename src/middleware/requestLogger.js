/**
 * Request logging middleware.
 *
 * Logs a single structured entry for every completed request via the shared
 * Pino logger. Each entry includes the HTTP method, path, status code, request
 * ID, and the elapsed response time in milliseconds, giving consistent
 * visibility into how long individual requests take across all routes.
 *
 * When a route handler calls Horizon it should record the duration via the
 * helpers exported below so this middleware can include horizonResponseTimeMs
 * in the log entry. Routes that serve from cache omit the field entirely.
 *
 * Usage in a route handler:
 *   const { startHorizonTimer, stopHorizonTimer } = require("../middleware/requestLogger");
 *   startHorizonTimer(req);
 *   const account = await server.loadAccount(id);
 *   stopHorizonTimer(req);
 */

const logger = require("../utils/logger");
const metricsService = require("../services/metrics");

/**
 * Record the start of a Horizon call on the request object.
 * Multiple calls within a single request are accumulated.
 *
 * @param {import('express').Request} req
 */
function startHorizonTimer(req) {
  req._horizonCallStart = process.hrtime.bigint();
}

/**
 * Stop the running Horizon timer and add the elapsed time to the request's
 * running Horizon total. Calling this without a prior startHorizonTimer is a
 * no-op so routes don't need guard logic.
 *
 * @param {import('express').Request} req
 */
function stopHorizonTimer(req) {
  if (!req._horizonCallStart) return;
  const elapsed = Number(process.hrtime.bigint() - req._horizonCallStart) / 1e6;
  req._horizonCallStart = undefined;
  req.horizonResponseTimeMs = Math.round(((req.horizonResponseTimeMs || 0) + elapsed) * 1000) / 1000;
}

function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    // Keep sub-millisecond precision while avoiding noisy floating point tails.
    const responseTimeMs = Math.round(elapsedMs * 1000) / 1000;

    const requestId = req.requestId || "-";
    const method = req.method;
    const path = req.originalUrl || req.url;
    const statusCode = res.statusCode;

    const fields = { requestId, method, path, statusCode, responseTimeMs };

    // Only include horizonResponseTimeMs when the request actually called
    // Horizon — cache hits and non-Horizon routes will not have this field.
    if (typeof req.horizonResponseTimeMs === "number") {
      fields.horizonResponseTimeMs = req.horizonResponseTimeMs;
    }

    logger.info(
      fields,
      `[${requestId}] ${method} ${path} ${statusCode} ${responseTimeMs}ms`,
    );

    // Record response time for slowest-endpoint tracking.
    // Use the Express matched route pattern when available so dynamic segments
    // like /account/:id are grouped together rather than tracked per unique ID.
    const routePattern =
      (req.route && req.route.path)
        ? (req.baseUrl || "") + req.route.path
        : req.path;
    metricsService.recordResponseTime(method, routePattern, responseTimeMs);
  });

  next();
}

module.exports = requestLogger;
module.exports.startHorizonTimer = startHorizonTimer;
module.exports.stopHorizonTimer = stopHorizonTimer;
