const rateLimit = require('express-rate-limit');

/**
 * Rate limiter with proper 429 response including Retry-After header.
 * Clients receive a human-readable message and know exactly when to retry.
 */
const createRateLimiter = (options = {}) => rateLimit({
  windowMs: options.windowMs || 15 * 60 * 1000,
  max: options.max || 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const retryAfter = Math.ceil(
      (req.rateLimit.resetTime - Date.now()) / 1000
    );
    res.set('Retry-After', retryAfter);
    res.status(429).json({
      success: false,
      error: {
        type: 'RATE_LIMITED',
        message: 'Too many requests. Please slow down.',
        retryAfterSeconds: retryAfter,
        hint: `Try again in ${retryAfter} second${retryAfter !== 1 ? 's' : ''}`,
      },
    });
  },
  skip: (req) => req.path === '/health',
});

module.exports = { createRateLimiter };
