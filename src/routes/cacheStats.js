const express = require("express");
const router = express.Router();
const cacheService = require("../services/cache");
const { success } = require("../utils/response");

/**
 * GET /cache/stats
 * Returns cache performance statistics for monitoring.
 *
 * @example
 * GET /cache/stats
 * Response: { hits: 42, misses: 10, hitRate: "80.77%", cachedKeys: 5 }
 */
router.get("/stats", (req, res) => {
  return success(res, cacheService.getStats());
});

module.exports = router;
