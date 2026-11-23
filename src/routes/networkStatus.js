const express = require("express");
const router = express.Router();
const { server, horizonUrl, NETWORK } = require("../config/stellar");
const { success, toISOTimestamp } = require("../utils/response");
const cacheService = require("../services/cache");

const CACHE_TTL = 5; // seconds
const cacheTTL = require("../config/cacheConfig");
const LEDGER_CACHE_TTL = 60 * 60;

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

    // Cache the response
    cacheService.set(cacheKey, data, cacheTTL.networkStatus);

    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /network-status/:sequence
 * Returns a normalized, immutable ledger record by sequence.
 */
router.get("/:sequence", async (req, res, next) => {
  const { sequence: rawSequence } = req.params;
  if (!/^\d+$/.test(rawSequence) || !Number.isSafeInteger(Number(rawSequence)) || Number(rawSequence) <= 0) {
    return res.status(400).json({
      success: false,
      error: {
        type: "ValidationError",
        message: "Ledger sequence must be a positive integer.",
        field: "sequence",
        receivedValue: rawSequence,
        expectedFormat: "positive integer",
      },
    });
  }

  const sequence = Number(rawSequence);
  const cacheKey = `ledger:${sequence}`;
  const cached = cacheService.get(cacheKey);
  if (cached) {
    res.set("X-Cache", "HIT");
    return success(res, cached);
  }

  try {
    const ledgerResponse = await server.ledgers().ledger(sequence).call();
    const ledger = ledgerResponse.sequence ? ledgerResponse : ledgerResponse.records?.[0];
    if (!ledger) {
      return res.status(404).json({
        success: false,
        error: {
          type: "LedgerNotFound",
          message: `Ledger ${sequence} was not found.`,
        },
      });
    }

    const data = {
      sequence: Number(ledger.sequence),
      hash: ledger.hash,
      previousHash: ledger.prev_hash,
      closedAt: toISOTimestamp(ledger.closed_at),
      protocolVersion: Number(ledger.protocol_version),
      successfulTransactionCount: Number(ledger.successful_transaction_count),
      failedTransactionCount: Number(ledger.failed_transaction_count),
      operationCount: Number(ledger.operation_count),
      baseFeeStroops: Number(ledger.base_fee_in_stroops),
      baseReserveXLM: (Number(ledger.base_reserve_in_stroops) / 10_000_000).toFixed(7),
      maxTxSetSize: Number(ledger.max_tx_set_size),
    };

    cacheService.set(cacheKey, data, LEDGER_CACHE_TTL);
    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    if (err?.response?.status === 404) {
      return res.status(404).json({
        success: false,
        error: {
          type: "LedgerNotFound",
          message: `Ledger ${sequence} was not found.`,
        },
      });
    }
    return next(err);
  }
});

/**
 * GET /ledger-timing
 * Analyzes network ledger close time consistency.
 */
router.get("/ledger-timing", async (req, res, next) => {
  try {
    const ledgers = await server.ledgers().order("desc").limit(10).call();
    const records = ledgers.records || [];

    if (records.length < 2) {
      return success(res, {
        avgCloseTimeSeconds: 0,
        minCloseTime: 0,
        maxCloseTime: 0,
        stdDeviation: 0,
        consistency: "unstable",
      });
    }

    const diffs = [];
    for (let i = 0; i < records.length - 1; i++) {
      const timeNewer = new Date(records[i].closed_at).getTime();
      const timeOlder = new Date(records[i + 1].closed_at).getTime();
      diffs.push((timeNewer - timeOlder) / 1000);
    }

    const avgCloseTimeSeconds = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const minCloseTime = Math.min(...diffs);
    const maxCloseTime = Math.max(...diffs);

    const variance = diffs.reduce((a, b) => a + Math.pow(b - avgCloseTimeSeconds, 2), 0) / diffs.length;
    const stdDeviation = Math.sqrt(variance);

    let consistency = "unstable";
    if (stdDeviation <= 1.0) {
      consistency = "stable";
    } else if (stdDeviation <= 2.5) {
      consistency = "variable";
    }

    return success(res, {
      avgCloseTimeSeconds: parseFloat(avgCloseTimeSeconds.toFixed(4)),
      minCloseTime: parseFloat(minCloseTime.toFixed(4)),
      maxCloseTime: parseFloat(maxCloseTime.toFixed(4)),
      stdDeviation: parseFloat(stdDeviation.toFixed(4)),
      consistency,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
