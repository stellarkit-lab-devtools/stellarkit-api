const express = require("express");
const router = express.Router();
const { server, horizonUrl } = require("../config/stellar");
const { success } = require("../utils/response");
const cacheService = require("../services/cache");
const cacheTTL = require("../config/cacheConfig");

function isFreshRequest(query) {
  return query.fresh === true || query.fresh === "true";
}


/**
 * GET /network/validators
 * Returns the current validator list from Horizon, normalised and grouped by organisation.
 */
router.get("/validators", async (req, res, next) => {
  try {
    const cacheKey = "network-validators";
    const fresh = isFreshRequest(req.query);

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    const url = `${horizonUrl}/accounts?order=desc&limit=200`;
    const response = await fetch(url);

    if (!response.ok) {
      const horizonErr = new Error("Unable to fetch validator data from Horizon. Please try again.");
      horizonErr.status = 502;
      return next(horizonErr);
    }

    const body = await response.json();
    const accounts = body._embedded ? body._embedded.records : [];

    const validators = accounts
      .filter((account) => account.home_domain || account.signers?.length > 1)
      .slice(0, 100)
      .map((account) => ({
        publicKey: account.account_id,
        homeDomain: account.home_domain || null,
        isOrganization: !!account.home_domain,
        history: {
          lastModifiedLedger: account.last_modified_ledger,
          subentryCount: account.subentry_count,
        },
        currentStatus: account.flags
          ? account.flags.auth_required
            ? "restricted"
            : "active"
          : "active",
      }));

    const organisations = {};
    const ungrouped = [];
    validators.forEach((v) => {
      if (v.homeDomain) {
        if (!organisations[v.homeDomain]) {
          organisations[v.homeDomain] = [];
        }
        organisations[v.homeDomain].push(v);
      } else {
        ungrouped.push(v);
      }
    });

    const data = {
      validators,
      total: validators.length,
      byOrganisation: organisations,
      ungrouped,
    };

    cacheService.set(cacheKey, data, cacheTTL.validators);

    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND" || err.cause?.code === "ECONNREFUSED") {
      const horizonErr = new Error("Unable to fetch validator data from Horizon. Please try again.");
      horizonErr.status = 502;
      return next(horizonErr);
    }
    next(err);
  }
});

const BASE_FEE_CACHE_TTL = 5;

router.get("/base-fee", async (req, res, next) => {
  try {
    const cacheKey = "network-base-fee";
    const fresh = isFreshRequest(req.query);

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    const feeStats = await server.feeStats();
    const ledgerResponse = await server.ledgers().order("desc").limit(1).call();
    const latestLedger = (ledgerResponse.records || [])[0] || {};

    const baseFeeStroops = parseInt(feeStats.last_ledger_base_fee, 10);
    const baseFeeXLM = (baseFeeStroops / 1e7).toFixed(7);
    const isSurge =
      parseFloat(feeStats.ledger_capacity_usage) > 0.5 ||
      baseFeeStroops > parseInt(feeStats.fee_charged.min, 10);

    const data = {
      baseFeeStroops,
      baseFeeXLM,
      isSurge,
      ledgerSequence: latestLedger.sequence ? parseInt(latestLedger.sequence, 10) : null,
      ledgerClosedAt: latestLedger.closed_at || null,
      note: "Base fee is reported in stroops and normalized XLM units.",
    };

    cacheService.set(cacheKey, data, BASE_FEE_CACHE_TTL);

    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /network/fee-percentiles
 * Returns fee distribution percentiles from recent network activity.
 */
router.get("/fee-percentiles", async (req, res, next) => {
  try {
    const cacheKey = "network-fee-percentiles";
    const fresh = isFreshRequest(req.query);

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    const feeStats = await server.feeStats();

    const data = {
      p10: parseInt(feeStats.fee_charged.p10 || feeStats.fee_charged.min, 10),
      p50: parseInt(feeStats.fee_charged.p50 || feeStats.fee_charged.mode, 10),
      p90: parseInt(feeStats.fee_charged.p90 || feeStats.fee_charged.p95, 10),
      p95: parseInt(feeStats.fee_charged.p95, 10),
      p99: parseInt(feeStats.fee_charged.p99 || feeStats.fee_charged.max, 10),
      lastLedgerBaseFee: parseInt(feeStats.last_ledger_base_fee, 10),
      ledgerCapacityUsage: parseFloat(feeStats.ledger_capacity_usage),
    };

    cacheService.set(cacheKey, data, BASE_FEE_CACHE_TTL);

    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
