const express = require("express");
const router = express.Router();
const { server, horizonUrl, NETWORK } = require("../config/stellar");
const { success } = require("../utils/response");
const cacheService = require("../services/cache");
const cacheTTL = require("../config/cacheConfig");
const { fetchNetworkStatus } = require("../utils/mapNetworkStatus");

/**
 * GET /network-status
 * Returns live Horizon server info mapped to the StellarKit shape:
 * horizonVersion, coreVersion, networkPassphrase, currentLedger,
 * historyLatestLedger, isSynced, plus latest ledger / fee context.
 *
 * Query params:
 *   - fresh (boolean, default: false) — bypasses cache when set to "true"
 *
 * Cached for 10 seconds by default (CACHE_TTL_NETWORK_STATUS_MS).
 *
 * @example
 * GET /network-status
 * GET /network-status?fresh=true
 */
router.get("/", async (req, res, next) => {
  try {
    const cacheKey = "network-status";
    const fresh = req.query.fresh === true || req.query.fresh === "true";

    // Check cache first (unless fresh=true)
    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    const data = await fetchNetworkStatus(server, { network: NETWORK, horizonUrl });

    cacheService.set(cacheKey, data, cacheTTL.networkStatus);

    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    next(err);
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
