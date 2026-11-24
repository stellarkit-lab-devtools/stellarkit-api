/**
 * Middleware that returns 404 { type: "EndpointDisabled" } for routes listed
 * in the DISABLED_ROUTES environment variable.
 *
 * DISABLED_ROUTES is a comma-separated list of patterns:
 *   - Exact entries:  "GET /network/top-accounts"
 *   - Prefix wildcard: "/soroban/*"  (matches any method on any path under /soroban/)
 *
 * Patterns are matched against the registered Express route string
 * (req.method + " " + req.path).  Wildcard patterns strip the trailing "*"
 * and test whether the request path starts with the prefix.
 *
 * Usage: mount once, early in the stack, after route registration so
 * req.route is populated and we can match the full registered pattern.
 * But we match against req.method + req.path before route handlers fire
 * so upstream calls are never made.
 */

const logger = require("../utils/logger");

/**
 * Parse DISABLED_ROUTES into an array of matcher functions.
 *
 * @param {string} raw - Comma-separated pattern string.
 * @param {string[]} [registeredRoutes] - Known routes for warning on unmatched patterns.
 * @returns {Array<{ raw: string, match: (method: string, path: string) => boolean }>}
 */
function parsePatterns(raw, registeredRoutes = []) {
  if (!raw || typeof raw !== "string") return [];

  const patterns = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return patterns.map((pattern) => {
    // Exact entry: "GET /network/top-accounts"
    if (/^[A-Z]+\s+\//.test(pattern)) {
      const [method, ...pathParts] = pattern.split(/\s+/);
      const path = pathParts.join(" ");
      const matcher = {
        raw: pattern,
        match: (m, p) =>
          m.toUpperCase() === method.toUpperCase() && p === path,
      };
      warnIfNoMatch(pattern, matcher, registeredRoutes);
      return matcher;
    }

    // Prefix wildcard: "/soroban/*"
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -1); // "/soroban/"
      const matcher = {
        raw: pattern,
        match: (_m, p) => p.startsWith(prefix) || p === prefix.slice(0, -1),
      };
      warnIfNoMatch(pattern, matcher, registeredRoutes);
      return matcher;
    }

    // Plain path prefix without wildcard: "/soroban"
    const matcher = {
      raw: pattern,
      match: (_m, p) => p === pattern || p.startsWith(pattern + "/"),
    };
    warnIfNoMatch(pattern, matcher, registeredRoutes);
    return matcher;
  });
}

function warnIfNoMatch(pattern, matcher, registeredRoutes) {
  if (!registeredRoutes.length) return;
  const hits = registeredRoutes.filter(({ method, path }) =>
    matcher.match(method, path)
  );
  if (hits.length === 0) {
    logger.warn(
      { pattern },
      `DISABLED_ROUTES: pattern "${pattern}" matches no registered routes`
    );
  }
}

/**
 * Build the disabled-routes middleware from a pattern string and the app's
 * registered route list (for startup warnings).
 *
 * @param {string} raw - Value of the DISABLED_ROUTES env var.
 * @param {Array<{ method: string, path: string }>} registeredRoutes
 * @returns {import('express').RequestHandler}
 */
function buildDisabledRoutesMiddleware(raw, registeredRoutes = []) {
  const patterns = parsePatterns(raw, registeredRoutes);

  if (patterns.length > 0) {
    logger.info(
      { patterns: patterns.map((p) => p.raw) },
      `DISABLED_ROUTES: ${patterns.length} pattern(s) active`
    );
  }

  return function disabledRoutes(req, res, next) {
    if (patterns.length === 0) return next();

    const method = req.method.toUpperCase();
    const path = req.path;

    for (const pattern of patterns) {
      if (pattern.match(method, path)) {
        return res.status(404).json({
          success: false,
          error: {
            type: "EndpointDisabled",
            message: `${method} ${path} has been disabled on this instance.`,
          },
        });
      }
    }

    next();
  };
}

module.exports = { buildDisabledRoutesMiddleware, parsePatterns };
