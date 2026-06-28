/**
 * Pagination limit middleware.
 * Standardises all paginated endpoints to default limit=20,
 * cap at max limit=200, and reject non-integer values with 400.
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT     = 200;

/**
 * Parse and validate a limit query parameter.
 * @param {string|undefined} raw
 * @returns {{ limit: number, error?: string }}
 */
export function parseLimit(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { limit: DEFAULT_LIMIT };
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    return { limit: DEFAULT_LIMIT, error: `limit must be a positive integer, got '${raw}'` };
  }
  if (n > MAX_LIMIT) {
    return { limit: MAX_LIMIT, error: `limit capped at ${MAX_LIMIT}` };
  }
  return { limit: n };
}

/**
 * Express middleware: parse limit param, attach as req.pageLimit.
 * Returns 400 on invalid non-numeric value.
 * @type {import('express').RequestHandler}
 */
export function paginateLimitMiddleware(req, res, next) {
  const { limit, error } = parseLimit(req.query.limit);
  if (error && req.query.limit !== undefined) {
    const n = Number(req.query.limit);
    if (!Number.isInteger(n) || n < 1) {
      return res.status(400).json({
        success: false,
        error: { type: 'INVALID_REQUEST', message: error },
      });
    }
  }
  req.pageLimit = limit;
  return next();
}

export { DEFAULT_LIMIT, MAX_LIMIT };
