/**
 * Request logging middleware with robust error handling.
 * 
 * Guards against:
 * - Missing or odd headers
 * - Undefined req.route on 404s
 * - Requests aborted before finish
 * - Non-string req.ip
 * - Very long URLs
 * - Circular structures in error context
 * 
 * Attaches finish hook once to prevent double logging.
 */

const redactSeeds = require("../utils/redactSeeds");
const sanitizeLogValue = require("../utils/sanitizeLogValue");
const logger = require("../utils/logger");
const metricsService = require("../services/metrics");

const SLOW_REQUEST_THRESHOLD_MS =
  parseInt(process.env.SLOW_REQUEST_THRESHOLD_MS, 10) || 2000;

function safeStringify(obj, depth = 3) {
  const seen = new Set();
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]";
      if (depth <= 0) return "[Truncated]";
      seen.add(value);
    }
    return value;
  }, 2);
}

function safeGet(obj, path) {
  try {
    return path.reduce((curr, key) => (curr && curr[key] !== undefined) ? curr[key] : undefined, obj);
  } catch {
    return undefined;
  }
}

function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();
  let finished = false;
  let logged = false;

  const logOnce = (extra = {}) => {
    if (logged) return;
    logged = true;

    try {
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
      const responseTimeMs = Math.round(elapsedMs * 1000) / 1000;
      const requestId = req.requestId || "-";
      const method = req.method;

      // Sanitize user-supplied values: path, query string, User-Agent, Referer, Origin
      const rawPath = req.originalUrl || req.url;
      const path = sanitizeLogValue(redactSeeds(rawPath));
      const query = sanitizeLogValue(req._parsedUrl && req._parsedUrl.query ? req._parsedUrl.query : '');
      const userAgent = sanitizeLogValue(req.headers['user-agent']);
      const referer = sanitizeLogValue(req.headers['referer']);
      const origin = sanitizeLogValue(req.headers['origin']);

      const statusCode = res.statusCode;

      const ip = safeGet(req, ["ip"]);
      const safeIp = typeof ip === "string" ? ip : "unknown";

      const fields = {
        requestId,
        method,
        path: path.length > 2048 ? path.substring(0, 2048) + "... [truncated]" : path,
        statusCode,
        responseTimeMs,
        clientIp: safeIp,
        ...extra
      };

      if (typeof req.horizonResponseTimeMs === "number") {
        fields.horizonResponseTimeMs = req.horizonResponseTimeMs;
      }

      logger.info(fields, `[${requestId}] ${method} ${path} ${statusCode} ${responseTimeMs}ms`);

      const routePattern = (safeGet(req, ["route", "path"]))
        ? (safeGet(req, ["baseUrl"]) || "") + safeGet(req, ["route", "path"])
        : safeGet(req, ["path"]) || "unknown";

      metricsService.recordResponseTime(method, routePattern, responseTimeMs);

      if (responseTimeMs > SLOW_REQUEST_THRESHOLD_MS) {
        logger.warn({ requestId, method, path, responseTimeMs, threshold: SLOW_REQUEST_THRESHOLD_MS }, "[SLOW REQUEST]");
      }
    } catch (logError) {
      try {
        logger.error({
          error: safeStringify(logError),
          originalPath: safeGet(req, ["originalUrl"]) || "unknown"
        }, "[LOGGER FALLBACK] Failed to log request");
      } catch {
        // Silent fallback - never let logging crash the request
      }
    }
  };

  const onFinish = () => {
    if (finished) return;
    finished = true;
    logOnce();
  };

  const onClose = () => {
    if (finished) return;
    finished = true;
    logOnce({ aborted: true });
  };

  res.on("finish", onFinish);
  res.on("close", onClose);

  req.once("close", () => {
    if (!finished) {
      res.removeListener("finish", onFinish);
      res.removeListener("close", onClose);
      onClose();
    }
  });

  next();
}

module.exports = requestLogger;
module.exports.startHorizonTimer = (req) => { req._horizonCallStart = process.hrtime.bigint(); };
module.exports.stopHorizonTimer = (req) => {
  if (!req._horizonCallStart) return;
  const elapsed = Number(process.hrtime.bigint() - req._horizonCallStart) / 1e6;
  req._horizonCallStart = undefined;
  req.horizonResponseTimeMs = Math.round(((req.horizonResponseTimeMs || 0) + elapsed) * 1000) / 1000;
};