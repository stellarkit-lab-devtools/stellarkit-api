const express = require("express");
const router = express.Router();
const { server, horizonUrl, NETWORK } = require("../config/stellar");
const { success, toISOTimestamp } = require("../utils/response");
const cacheService = require("../services/cache");

const CACHE_TTL = 5; // seconds

/**
 * GET /network-status
 * Returns current Stellar network info: latest ledger, base fee, network passphrase.
 *
 * Query params:
 *   - fresh (boolean, default: false) — bypasses cache when set to "true"
 *
 * @example
 * GET /network-status
 * GET /network-status?fresh=true
 */
router.get("/", async (req, res, next) => {
  try {
    const cacheKey = "network-status";
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
    const ledger = await server.ledgers().order("desc").limit(1).call();
    const latest = ledger.records[0];

    const data = {
      network: NETWORK,
      horizonUrl,
      latestLedger: {
        sequence: latest.sequence,
        closedAt: toISOTimestamp(latest.closed_at),
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

    // Cache the response with 5s TTL
    cacheService.set(cacheKey, data, 5);

    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
