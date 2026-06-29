const rateLimit = require("express-rate-limit");

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const GLOBAL_RATE_LIMIT_MAX = 100;
const ACCOUNT_SUMMARY_RATE_LIMIT_MAX = 20;
const ASSET_HOLDERS_RATE_LIMIT_MAX = 10;

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Custom handler for rate limit exceeded.
 * Sets proper headers (Retry-After, X-RateLimit-*) and returns structured error response.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 * @param {*} options - Rate limiter options
 */
function rateLimitHandler(req, res, options) {
  // Calculate retry-after in seconds (window in ms to seconds)
  const retryAfterSeconds = Math.ceil(RATE_LIMIT_WINDOW_MS / 1000);

  // Set rate limit headers on all rate-limited responses
  res.set('Retry-After', String(retryAfterSeconds));
  res.set('X-RateLimit-Limit', String(options.max));
  res.set('X-RateLimit-Remaining', '0');
  res.set('X-RateLimit-Reset', new Date(Date.now() + RATE_LIMIT_WINDOW_MS).toISOString());

  res.status(429).json({
    success: false,
    error: {
      type: "RateLimitExceeded",
      message: "Too many requests, please try again later.",
      retryAfter: retryAfterSeconds,
      resetAt: new Date(Date.now() + RATE_LIMIT_WINDOW_MS).toISOString(),
    },
  });
}

/**
 * Create a rate limiter with proper error handling and headers.
 *
 * @param {Object} config - Configuration object
 * @param {number} config.max - Maximum requests per window
 * @param {string} config.message - User-friendly error message
 * @returns {Function} Express middleware
 */
function createLimiter({ max, message }) {
  return rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max,
    standardHeaders: false, // Don't use default RateLimit-* headers
    legacyHeaders: false,   // Don't use deprecated X-RateLimit-* headers from express-rate-limit
    handler: rateLimitHandler, // Use our custom handler
    // Optional: Skip certain requests
    skip: (req) => {
      // Skip health check endpoint
      return req.path === "/health";
    },
  });
}

const globalRateLimiter = createLimiter({
  max: parsePositiveInteger(process.env.RATE_LIMIT_MAX, GLOBAL_RATE_LIMIT_MAX),
  message: "Too many requests, please try again after 15 minutes.",
});

const accountSummaryRateLimiter = createLimiter({
  max: ACCOUNT_SUMMARY_RATE_LIMIT_MAX,
  message:
    "Too many account summary requests, please try again after 15 minutes.",
});

const assetHoldersRateLimiter = createLimiter({
  max: ASSET_HOLDERS_RATE_LIMIT_MAX,
  message:
    "Too many asset holder requests, please try again after 15 minutes.",
});

module.exports = globalRateLimiter;
module.exports.accountSummaryRateLimiter = accountSummaryRateLimiter;
module.exports.assetHoldersRateLimiter = assetHoldersRateLimiter;
module.exports.globalRateLimiter = globalRateLimiter;
module.exports.accountSummaryRateLimiter = accountSummaryRateLimiter;
module.exports.assetHoldersRateLimiter = assetHoldersRateLimiter;
module.exports.createLimiter = createLimiter;
module.exports.RATE_LIMIT_WINDOW_MS = RATE_LIMIT_WINDOW_MS;
