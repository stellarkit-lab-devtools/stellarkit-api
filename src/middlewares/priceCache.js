/**
 * Cache middleware for GET /asset/:code/:issuer/price.
 *
 * Asset prices change frequently but not on every request.
 * A 5-second cache reduces Horizon DEX order-book load during bursts.
 * Supports ?fresh=true to bypass. Sets X-Cache: HIT or MISS headers.
 */

const PRICE_CACHE_TTL_MS = 5_000;
const priceCache = new Map();

/**
 * Build a deterministic cache key for an asset price entry.
 * @param {string} code   - Asset code (e.g. 'USDC')
 * @param {string} issuer - Asset issuer address
 * @returns {string}
 */
export function priceCacheKey(code, issuer) {
  return `price:${code.toUpperCase()}:${issuer}`;
}

/**
 * Express middleware: cache /asset/:code/:issuer/price for 5 seconds.
 * @type {import('express').RequestHandler}
 */
export function priceCacheMiddleware(req, res, next) {
  const fresh = req.query.fresh === 'true';
  const key = priceCacheKey(req.params.code, req.params.issuer);
  const entry = priceCache.get(key);

  if (!fresh && entry && Date.now() - entry.at < PRICE_CACHE_TTL_MS) {
    res.set('X-Cache', 'HIT');
    return res.json(entry.data);
  }

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode === 200) {
      priceCache.set(key, { data: body, at: Date.now() });
    }
    res.set('X-Cache', 'MISS');
    return originalJson(body);
  };

  return next();
}

/** Clear all price cache entries (for tests). */
export function clearPriceCache() {
  priceCache.clear();
}
