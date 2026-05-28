const express = require("express");
const router = express.Router();
const { server } = require("../config/stellar");
const { success } = require("../utils/response");
const { feeEstimateCache } = require("../utils/cache");

/**
 * GET /fee-estimate
 * Returns fee statistics for recent ledgers to help developers pick a competitive fee.
 *
 * Query params:
 *   - operations (number, default: 1) — number of operations in your transaction
 *
 * @example
 * GET /fee-estimate
 * GET /fee-estimate?operations=3
 */
router.get("/", async (req, res, next) => {
  try {
    const operations = Math.max(1, parseInt(req.query.operations) || 1);
    const cacheKey = `fee-estimate:${operations}`;
    const fresh = req.query.fresh === "true";

    // Check cache first (unless fresh=true)
    if (!fresh) {
      const cached = feeEstimateCache.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    // Cache miss or fresh=true - fetch from Horizon
    const feeStats = await server.feeStats();

    const base = parseInt(feeStats.fee_charged.p10);
    const recommended = parseInt(feeStats.fee_charged.p50);
    const priority = parseInt(feeStats.fee_charged.p95);

    const data = {
      note: `Fee estimates for a transaction with ${operations} operation(s). Fees are in stroops (1 XLM = 10,000,000 stroops).`,
      operationCount: operations,
      perOperation: {
        economy: {
          stroops: parseInt(feeStats.fee_charged.min),
          xlm: (parseInt(feeStats.fee_charged.min) / 1e7).toFixed(7),
          description: "Minimum — may be slow during congestion",
        },
        standard: {
          stroops: recommended,
          xlm: (recommended / 1e7).toFixed(7),
          description: "Recommended for most transactions",
        },
        priority: {
          stroops: priority,
          xlm: (priority / 1e7).toFixed(7),
          description: "Fast inclusion even during high network load",
        },
      },
      totalFee: {
        economy: {
          stroops: parseInt(feeStats.fee_charged.min) * operations,
          xlm: ((parseInt(feeStats.fee_charged.min) * operations) / 1e7).toFixed(7),
        },
        standard: {
          stroops: recommended * operations,
          xlm: ((recommended * operations) / 1e7).toFixed(7),
        },
        priority: {
          stroops: priority * operations,
          xlm: ((priority * operations) / 1e7).toFixed(7),
        },
      },
      networkStats: {
        lastLedgerBaseFee: feeStats.last_ledger_base_fee,
        ledgerCapacityUsage: feeStats.ledger_capacity_usage,
        maxFeeCharged: feeStats.fee_charged.max,
        p10: feeStats.fee_charged.p10,
        p50: feeStats.fee_charged.p50,
        p95: feeStats.fee_charged.p95,
        p99: feeStats.fee_charged.p99,
      },
      // New fields
      context: "Stroops are the smallest unit of XLM; 1 XLM = 10,000,000 stroops.",
      networkCongestion: (function () {
        const usage = feeStats.ledger_capacity_usage;
        if (usage < 0.5) return "low";
        if (usage < 0.75) return "medium";
        return "high";
      })(),
      recommendation: (function () {
        const usage = feeStats.ledger_capacity_usage;
        if (usage < 0.5) return "Economy tier is sufficient – network is not congested.";
        if (usage < 0.75) return "Standard tier is recommended for moderate congestion.";
        return "Priority tier is recommended – network is highly congested.";
      })(),
    };

    // Cache the response
    feeEstimateCache.set(cacheKey, data);

    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
