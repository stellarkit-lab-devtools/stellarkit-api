/**
 * Middleware and helper for validating and passing through
 * the ?order=asc|desc query parameter to Horizon requests.
 */

const VALID_ORDERS = new Set(['asc', 'desc']);

/**
 * Validate a sort order parameter value.
 *
 * @param {string|undefined} order - The raw query param value
 * @returns {{ order: string, error?: string }}
 */
export function validateOrder(order) {
  if (!order) return { order: 'desc' }; // Horizon default
  const normalised = String(order).toLowerCase().trim();
  if (!VALID_ORDERS.has(normalised)) {
    return {
      order: 'desc',
      error: `Invalid order '${order}'. Must be 'asc' or 'desc'`,
    };
  }
  return { order: normalised };
}

/**
 * Express middleware: parse and attach validated order param to req.
 * Sets req.sortOrder to 'asc' or 'desc'.
 * Responds 400 if an invalid value is provided.
 *
 * @type {import('express').RequestHandler}
 */
export function orderParamMiddleware(req, res, next) {
  const { order, error } = validateOrder(req.query.order);
  if (error) {
    return res.status(400).json({ success: false, error: { type: 'INVALID_REQUEST', message: error } });
  }
  req.sortOrder = order;
  return next();
}
