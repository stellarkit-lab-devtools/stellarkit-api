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

/**
 * GET /fee-estimate/surge-status
 * Identifies whether the network is currently in a fee surge period
 * by analyzing recent ledger capacity usage.
 *
 * Returns actionable advice on when to submit transactions.
 *
 * @example
 * GET /fee-estimate/surge-status
 */
router.get("/surge-status", async (req, res, next) => {
  try {
    const cacheKey = "fee-surge-status";
    const fresh = req.query.fresh === "true";

    // Check cache first (unless fresh=true)
    if (!fresh) {
      const cached = feeEstimateCache.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    // Fetch the last 10 ledgers
    const ledgers = await server.ledgers().order("desc").limit(10).call();
    const records = ledgers.records || [];

    if (records.length === 0) {
      const err = new Error("Unable to fetch recent ledger data.");
      err.status = 503;
      throw err;
    }

    // Extract capacity usage from each ledger
    const capacityUsages = records.map((ledger) => {
      // Stellar doesn't directly return capacity usage per ledger
      // We calculate it as: successful_transactions / max_tx_set_size
      // Default max_tx_set_size is 1000
      const maxTxSetSize = 1000;
      const txCount = ledger.successful_transaction_count || 0;
      return Math.min(txCount / maxTxSetSize, 1.0);
    });

    // Calculate average capacity usage
    const avgCapacityUsage =
      capacityUsages.reduce((a, b) => a + b, 0) / capacityUsages.length;

    // Fetch current fee stats for suggested fee
    const feeStats = await server.feeStats();
    const surgeThreshold = 0.5;
    const isSurging = avgCapacityUsage > surgeThreshold;

    // Select suggested fee based on surge status
    let suggestedFee;
    let recommendation;

    if (isSurging) {
      // High congestion: recommend priority fee
      suggestedFee = parseInt(feeStats.fee_charged.p95);
      recommendation =
        "Network is experiencing a fee surge. Consider using the priority fee tier to ensure timely transaction inclusion. If your transaction is not time-sensitive, consider waiting for congestion to subside.";
    } else if (avgCapacityUsage > 0.25) {
      // Moderate congestion: recommend standard fee
      suggestedFee = parseInt(feeStats.fee_charged.p50);
      recommendation =
        "Network has moderate congestion. The standard fee tier should provide reliable transaction inclusion within a few seconds.";
    } else {
      // Low congestion: economy fee is fine
      suggestedFee = parseInt(feeStats.fee_charged.min);
      recommendation =
        "Network is operating normally with low congestion. The economy fee tier is sufficient for transaction inclusion.";
    }

    const data = {
      isSurging,
      avgCapacityUsage: parseFloat(avgCapacityUsage.toFixed(4)),
      surgeThreshold,
      ledgersAnalyzed: records.length,
      capacityUsageDetails: capacityUsages.map((usage) =>
        parseFloat(usage.toFixed(4))
      ),
      suggestedFee,
      suggestedFeeInXLM: (suggestedFee / 1e7).toFixed(7),
      recommendation,
      currentNetworkStats: {
        lastLedgerBaseFee: feeStats.last_ledger_base_fee,
        ledgerCapacityUsage: feeStats.ledger_capacity_usage,
        minFee: feeStats.fee_charged.min,
        p50Fee: feeStats.fee_charged.p50,
        p95Fee: feeStats.fee_charged.p95,
      },
    };

    // Cache the response (surge status can be cached briefly since it's analyzed data)
    feeEstimateCache.set(cacheKey, data);

    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /fee-estimate/trends
 * Analyzes fee trends across the last 50 ledgers and returns a statistical
 * summary to help developers make smarter fee decisions.
 *
 * Returns { avgBaseFee, minBaseFee, maxBaseFee, avgCapacityUsage, trend, recommendation }
 * trend is "rising", "falling", or "stable" based on first 25 vs last 25 ledger base fees.
 *
 * @example
 * GET /fee-estimate/trends
 */
router.get("/trends", async (req, res, next) => {
  try {
    const ledgersResponse = await server.ledgers().order("desc").limit(50).call();
    const records = ledgersResponse.records || [];

    if (records.length === 0) {
      const err = new Error("Unable to fetch recent ledger data.");
      err.status = 503;
      throw err;
    }

    const fees = records.map((l) => parseInt(l.base_fee_in_stroops || l.base_fee, 10) || 100);
    const capacities = records.map((l) => {
      const maxTxSetSize = 1000;
      return Math.min((l.successful_transaction_count || 0) / maxTxSetSize, 1.0);
    });

    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

    const avgBaseFee = avg(fees);
    const minBaseFee = Math.min(...fees);
    const maxBaseFee = Math.max(...fees);
    const avgCapacityUsage = avg(capacities);

    // records are desc (newest first); split into first-half (newest) and second-half (oldest)
    const half = Math.floor(records.length / 2);
    const recentAvg = avg(fees.slice(0, half));
    const olderAvg  = avg(fees.slice(half));

    let trend;
    const delta = recentAvg - olderAvg;
    if (delta > 5)       trend = "rising";
    else if (delta < -5) trend = "falling";
    else                 trend = "stable";

    let recommendation;
    if (trend === "rising") {
      recommendation = "Fees are rising. Use the standard or priority tier to ensure timely inclusion.";
    } else if (trend === "falling") {
      recommendation = "Fees are falling. Economy tier may be sufficient for non-urgent transactions.";
    } else {
      recommendation = "Fees are stable. Standard tier is a safe choice for most transactions.";
    }

    return success(res, {
      ledgersAnalyzed: records.length,
      avgBaseFee: Math.round(avgBaseFee),
      minBaseFee,
      maxBaseFee,
      avgCapacityUsage: parseFloat(avgCapacityUsage.toFixed(4)),
      trend,
      recommendation,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
