const express = require("express");
const router = express.Router();
const { server } = require("../config/stellar");
const { success } = require("../utils/response");
const cacheService = require("../services/cache");

const STROOPS_PER_XLM = 10_000_000;

const DEFAULT_CACHE_TTL_SECONDS = 5;
const CACHE_TTL =
  parseInt(process.env.CACHE_TTL_MS, 10) / 1000 || DEFAULT_CACHE_TTL_SECONDS;

const LEDGER_HISTORY_LIMIT = 5;
const STROOP_DECIMALS = 7;

const CAPACITY_USAGE_MAX = 1.0;
const DEFAULT_MAX_TX_SET_SIZE = 1000;

const CONGESTION_THRESHOLD_LOW = 0.5;
const CONGESTION_THRESHOLD_MEDIUM = 0.75;
const CONGESTION_THRESHOLD_MODERATE = 0.25;


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
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    // Cache miss or fresh=true - fetch from Horizon
    const feeStats = await server.feeStats();
    const ledgerHistory = await server
      .ledgers()
      .order("desc")
      .limit(LEDGER_HISTORY_LIMIT)
      .call();

    const ledgerHistoryRecords = ledgerHistory.records || [];

    const recommended = parseInt(feeStats.fee_charged.p50);
    const priority = parseInt(feeStats.fee_charged.p95);


    const data = {
      note: `Fee estimates for a transaction with ${operations} operation(s). Fees are in stroops (1 XLM = 10,000,000 stroops).`,
      operationCount: operations,
      perOperation: {
        economy: {
          stroops: parseInt(feeStats.fee_charged.min),
          xlm: (parseInt(feeStats.fee_charged.min) / STROOPS_PER_XLM).toFixed(STROOP_DECIMALS),

          description: "Minimum — may be slow during congestion",
        },
        standard: {
          stroops: recommended,
          xlm: (recommended / STROOPS_PER_XLM).toFixed(STROOP_DECIMALS),

          description: "Recommended for most transactions",
        },
        priority: {
          stroops: priority,
          xlm: (priority / STROOPS_PER_XLM).toFixed(STROOP_DECIMALS),

          description: "Fast inclusion even during high network load",
        },
      },
      totalFee: {
        economy: {
          stroops: parseInt(feeStats.fee_charged.min) * operations,
          xlm: (
            (parseInt(feeStats.fee_charged.min) * operations) / STROOPS_PER_XLM
          ).toFixed(STROOP_DECIMALS),

        },
        standard: {
          stroops: recommended * operations,
          xlm: (
            (recommended * operations) / STROOPS_PER_XLM
          ).toFixed(STROOP_DECIMALS),

        },
        priority: {
          stroops: priority * operations,
          xlm: (
            (priority * operations) / STROOPS_PER_XLM
          ).toFixed(STROOP_DECIMALS),

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
      history: ledgerHistoryRecords.map((ledger) => ({
        ledger: parseInt(ledger.sequence, 10),
        baseFee: parseInt(ledger.base_fee_in_stroops || ledger.base_fee, 10) || 0,
        capacityUsage: parseFloat(
          Math.min(
            (ledger.successful_transaction_count || 0) / DEFAULT_MAX_TX_SET_SIZE,
            CAPACITY_USAGE_MAX
          ).toFixed(4)

        ),
      })),
      // New fields
      context: "Stroops are the smallest unit of XLM; 1 XLM = 10,000,000 stroops.",
      networkCongestion: (function () {
        const usage = feeStats.ledger_capacity_usage;
        if (usage < CONGESTION_THRESHOLD_LOW) return "low";
        if (usage < CONGESTION_THRESHOLD_MEDIUM) return "medium";

        return "high";
      })(),
      recommendation: (function () {
        const usage = feeStats.ledger_capacity_usage;
        if (usage < CONGESTION_THRESHOLD_LOW)
          return "Economy tier is sufficient – network is not congested.";
        if (usage < CONGESTION_THRESHOLD_MEDIUM)
          return "Standard tier is recommended for moderate congestion.";

        return "Priority tier is recommended – network is highly congested.";
      })(),
    };

    // Cache the response
    cacheService.set(cacheKey, data, CACHE_TTL);

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
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    // Fetch the last 10 ledgers
    const ledgers = await server
      .ledgers()
      .order("desc")
      .limit(SURGE_STATUS_LEDGER_LIMIT)
      .call();

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
      const txCount = ledger.successful_transaction_count || 0;
      return Math.min(
        txCount / DEFAULT_MAX_TX_SET_SIZE,
        CAPACITY_USAGE_MAX
      );

    });

    // Calculate average capacity usage
    const avgCapacityUsage =
      capacityUsages.reduce((a, b) => a + b, 0) / capacityUsages.length;

    // Fetch current fee stats for suggested fee
    const feeStats = await server.feeStats();
    const surgeThreshold = CONGESTION_THRESHOLD_LOW;

    const isSurging = avgCapacityUsage > surgeThreshold;

    // Select suggested fee based on surge status
    let suggestedFee;
    let recommendation;

    if (isSurging) {
      // High congestion: recommend priority fee
      suggestedFee = parseInt(feeStats.fee_charged.p95);
      recommendation =
        "Network is experiencing a fee surge. Consider using the priority fee tier to ensure timely transaction inclusion. If your transaction is not time-sensitive, consider waiting for congestion to subside.";
    } else if (avgCapacityUsage > CONGESTION_THRESHOLD_MODERATE) {

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
      suggestedFeeInXLM: (suggestedFee / STROOPS_PER_XLM).toFixed(STROOP_DECIMALS),

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
    cacheService.set(cacheKey, data, CACHE_TTL);

    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
