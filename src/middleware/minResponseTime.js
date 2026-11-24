"use strict";

/**
 * Minimum response time middleware.
 *
 * Pads specific validation-error responses so an attacker cannot distinguish
 * them from Horizon-backed rejections by measuring response time. A malformed
 * account ID is rejected synchronously by `validateAccountId`, whereas a
 * well-formed but unknown account requires a Horizon round trip; without
 * padding the faster 400 leaks whether an address is structurally valid
 * (account enumeration).
 *
 * The middleware wraps `res.json` for the duration of the request. When the
 * outgoing response is a 400 whose error `type` is a known validation/format
 * error, it defers the write until `MIN_RESPONSE_TIME_MS` have elapsed since
 * the middleware ran. Every other response (2xx, 404, 5xx, ...) is written
 * untouched, and the middleware is a no-op when the delay resolves to 0.
 */

const {
  MIN_RESPONSE_TIME_MS,
  parseMinResponseTimeMs,
} = require("../config/responseTiming");

/**
 * Error `type` values (as emitted in the `{ success: false, error: { type } }`
 * envelope) that are padded. These are the format/validation rejections
 * produced before any Horizon call.
 */
const PADDED_ERROR_TYPES = new Set([
  "InvalidAccountId",
  "ValidationError",
  "MissingParameter",
]);

/**
 * Returns true when a response body is a pad-eligible validation error.
 *
 * @param {*} body - Value passed to `res.json`.
 * @returns {boolean}
 */
function isPaddedValidationError(body) {
  if (!body || typeof body !== "object") return false;
  const error = body.error;
  if (!error || typeof error !== "object") return false;
  return PADDED_ERROR_TYPES.has(error.type);
}

/**
 * Create the middleware. The delay is resolved once, at creation time.
 *
 * @param {{ minResponseTimeMs?: number }} [options]
 * @returns {import('express').RequestHandler}
 */
function createMinResponseTimeMiddleware({ minResponseTimeMs } = {}) {
  const delayMs = parseMinResponseTimeMs(
    minResponseTimeMs === undefined ? MIN_RESPONSE_TIME_MS : minResponseTimeMs
  );

  return function minResponseTime(req, res, next) {
    if (delayMs <= 0) return next();

    const startedAtNs = process.hrtime.bigint();
    const originalJson = res.json.bind(res);

    res.json = function patchedJson(body) {
      if (res.statusCode !== 400 || !isPaddedValidationError(body)) {
        return originalJson(body);
      }

      const elapsedMs = Number(process.hrtime.bigint() - startedAtNs) / 1e6;
      const remainingMs = delayMs - elapsedMs;
      if (remainingMs <= 0) {
        return originalJson(body);
      }

      setTimeout(() => originalJson(body), remainingMs);
      return res;
    };

    return next();
  };
}

const minResponseTime = createMinResponseTimeMiddleware();

module.exports = minResponseTime;
module.exports.createMinResponseTimeMiddleware = createMinResponseTimeMiddleware;
module.exports.isPaddedValidationError = isPaddedValidationError;
module.exports.PADDED_ERROR_TYPES = PADDED_ERROR_TYPES;
