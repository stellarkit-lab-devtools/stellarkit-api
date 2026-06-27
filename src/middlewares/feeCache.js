/**
 * Cache middleware for GET /network/base-fee.
 *
 * The Stellar base fee only changes between ledgers (~5 s).
 * Caching for 5 seconds dramatically reduces Horizon load during
 * traffic bursts while keeping data fresh enough for fee estimation.
 *
 * Sets X-Cache: HIT or X-Cache: MISS on every response.
 * Supports ?fresh=true to bypass the cache for a single request.
 */

const FEE_CACHE_TTL_MS = 5_000;
let cached = null;
let cachedAt = 0;

/**
 * Express middleware: cache /network/base-fee responses for 5 seconds.
 * @type {import('express').RequestHandler}
 */
export async function feeCacheMiddleware(req, res, next) {
  const fresh = req.query.fresh === 'true';
  const now = Date.now();

  if (!fresh && cached && now - cachedAt < FEE_CACHE_TTL_MS) {
    res.set('X-Cache', 'HIT');
    return res.json(cached);
  }

  // Intercept res.json to store the response in cache
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode === 200) {
      cached = body;
      cachedAt = Date.now();
    }
    res.set('X-Cache', 'MISS');
    return originalJson(body);
  };

  return next();
}

/** Clear the fee cache (useful in tests). */
export function clearFeeCache() {
  cached = null;
  cachedAt = 0;
}
