const express = require("express");
const router = express.Router();
const { server, horizonUrl, NETWORK } = require("../config/stellar");
const { success } = require("../utils/response");
const { networkStatusCache } = require("../utils/cache");

/**
 * GET /network-status
 * Returns current Stellar network info: latest ledger, base fee, network passphrase.
 *
 * @example
 * GET /network-status
 */
router.get("/", async (req, res, next) => {
  try {
    const cacheKey = "network-status";
    const fresh = req.query.fresh === "true";

    // Check cache first (unless fresh=true)
    if (!fresh) {
      const cached = networkStatusCache.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    // Cache miss or fresh=true - fetch from Horizon
    const ledger = await server.ledgers().order("desc").limit(1).call();
    const latest = ledger.records[0];

    const data = {
      network: NETWORK,
      horizonUrl,
      latestLedger: {
        sequence: latest.sequence,
        closedAt: latest.closed_at,
        transactionCount: latest.successful_transaction_count,
        operationCount: latest.operation_count,
        totalCoins: latest.total_coins,
        feePool: latest.fee_pool,
      },
      fees: {
        baseFeeInStroops: latest.base_fee_in_stroops,
        baseFeeInXLM: (latest.base_fee_in_stroops / 1e7).toFixed(7),
        basereserveInStroops: latest.base_reserve_in_stroops,
        baseReserveInXLM: (latest.base_reserve_in_stroops / 1e7).toFixed(7),
      },
      protocol: {
        version: latest.protocol_version,
      },
    };

    // Cache the response
    networkStatusCache.set(cacheKey, data);

    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /network/ledger-timing
 * Analyzes the last 50 ledger close times and returns statistics about network block time consistency.
 */
router.get("/ledger-timing", async (req, res, next) => {
  try {
    const ledgers = await server.ledgers().limit(50).order("desc").call();
    const records = ledgers.records;

    if (records.length < 2) {
      return success(res, {
        avgCloseTimeSeconds: 0,
        minCloseTime: 0,
        maxCloseTime: 0,
        stdDeviation: 0,
        consistency: "stable",
      });
    }

    const intervals = [];
    for (let i = 0; i < records.length - 1; i++) {
      const current = new Date(records[i].closed_at).getTime();
      const nextL = new Date(records[i + 1].closed_at).getTime();
      intervals.push(Math.abs(current - nextL) / 1000);
    }

    const sum = intervals.reduce((a, b) => a + b, 0);
    const avg = sum / intervals.length;
    const min = Math.min(...intervals);
    const max = Math.max(...intervals);

    const squareDiffs = intervals.map((v) => Math.pow(v - avg, 2));
    const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / squareDiffs.length;
    const stdDev = Math.sqrt(avgSquareDiff);

    let consistency = "stable";
    if (stdDev > 1.5) {
      consistency = "unstable";
    } else if (stdDev > 0.5) {
      consistency = "variable";
    }

    return success(res, {
      avgCloseTimeSeconds: parseFloat(avg.toFixed(2)),
      minCloseTime: parseFloat(min.toFixed(2)),
      maxCloseTime: parseFloat(max.toFixed(2)),
      stdDeviation: parseFloat(stdDev.toFixed(2)),
      consistency,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

