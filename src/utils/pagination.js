const { validateLimit, validateOrder, validateCursor } = require("./validators");

/**
 * Resolve a page number to a Horizon paging cursor.
 *
 * Horizon uses opaque paging tokens rather than numeric offsets, so we
 * compute the cursor by fetching the records that precede the requested page
 * and returning the last paging_token.  Page 1 always returns undefined
 * (no cursor needed).
 *
 * This helper is intentionally async so callers can await it inline.
 *
 * @param {Function} buildQuery - A function that accepts (limit, cursor) and
 *   returns a callable Horizon query (i.e. the object returned by e.g.
 *   server.payments().forAccount(id).limit(n).order(order)).
 * @param {number} page   - The 1-based page number requested by the client.
 * @param {number} limit  - Number of records per page.
 * @param {string} order  - "asc" or "desc" — must match the order used by buildQuery.
 * @returns {Promise<string|undefined>} The paging_token to use as cursor, or
 *   undefined when page 1 is requested.
 */
async function resolveCursorForPage(buildQuery, page, limit, order) {
  if (page <= 1) return undefined;

  // We need to skip (page - 1) * limit records to land at the start of the
  // requested page.  Horizon allows a maximum limit of 200 per call, so we
  // may need multiple round-trips for large page numbers.
  const skip = (page - 1) * limit;
  const HORIZON_MAX = 200;

  let remaining = skip;
  let cursor;

  while (remaining > 0) {
    const batch = Math.min(remaining, HORIZON_MAX);
    const query = buildQuery(batch, cursor);
    const response = await query.call();
    const records = response.records || [];

    if (records.length === 0) break; // fewer records than expected — stop

    cursor = records[records.length - 1].paging_token;
    remaining -= records.length;

    if (records.length < batch) break; // last page reached
  }

  return cursor;
}

/**
 * Parse and validate pagination query parameters.
 *
 * Supports two mutually exclusive pagination styles:
 *
 *   Cursor pagination (preferred for large datasets):
 *     ?cursor=<paging_token>&limit=20&order=desc
 *
 *   Page-based pagination (convenience for simple use cases):
 *     ?page=2&limit=20&order=desc
 *
 * When ?page= is supplied without ?cursor=, the function returns a `page`
 * value in the result object.  The caller is responsible for translating
 * that page number into a cursor using `resolveCursorForPage` if the
 * underlying Horizon query requires one.
 *
 * Rules:
 *   - page must be a positive integer (>= 1). page=1 is equivalent to no
 *     pagination param.
 *   - If both ?page= and ?cursor= are provided, ?cursor= takes precedence
 *     and ?page= is ignored.
 *   - Invalid page values (0, negative, non-integer, non-numeric) throw a
 *     400-class validation error.
 *
 * @param {object} query - Express req.query object
 * @param {number} [maxLimit=100] - Maximum allowed limit value
 * @returns {object} Validated pagination object:
 *   {
 *     limit: number,            // Validated limit (1 to maxLimit)
 *     order: string,            // "asc" or "desc" (defaults to "desc")
 *     cursor: string|undefined, // Optional Horizon paging cursor
 *     page:   number|undefined, // Requested page (only set when ?page= used without ?cursor=)
 *   }
 *
 * @throws {Error} If limit, order, cursor, or page values are invalid.
 *
 * @example
 * // Cursor pagination
 * const { limit, order, cursor } = parsePaginationParams(req.query, 200);
 *
 * // Page pagination — caller must resolve cursor before querying Horizon
 * const { limit, order, page } = parsePaginationParams(req.query);
 * if (page && page > 1) {
 *   cursor = await resolveCursorForPage(buildQuery, page, limit, order);
 * }
 */
function parsePaginationParams(query = {}, maxLimit = 100) {
  // Parse limit with default of 20
  const limit = validateLimit(query.limit ?? 20, maxLimit);

  // Parse order with default of "desc"
  const order = validateOrder(query.order);

  // Cursor takes precedence over page when both are supplied
  if (query.cursor !== undefined) {
    const cursor = validateCursor(query.cursor);
    return { limit, order, cursor };
  }

  // Page-based pagination
  if (query.page !== undefined) {
    const rawPage = query.page;
    const parsed = Number(rawPage);
    if (!Number.isInteger(parsed) || parsed < 1) {
      const err = new Error(
        "Query parameter 'page': must be a positive integer (e.g. 1, 2, 3).",
      );
      err.isValidation = true;
      err.field = "page";
      err.receivedValue = String(rawPage).slice(0, 50);
      err.expectedFormat = "positive integer >= 1";
      err.status = 400;
      throw err;
    }
    // page=1 is identical to no pagination — return no cursor and no page marker
    if (parsed === 1) return { limit, order, cursor: undefined };
    return { limit, order, cursor: undefined, page: parsed };
  }

  // Default: no cursor, no page
  return { limit, order, cursor: undefined };
}

module.exports = { parsePaginationParams, resolveCursorForPage };
