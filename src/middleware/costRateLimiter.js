/**
 * Cost-based token-bucket rate limiter.
 *
 * Each request is charged a cost based on its route (see src/config/routeCosts.js).
 * The default cost is 1, aggregate/fan-out endpoints cost more, and batch
 * endpoints cost their item count.  A response with X-Cache: HIT is refunded
 * down to a cost of 1.
 *
 * The budget per window is RATE_LIMIT_BUDGET, defaulting to the existing
 * RATE_LIMIT_MAX so current deployments behave the same.
 *
 * Clients are identified the same way the legacy limiter identifies them:
 * `req.headers["x-account-id"] || req.ip`.
 */

const { getRouteCost } = require("../config/routeCosts");

const DEFAULT_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const RATE_LIMIT_WINDOW_MS = parsePositiveInteger(
  process.env.RATE_LIMIT_WINDOW_MS,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
);

// Budget defaults to RATE_LIMIT_MAX so current deployments behave the same.
const GLOBAL_BUDGET = parsePositiveInteger(
  process.env.RATE_LIMIT_BUDGET,
  parsePositiveInteger(process.env.RATE_LIMIT_MAX, 100),
);

const ACCOUNT_BUDGET = parsePositiveInteger(
  process.env.RATE_LIMIT_BUDGET,
  parsePositiveInteger(process.env.ACCOUNT_RATE_LIMIT_MAX, 500),
);

/**
 * Per-client token bucket.
 *
 * Each entry tracks { tokens, resetAt } and lives in a Map keyed by client ID.
 * Entries are lazily pruned after their window expires.
 */
const buckets = new Map();

/**
 * Get or create a bucket for a client key.
 *
 * @param {string} key - Client identifier.
 * @param {number} budget - Token budget per window.
 * @returns {{ tokens: number, resetAt: number }}
 */
function getBucket(key, budget) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { tokens: budget, resetAt: now + RATE_LIMIT_WINDOW_MS };
    buckets.set(key, bucket);
  }
  return bucket;
}

/**
 * Prune expired buckets to prevent unbounded growth.
 */
function pruneBuckets() {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

// Prune every 5 minutes — cheap and prevents slow memory leak.
setInterval(pruneBuckets, 5 * 60 * 1000).unref();

/**
 * Build the 429 response body and headers.
 */
function sendRateLimited(res, budget, bucket) {
  const retryAfterSeconds = Math.ceil((bucket.resetAt - Date.now()) / 1000);
  const retryAfter = Math.max(1, retryAfterSeconds);

  res.set("Retry-After", String(retryAfter));
  res.set("X-RateLimit-Limit", String(budget));
  res.set("X-RateLimit-Remaining", "0");
  res.set("X-RateLimit-Reset", new Date(bucket.resetAt).toISOString());

  res.status(429).json({
    success: false,
    error: {
      type: "RateLimitExceeded",
      message: "Too many requests, please try again later.",
      retryAfter,
      resetAt: new Date(bucket.resetAt).toISOString(),
    },
  });
}

/**
 * Cost-based rate-limit middleware.
 *
 * Charges each request its route's cost, refunds cache hits down to 1, and
 * sets X-RateLimit-Cost on every response.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function costRateLimiter(req, res, next) {
  // Skip health check
  if (req.path === "/health") {
    return next();
  }

  const accountId = req.headers["x-account-id"];
  const isAccount = !!accountId;
  const budget = isAccount ? ACCOUNT_BUDGET : GLOBAL_BUDGET;
  const key = isAccount ? `acct:${accountId}` : `ip:${req.ip}`;

  const cost = getRouteCost(req);
  const bucket = getBucket(key, budget);

  if (bucket.tokens < cost) {
    // Overspend — not enough budget for the requested cost
    sendRateLimited(res, budget, bucket);
    return;
  }

  // Charge the full cost now; refund later if it's a cache hit
  bucket.tokens -= cost;

  // Set X-RateLimit-Cost on the response
  res.set("X-RateLimit-Cost", String(cost));

  // Set standard rate-limit headers for successful responses
  res.set("X-RateLimit-Limit", String(budget));
  res.set("X-RateLimit-Remaining", String(Math.max(0, bucket.tokens)));
  res.set("X-RateLimit-Reset", new Date(bucket.resetAt).toISOString());

  // Refund cache hits down to a cost of 1
  res.on("finish", () => {
    if (res.headersSent) {
      const cacheHeader = res.get("X-Cache");
      if (cacheHeader === "HIT" && cost > 1) {
        bucket.tokens += cost - 1;
        // Update the cost header to reflect the refund
        // (headers are already sent, so we can't change them, but the
        // X-RateLimit-Remaining was set before the response went out)
      }
    }
  });

  next();
}

// Expose for tests
costRateLimiter._buckets = buckets;
costRateLimiter._getBucket = getBucket;
costRateLimiter.RATE_LIMIT_WINDOW_MS = RATE_LIMIT_WINDOW_MS;
costRateLimiter.GLOBAL_BUDGET = GLOBAL_BUDGET;
costRateLimiter.ACCOUNT_BUDGET = ACCOUNT_BUDGET;

module.exports = costRateLimiter;
