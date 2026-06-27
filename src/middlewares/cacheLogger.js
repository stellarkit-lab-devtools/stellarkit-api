/**
 * Cache hit rate logging middleware.
 * Tracks cache hits/misses and logs stats every 60 seconds.
 */
const stats = { hits: 0, misses: 0, lastReset: Date.now() };
const LOG_INTERVAL_MS = 60_000;

const cacheLogger = (req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    const fromCache = res.getHeader('X-Cache') === 'HIT';
    if (fromCache) stats.hits++;
    else stats.misses++;
    const total = stats.hits + stats.misses;
    if (total > 0 && Date.now() - stats.lastReset >= LOG_INTERVAL_MS) {
      const rate = ((stats.hits / total) * 100).toFixed(1);
      console.log(`[cache] hit_rate=${rate}% hits=${stats.hits} misses=${stats.misses} total=${total}`);
      stats.hits = 0; stats.misses = 0; stats.lastReset = Date.now();
    }
    return originalJson(body);
  };
  next();
};

const getCacheStats = () => ({
  hits: stats.hits,
  misses: stats.misses,
  total: stats.hits + stats.misses,
  hit_rate: stats.hits + stats.misses > 0
    ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(1) + '%'
    : '0.0%',
});

module.exports = { cacheLogger, getCacheStats };
