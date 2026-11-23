/**
 * Re-export module for backwards compatibility.
 *
 * The cost-based token-bucket limiter in costRateLimiter.js replaces the
 * old express-rate-limit middleware.  Per-route specialized limiters
 * (accountSummaryRateLimiter, assetHoldersRateLimiter) are now pass-through
 * middleware because the global cost-based limiter charges each route's
 * cost from the route-costs table.
 */

const costRateLimiter = require("./costRateLimiter");

/**
 * Pass-through middleware for routes that previously had a specialised
 * per-route limiter.  The cost-based global limiter now handles rate limiting
 * through the route-costs table, so these are no-ops.
 */
function passThrough(req, res, next) {
  next();
}

module.exports = costRateLimiter;
module.exports.accountSummaryRateLimiter = passThrough;
module.exports.assetHoldersRateLimiter = passThrough;
module.exports.globalRateLimiter = costRateLimiter;
module.exports.accountRateLimiter = costRateLimiter;
module.exports.createLimiter = () => passThrough;
module.exports.RATE_LIMIT_WINDOW_MS = costRateLimiter.RATE_LIMIT_WINDOW_MS;
module.exports.ACCOUNT_RATE_LIMIT_MAX = costRateLimiter.ACCOUNT_BUDGET;
