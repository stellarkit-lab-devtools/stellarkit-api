/**
 * Query parameter coercion middleware.
 *
 * Converts well-known query parameters from their raw string form (as Express
 * always provides them) to the JavaScript types that route handlers expect:
 *
 *   - `limit`      → integer   (e.g. "20"    → 20)
 *   - `operations` → integer   (e.g. "3"     → 3)
 *   - `fresh`      → boolean   (e.g. "true"  → true, "false" → false)
 *
 * Any parameter not in the known set is left untouched.  Invalid values (e.g.
 * "abc" for `limit`) are left as strings so that downstream validation can
 * produce a meaningful error message.
 *
 * This middleware must run after the `sanitize` middleware so that string
 * values have already been trimmed before coercion is attempted.
 */

/** Parameters to coerce to integers. */
const INTEGER_PARAMS = new Set(["limit", "operations"]);

/** Parameters to coerce to booleans. */
const BOOLEAN_PARAMS = new Set(["fresh"]);

/**
 * Attempt to coerce a trimmed string to an integer.
 * Returns the integer if the string is a valid whole number, otherwise returns
 * the original string unchanged.
 *
 * @param {string} value
 * @returns {number|string}
 */
function toIntegerOrOriginal(value) {
  if (/^-?\d+$/.test(value)) {
    return parseInt(value, 10);
  }
  return value;
}

/**
 * Attempt to coerce a trimmed string to a boolean.
 * Recognises "true" and "false" (case-insensitive).  Any other value is left
 * as a string unchanged.
 *
 * @param {string} value
 * @returns {boolean|string}
 */
function toBooleanOrOriginal(value) {
  const lower = value.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  return value;
}

/**
 * Express middleware that coerces specific query parameters to their native
 * JavaScript types.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function coerceQueryParams(req, res, next) {
  for (const [key, value] of Object.entries(req.query)) {
    if (typeof value !== "string") {
      // Skip arrays and any value already coerced by another middleware.
      continue;
    }

    if (INTEGER_PARAMS.has(key)) {
      req.query[key] = toIntegerOrOriginal(value);
    } else if (BOOLEAN_PARAMS.has(key)) {
      req.query[key] = toBooleanOrOriginal(value);
    }
    // Unknown params are left untouched.
  }

  next();
}

module.exports = coerceQueryParams;
