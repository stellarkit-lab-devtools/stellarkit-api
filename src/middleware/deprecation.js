/**
 * Route wrapper that advertises deprecation and sunset metadata (RFC 8594 /
 * RFC 8594-style headers) without changing successful response bodies.
 *
 * @param {object} options
 * @param {string|number|Date} options.since - When the endpoint was deprecated.
 * @param {string|number|Date} options.sunset - When the endpoint stops working.
 * @param {string} [options.replacement] - Successor endpoint/documentation URL.
 * @param {boolean} [options.enforce=false] - Return 410 Gone after sunset.
 * @returns {import("express").RequestHandler} Express middleware.
 */
function deprecate({ since, sunset, replacement, enforce = false } = {}) {
  const sinceMs = Date.parse(since);
  const sunsetMs = Date.parse(sunset);
  const sinceEpoch = Number.isNaN(sinceMs)
    ? String(since)
    : String(Math.floor(sinceMs / 1000));
  const sunsetDate = Number.isNaN(sunsetMs) ? null : new Date(sunsetMs);

  return function deprecationMiddleware(req, res, next) {
    res.set("Deprecation", `@${sinceEpoch}`);
    if (sunsetDate) res.set("Sunset", sunsetDate.toUTCString());
    if (replacement) {
      res.set("Link", `<${replacement}>; rel="successor-version"`);
    }

    if (enforce && sunsetDate && Date.now() >= sunsetMs) {
      return res.status(410).json({
        success: false,
        error: {
          type: "Gone",
          message: replacement
            ? `This endpoint is no longer available. Use ${replacement} instead.`
            : "This endpoint is no longer available.",
          since: sinceEpoch,
          sunset: sunsetDate.toISOString(),
          replacement: replacement || null,
        },
      });
    }

    return next();
  };
}

module.exports = deprecate;
