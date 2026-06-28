/**
 * Cache middleware for GET /account/:id/trustlines.
 * Trustline data is relatively stable — a short 15s TTL
 * meaningfully reduces Horizon load for apps managing asset approvals.
 * Supports ?fresh=true bypass. Sets X-Cache: HIT or MISS.
 */

const TTL_MS = parseInt(process.env.CACHE_TTL_TRUSTLINES_MS || '15000', 10);
const trustlinesCache = new Map();

export function trustlinesCacheMiddleware(req, res, next) {
  const fresh = req.query.fresh === 'true';
  const key   = `trustlines:${req.params.id}`;
  const entry = trustlinesCache.get(key);

  if (!fresh && entry && Date.now() - entry.at < TTL_MS) {
    res.set('X-Cache', 'HIT');
    return res.json(entry.data);
  }

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode === 200) {
      trustlinesCache.set(key, { data: body, at: Date.now() });
    }
    res.set('X-Cache', 'MISS');
    return originalJson(body);
  };
  return next();
}

export function clearTrustlinesCache() { trustlinesCache.clear(); }
export { TTL_MS as TRUSTLINES_CACHE_TTL_MS };
