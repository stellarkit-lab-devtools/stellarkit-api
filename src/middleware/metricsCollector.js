/**
 * Metrics collector middleware.
 *
 * Intercepts every completed response and forwards the key fields
 * (status code, response time, cache header) to the metrics service so
 * the /metrics endpoint can report live counters.
 *
 * Must be mounted AFTER requestIdMiddleware (to share request timing) and
 * BEFORE route handlers so it can observe every response, including errors.
 */

const metricsService = require("../services/metrics");

function metricsCollector(req, res, next) {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    const responseTimeMs = Math.round(elapsedMs * 1000) / 1000;

    if (typeof metricsService.record === "function") {
      metricsService.record({
        statusCode: res.statusCode,
        responseTimeMs,
        xCache: res.getHeader("X-Cache"),
      });
    }
  });

  next();
}

module.exports = metricsCollector;
