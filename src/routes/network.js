const express = require("express");
const router = express.Router();
const { server, horizonUrl } = require("../config/stellar");
const { success } = require("../utils/response");
const StellarKitError = require("../utils/StellarKitError");
const cacheService = require("../services/cache");
const cacheTTL = require("../config/cacheConfig");
const { formatLedgerSequence } = require("../utils/formatLedgerSequence");
const { startHorizonTimer, stopHorizonTimer } = require("../middleware/requestLogger");

/**
 * Wraps a Horizon-backed async call with timing so the request logger can
 * include horizonResponseTimeMs in the structured log entry.
 *
 * @template T
 * @param {import('express').Request} req
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withHorizonTiming(req, fn) {
  startHorizonTimer(req);
  try {
    return await fn();
  } finally {
    stopHorizonTimer(req);
  }
}

function isFreshRequest(query) {
  return query.fresh === true || query.fresh === "true";
}

const { parseStellarAmount } = require("../utils/parseStellarAmount");

const FEE_PERCENTILES_CACHE_TTL = 5;
const PERCENTILE_LEVELS = [10, 20, 30, 50, 70, 90, 95, 99];
const TX_FETCH_LIMIT = 100;
const PROTOCOL_VERSION_CACHE_TTL = 60;

/**
 * GET /network/protocol-version
 * Returns protocol and Horizon metadata for the configured network.
 */
router.get("/protocol-version", async (req, res, next) => {
  try {
    const cacheKey = "network-protocol-version";
    const cached = cacheService.get(cacheKey);

    if (cached !== undefined) {
      res.set("X-Cache", "HIT");
      return success(res, cached);
    }

    const response = await withHorizonTiming(req, () => fetch(horizonUrl));
    if (!response.ok) {
      throw new StellarKitError(
        "Unable to fetch network metadata from Stellar Horizon.",
        503,
        "HorizonUnavailable",
        null,
        "Verify the configured Horizon node is reachable and try again.",
      );
    }

    const metadata = await response.json();
    const data = {
      protocolVersion: metadata.current_protocol_version,
      networkPassphrase: metadata.network_passphrase,
      horizonVersion: metadata.horizon_version,
    };

    if (Object.values(data).some((value) => value === undefined || value === null)) {
      throw new StellarKitError(
        "Stellar Horizon returned incomplete network metadata.",
        502,
        "InvalidHorizonResponse",
      );
    }

    cacheService.set(cacheKey, data, PROTOCOL_VERSION_CACHE_TTL);

    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    next(err);
  }
});

function computePercentile(sortedValues, percentile) {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const index = (percentile / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  const weight = index - lower;
  return Math.round(
    sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight,
  );
}

function buildFeeObject(stroops) {
  return {
    stroops,
    xlm: parseStellarAmount(stroops),
  };
}

function parseStroops(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
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
    const response = await withHorizonTiming(req, () => fetch(url));

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

    const feeStats = await withHorizonTiming(req, () => server.feeStats());
    const ledgerResponse = await withHorizonTiming(req, () => server.ledgers().order("desc").limit(1).call());
    const latestLedger = (ledgerResponse.records || [])[0] || {};

    const baseFeeStroops = parseInt(feeStats.last_ledger_base_fee, 10);
    const baseFeeXLM = parseStellarAmount(baseFeeStroops);
    const isSurge =
      parseFloat(feeStats.ledger_capacity_usage) > 0.5 ||
      baseFeeStroops > parseInt(feeStats.fee_charged.min, 10);

    const data = {
      baseFeeStroops,
      baseFeeXLM,
      isSurge,
      ledgerSequence: formatLedgerSequence(latestLedger.sequence),
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
 * Returns fee distribution percentiles at multiple levels, the current
 * ledger's accepted fee range, and the latest ledger sequence.
 *
 * Query params:
 *   - fresh (boolean, default: false) — bypasses cache when set to "true"
 *
 * @example
 * GET /network/fee-percentiles
 * GET /network/fee-percentiles?fresh=true
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

    const feeStats = await withHorizonTiming(req, () => server.feeStats());
    const ledgerResponse = await withHorizonTiming(req, () => server.ledgers().order("desc").limit(1).call());
    const latestLedger = (ledgerResponse.records || [])[0] || {};

    const feeCharged = feeStats.fee_charged || {};
    const feeAccepted = feeStats.fee_accepted || feeCharged;

    const minFeeStroops = parseStroops(feeAccepted.min || feeCharged.min);
    const maxFeeStroops = parseStroops(feeAccepted.max || feeCharged.max);
    const baseFeeStroops = parseStroops(feeStats.last_ledger_base_fee);

    const txResponse = await withHorizonTiming(req, () =>
      server.transactions().order("desc").limit(TX_FETCH_LIMIT).call()
    );
    const txRecords = txResponse.records || [];
    const fees = txRecords
      .map((tx) => parseInt(tx.max_fee, 10))
      .filter((f) => f > 0);
    fees.sort((a, b) => a - b);

    const percentiles = {};
    for (const p of PERCENTILE_LEVELS) {
      const sourceValue = feeCharged[`p${p}`];
      if (sourceValue !== undefined && sourceValue !== null) {
        percentiles[`p${p}`] = buildFeeObject(parseStroops(sourceValue));
      } else {
        percentiles[`p${p}`] = buildFeeObject(computePercentile(fees, p));
      }
    }

    const data = {
      percentiles,
      baseFee: buildFeeObject(baseFeeStroops),
      minFee: buildFeeObject(minFeeStroops),
      maxFee: buildFeeObject(maxFeeStroops),
      ledgerSequence: formatLedgerSequence(latestLedger.sequence),
      timestamp: new Date().toISOTimestamp(),
    };

    cacheService.set(cacheKey, data, FEE_PERCENTILES_CACHE_TTL);

    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
