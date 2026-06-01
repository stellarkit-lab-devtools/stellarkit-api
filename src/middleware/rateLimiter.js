const rateLimit = require("express-rate-limit");

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const GLOBAL_RATE_LIMIT_MAX = 100;
const ACCOUNT_SUMMARY_RATE_LIMIT_MAX = 20;
const ASSET_HOLDERS_RATE_LIMIT_MAX = 10;

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function buildRateLimitMessage(message) {
  return {
    success: false,
    error: {
      type: "RateLimitError",
      message,
    },
  };
}

function createLimiter({ max, message }) {
  return rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: buildRateLimitMessage(message),
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
module.exports.globalRateLimiter = globalRateLimiter;
module.exports.accountSummaryRateLimiter = accountSummaryRateLimiter;
module.exports.assetHoldersRateLimiter = assetHoldersRateLimiter;
module.exports.createLimiter = createLimiter;
module.exports.RATE_LIMIT_WINDOW_MS = RATE_LIMIT_WINDOW_MS;
