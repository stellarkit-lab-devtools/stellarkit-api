const express = require("express");
const router = express.Router();
const metrics = require("../services/metrics");
const { success } = require("../utils/response");

/**
 * GET /metrics
 *
 * Returns a snapshot of runtime request and error counters plus the top 10
 * slowest endpoints by average response time, so operators can identify
 * which specific routes are the bottleneck without tailing logs.
 *
 * Response shape:
 * {
 *   "success": true,
 *   "data": {
 *     "totalRequests": 120,
 *     "totalErrors": 19,
 *     "errorsByStatus": {
 *       "400": 12,
 *       "404": 5,
 *       "429": 0,
 *       "500": 2,
 *       "503": 0
 *     },
 *     "slowestEndpoints": [
 *       {
 *         "route": "/account/:id",
 *         "method": "GET",
 *         "averageResponseTimeMs": 320.5,
 *         "requestCount": 42
 *       },
 *       ...
 *     ]
 *   }
 * }
 *
 * Notes:
 *   - Counters are in-process and reset on server restart.
 *   - All five well-known status codes (400, 404, 429, 500, 503) are always
 *     present in errorsByStatus, even when their count is 0.
 *   - Additional status codes are included if they have been encountered.
 *   - slowestEndpoints contains up to 10 entries, sorted by averageResponseTimeMs
 *     descending. It is empty ([]) when no requests have been recorded yet.
 */
router.get("/", (req, res) => {
  return success(res, metrics.getSnapshot());
});

module.exports = router;
