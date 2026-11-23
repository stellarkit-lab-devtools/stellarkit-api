const rateLimit = require("express-rate-limit");

const DEFAULT_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const GLOBAL_RATE_LIMIT_MAX = 100;
const ACCOUNT_SUMMARY_RATE_LIMIT_MAX = 20;
const ASSET_HOLDERS_RATE_LIMIT_MAX = 10;
const DEFAULT_ACCOUNT_RATE_LIMIT_MAX = 500;

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const RATE_LIMIT_WINDOW_MS = parsePositiveInteger(
  process.env.RATE_LIMIT_WINDOW_MS,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
);

/**
 * Custom handler for rate limit exceeded.
 * Sets proper headers (Retry-After, X-RateLimit-*) and returns structured error response.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 * @param {*} options - Rate limiter options
 */
function rateLimitHandler(req, res, options) {
  const retryAfterSeconds = Math.ceil(RATE_LIMIT_WINDOW_MS / 1000);

  res.set("Retry-After", String(retryAfterSeconds));
  res.set("X-RateLimit-Limit", String(options.max));
  res.set("X-RateLimit-Remaining", "0");
  res.set(
    "X-RateLimit-Reset",
    new Date(Date.now() + RATE_LIMIT_WINDOW_MS).toISOString(),
  );

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
 * @param {Function} [config.keyGenerator] - Custom key generator for rate limit key
 * @returns {Function} Express middleware
 */
function createLimiter({ max, message, keyGenerator }) {
  const limiterHandler = (req, res, _next, _options) => {
    const retryAfterSeconds = Math.ceil(RATE_LIMIT_WINDOW_MS / 1000);

    res.set("Retry-After", String(retryAfterSeconds));
    res.set("X-RateLimit-Limit", String(max));
    res.set("X-RateLimit-Remaining", "0");
    res.set(
      "X-RateLimit-Reset",
      new Date(Date.now() + RATE_LIMIT_WINDOW_MS).toISOString(),
    );

    res.status(429).json({
      success: false,
      error: {
        type: "RateLimitExceeded",
        message: "Too many requests, please try again later.",
        retryAfter: retryAfterSeconds,
        resetAt: new Date(Date.now() + RATE_LIMIT_WINDOW_MS).toISOString(),
      },
    });
  };

  return rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max,
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: keyGenerator || undefined,
    handler: limiterHandler,
    skip: (req) => {
      return req.path === "/health";
    },
  });
}

const GLOBAL_MAX = parsePositiveInteger(
  process.env.RATE_LIMIT_MAX,
  GLOBAL_RATE_LIMIT_MAX,
);
const ACCOUNT_MAX = parsePositiveInteger(
  process.env.ACCOUNT_RATE_LIMIT_MAX,
  DEFAULT_ACCOUNT_RATE_LIMIT_MAX,
);

const globalRateLimiter = createLimiter({
  max: GLOBAL_MAX,
  message: "Too many requests, please try again after 15 minutes.",
});

const accountRateLimiter = createLimiter({
  max: ACCOUNT_MAX,
  message: "Too many account requests, please try again after 15 minutes.",
  keyGenerator: (req) =>
    String(req.headers["x-account-id"] || req.ip),
});

/**
 * Composite rate-limit middleware.
 * Requests with a valid X-Account-ID header use the per-account limiter;
 * all others fall back to the global limiter.
 */
function rateLimitMiddleware(req, res, next) {
  const accountId = req.headers["x-account-id"];
  if (accountId) {
    return accountRateLimiter(req, res, next);
  }
  return globalRateLimiter(req, res, next);
}

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

module.exports = rateLimitMiddleware;
module.exports.accountRateLimiter = accountRateLimiter;
module.exports.globalRateLimiter = globalRateLimiter;
module.exports.accountSummaryRateLimiter = accountSummaryRateLimiter;
module.exports.assetHoldersRateLimiter = assetHoldersRateLimiter;
module.exports.createLimiter = createLimiter;
module.exports.RATE_LIMIT_WINDOW_MS = RATE_LIMIT_WINDOW_MS;
module.exports.ACCOUNT_RATE_LIMIT_MAX = ACCOUNT_MAX;
