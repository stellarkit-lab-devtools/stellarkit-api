/**
 * Route parameter validation middleware.
 *
 * Catches empty strings or whitespace-only route parameters before
 * they reach Horizon, returning a clean 400 instead of a confusing
 * upstream error.
 *
 * Usage: apply before any route handler that uses :id, :address, etc.
 */

/**
 * Build a middleware that validates the specified route params are
 * non-empty and non-whitespace.
 *
 * @param {...string} paramNames - Route param names to validate
 * @returns {import('express').RequestHandler}
 */
export function requireParams(...paramNames) {
  return (req, res, next) => {
    for (const name of paramNames) {
      const value = req.params[name];
      if (!value || !String(value).trim()) {
        return res.status(400).json({
          success: false,
          error: {
            type: 'INVALID_REQUEST',
            message: `Route parameter '${name}' must not be empty or whitespace.`,
            hint: `Provide a valid ${name} in the URL path.`,
          },
        });
      }
    }
    return next();
  };
}
