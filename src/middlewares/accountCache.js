/**
 * Cache middleware for GET /account/:id.
 * Account data changes infrequently — 10s caching reduces Horizon load
 * for apps calling the same account repeatedly.
 * Supports ?fresh=true bypass. Sets X-Cache: HIT or MISS.
 */

const TTL_MS = parseInt(process.env.CACHE_TTL_ACCOUNT_MS || '10000', 10);
const accountCache = new Map();

export function accountCacheMiddleware(req, res, next) {
  const fresh = req.query.fresh === 'true';
  const key   = `account:${req.params.id}`;
  const entry = accountCache.get(key);

  if (!fresh && entry && Date.now() - entry.at < TTL_MS) {
    res.set('X-Cache', 'HIT');
    return res.json(entry.data);
  }

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode === 200) {
      accountCache.set(key, { data: body, at: Date.now() });
    }
    res.set('X-Cache', 'MISS');
    return originalJson(body);
  };
  return next();
}

export function clearAccountCache() { accountCache.clear(); }
export { TTL_MS as ACCOUNT_CACHE_TTL_MS };
