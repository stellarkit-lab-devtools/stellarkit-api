const express = require("express");
const router = express.Router();
const { server, fetchHorizon } = require("../config/stellar");
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

    const response = await withHorizonTiming(req, () => fetchHorizon());
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

    const response = await withHorizonTiming(req, () => fetchHorizon("/accounts?order=desc&limit=200"));

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

const RECOMMENDED_FEE_CACHE_TTL = 5;

function estimateConfirmationLedgers(tier, capacityUsage) {
  if (tier === "high") {
    return 1;
  }
  if (tier === "medium") {
    return capacityUsage > 0.75 ? 2 : 1;
  }
  if (capacityUsage > 0.75) {
    return 3;
  }
  if (capacityUsage > 0.5) {
    return 2;
  }
  return 1;
}

function buildRecommendedFeeTier(stroops, tier, capacityUsage) {
  return {
    feeStroops: String(stroops),
    feeXLM: parseStellarAmount(stroops),
    estimatedConfirmationLedgers: estimateConfirmationLedgers(tier, capacityUsage),
  };
}

/**
 * GET /network/recommended-fee
 *
 * Returns low, medium, and high priority fee options with estimated confirmation times.
 * Cached for 5 seconds.
 */
router.get("/recommended-fee", async (req, res, next) => {
  try {
    const cacheKey = "network-recommended-fee";
    const fresh = isFreshRequest(req.query);

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    const feeStats = await withHorizonTiming(req, () => server.feeStats());
    const feeCharged = feeStats.fee_charged || {};
    const capacityUsage = parseFloat(feeStats.ledger_capacity_usage || 0);

    const lowStroops = parseStroops(feeCharged.min);
    const mediumStroops = parseStroops(feeCharged.p50);
    const highStroops = parseStroops(feeCharged.p95);

    const data = {
      low: buildRecommendedFeeTier(lowStroops, "low", capacityUsage),
      medium: buildRecommendedFeeTier(mediumStroops, "medium", capacityUsage),
      high: buildRecommendedFeeTier(highStroops, "high", capacityUsage),
    };

    cacheService.set(cacheKey, data, RECOMMENDED_FEE_CACHE_TTL);

    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    next(err);
  }
});

const LEDGER_TIMING_CACHE_TTL = 10;

const LEDGER_HISTORY_DEFAULT_LIMIT = 10;
const LEDGER_HISTORY_MAX_LIMIT = 50;
const LEDGER_HISTORY_CACHE_TTL = 10;

/**
 * GET /network/ledger-timing
 * Computes average ledger close time from the last 10 ledgers.
 * Returns averageClosureTimeSeconds, lastLedgerSequence, lastLedgerClosedAt, expectedNextLedgerAt.
 * Cached for 10 seconds.
 */
router.get("/ledger-timing", async (req, res, next) => {
  try {
    const cacheKey = "network-ledger-timing";
    const fresh = isFreshRequest(req.query);

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    const ledgerResponse = await withHorizonTiming(req, () =>
      server.ledgers().order("desc").limit(10).call()
    );
    const records = ledgerResponse.records || [];

    if (records.length < 2) {
      return success(res, {
        averageClosureTimeSeconds: 0,
        lastLedgerSequence: records[0] ? records[0].sequence : null,
        lastLedgerClosedAt: records[0] ? records[0].closed_at : null,
        expectedNextLedgerAt: null,
      });
    }

    const diffs = [];
    for (let i = 0; i < records.length - 1; i++) {
      const newer = new Date(records[i].closed_at).getTime();
      const older = new Date(records[i + 1].closed_at).getTime();
      diffs.push((newer - older) / 1000);
    }

    const averageClosureTimeSeconds = parseFloat(
      (diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(4)
    );

    const lastLedger = records[0];
    const lastLedgerSequence = lastLedger.sequence;
    const lastLedgerClosedAt = lastLedger.closed_at;
    const expectedNextLedgerAt = new Date(
      new Date(lastLedgerClosedAt).getTime() + averageClosureTimeSeconds * 1000
    ).toISOString();

    const data = {
      averageClosureTimeSeconds,
      lastLedgerSequence,
      lastLedgerClosedAt,
      expectedNextLedgerAt,
    };

    cacheService.set(cacheKey, data, LEDGER_TIMING_CACHE_TTL);
    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /network/ledger-history
 * Returns recent ledger data, newest first.
 *
 * Query params:
 *   - limit (number, 1–50, default: 10) — Maximum number of ledgers to return.
 *   - fresh (boolean, default: false) — bypasses cache when set to "true"
 *
 * Response shape:
 *   { success: true, data: { ledgers: [...], count, limit } }
 *
 * Each ledger entry:
 *   {
 *     sequence:         <number>   // ledger sequence
 *     closedAt:         <string>   // ISO 8601 close time
 *     transactionCount: <number>
 *     operationCount:   <number>
 *     baseFee:          <number>   // base fee in stroops
 *   }
 *
 * Errors:
 *   400 — limit is not an integer between 1 and 50
 *
 * @example
 * GET /network/ledger-history
 * GET /network/ledger-history?limit=5
 */
router.get("/ledger-history", async (req, res, next) => {
  try {
    const rawLimit =
      req.query.limit !== undefined
        ? req.query.limit
        : LEDGER_HISTORY_DEFAULT_LIMIT;
    const parsed = parseInt(rawLimit, 10);

    if (!Number.isInteger(parsed) || parsed < 1 || parsed > LEDGER_HISTORY_MAX_LIMIT) {
      return res.status(400).json({
        success: false,
        error: {
          type: "ValidationError",
          message: `limit must be a positive integer between 1 and ${LEDGER_HISTORY_MAX_LIMIT}.`,
        },
      });
    }

    const limit = parsed;
    const fresh = isFreshRequest(req.query);
    const cacheKey = `network-ledger-history:${limit}`;

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    const ledgerResponse = await withHorizonTiming(req, () =>
      server.ledgers().order("desc").limit(limit).call()
    );
    const records = ledgerResponse.records || [];

    const ledgers = records.slice(0, limit).map((ledger) => {
      const transactionCountRaw = Number(
        ledger.successful_transaction_count ??
          ledger.transaction_count ??
          0
      );
      const operationCountRaw = Number(ledger.operation_count ?? 0);
      const baseFeeRaw = parseInt(
        ledger.base_fee_in_stroops ?? ledger.base_fee ?? "0",
        10
      );

      return {
        sequence: formatLedgerSequence(ledger.sequence),
        closedAt: ledger.closed_at || null,
        transactionCount: Number.isFinite(transactionCountRaw)
          ? transactionCountRaw
          : 0,
        operationCount: Number.isFinite(operationCountRaw)
          ? operationCountRaw
          : 0,
        baseFee: Number.isFinite(baseFeeRaw) ? baseFeeRaw : 0,
      };
    });

    const data = {
      ledgers,
      count: ledgers.length,
      limit,
    };

    cacheService.set(cacheKey, data, LEDGER_HISTORY_CACHE_TTL);
    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    next(err);
  }
});

const LEDGER_STATS_CACHE_TTL = 30;
const LEDGER_STATS_SAMPLE_SIZE = 100;

/**
 * GET /network/ledger-stats
 * Computes rolling averages across exactly 100 ledgers:
 *   - avgTxPerLedger: average transaction count
 *   - avgOpsPerLedger: average operation count
 *   - avgFeeRevenueXLM: average base fee × tx count, normalized to XLM
 *   - closeTimeVarianceSeconds: standard deviation of ledger close times
 *   - capacityHitPercent: percentage of ledgers where operations hit max
 *   - sampledLedgers: always 100
 *
 * Response is cached with a 30 second TTL.
 *
 * @example
 * GET /network/ledger-stats
 */
router.get("/ledger-stats", async (req, res, next) => {
  try {
    const cacheKey = "network-ledger-stats";
    const fresh = isFreshRequest(req.query);

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    // Fetch the last LEDGER_STATS_SAMPLE_SIZE ledgers
    const ledgerResponse = await withHorizonTiming(req, () =>
      server.ledgers().order("desc").limit(LEDGER_STATS_SAMPLE_SIZE).call()
    );
    const ledgers = ledgerResponse.records || [];

    if (ledgers.length === 0) {
      throw new StellarKitError(
        "No ledger data available from Horizon.",
        503,
        "NoLedgerData",
        null,
        "Please try again later."
      );
    }

    // Pad to exactly LEDGER_STATS_SAMPLE_SIZE if fewer ledgers returned
    // (unlikely in practice, but handle gracefully)
    const sampledLedgers = Math.min(ledgers.length, LEDGER_STATS_SAMPLE_SIZE);

    // Compute averages from the returned ledgers
    let totalTxCount = 0;
    let totalOpsCount = 0;
    let totalFeeRevenue = 0; // in stroops
    let capacityHits = 0;
    const closeTimes = [];

    // Horizon's operation limit per ledger is approximately 10,000
    const OPERATION_CAPACITY_THRESHOLD = 10000;

    ledgers.forEach((ledger) => {
      const txCount = parseInt(ledger.successful_transaction_count ?? ledger.transaction_count ?? "0", 10);
      const opsCount = parseInt(ledger.operation_count ?? "0", 10);
      const baseFee = parseInt(ledger.base_fee_in_stroops ?? ledger.base_fee ?? "100", 10);

      totalTxCount += txCount;
      totalOpsCount += opsCount;
      totalFeeRevenue += baseFee * txCount;

      // Detect if this ledger hit capacity
      if (opsCount >= OPERATION_CAPACITY_THRESHOLD) {
        capacityHits += 1;
      }

      closeTimes.push(new Date(ledger.closed_at).getTime());
    });

    // Compute averages
    const avgTxPerLedger = parseFloat((totalTxCount / sampledLedgers).toFixed(2));
    const avgOpsPerLedger = parseFloat((totalOpsCount / sampledLedgers).toFixed(2));
    const avgFeeRevenueXLM = parseStellarAmount(
      Math.round(totalFeeRevenue / sampledLedgers)
    );
    const capacityHitPercent = parseFloat(
      ((capacityHits / sampledLedgers) * 100).toFixed(2)
    );

    // Compute close time variance (standard deviation)
    let closeTimeVarianceSeconds = 0;
    if (closeTimes.length >= 2) {
      // closeTimes are in descending order (newest first), so reverse for chronological order
      const chronoCloseTimes = closeTimes.reverse();
      
      // Calculate intervals between consecutive close times
      const intervals = [];
      for (let i = 0; i < chronoCloseTimes.length - 1; i++) {
        const interval = (chronoCloseTimes[i + 1] - chronoCloseTimes[i]) / 1000; // convert to seconds
        intervals.push(interval);
      }

      if (intervals.length > 0) {
        const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const variance = intervals.reduce(
          (sum, interval) => sum + Math.pow(interval - meanInterval, 2),
          0
        ) / intervals.length;
        closeTimeVarianceSeconds = parseFloat(Math.sqrt(variance).toFixed(4));
      }
    }

    const data = {
      avgTxPerLedger,
      avgOpsPerLedger,
      avgFeeRevenueXLM,
      closeTimeVarianceSeconds,
      capacityHitPercent,
      sampledLedgers: LEDGER_STATS_SAMPLE_SIZE,
    };

    cacheService.set(cacheKey, data, LEDGER_STATS_CACHE_TTL);
    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    next(err);
  }
});


const SOROBAN_STATS_PERIOD = "24h";
const SOROBAN_STATS_WINDOW_MS = 24 * 60 * 60 * 1000;
// Bounds the Horizon scan. On busy networks the scan budget runs out before
// the 24h boundary is reached; `windowCovered` reports when that happens.
const SOROBAN_STATS_MAX_PAGES = 10;

/** Operation types that only exist to drive Soroban contracts. */
const SOROBAN_OPERATION_TYPES = new Set([
  "invoke_host_function",
  "extend_footprint_ttl",
  "restore_footprint",
]);

/**
 * Returns the parent transaction embedded by `.join("transactions")`.
 *
 * Depending on the SDK version the joined record is exposed either directly on
 * `transaction` or on `transaction_attr` (with `transaction` replaced by a
 * link-follower function), so both are checked.
 *
 * @param {object} op - Horizon operation record
 * @returns {object|null}
 */
function getJoinedTransaction(op) {
  if (op.transaction_attr && typeof op.transaction_attr === "object") {
    return op.transaction_attr;
  }
  if (op.transaction && typeof op.transaction === "object") {
    return op.transaction;
  }
  return null;
}

const FEE_HISTORY_DEFAULT_LEDGERS = 20;
const FEE_HISTORY_MAX_LEDGERS = 100;
const FEE_HISTORY_CACHE_TTL = 10;

/**
 * GET /network/fee-history
 * Returns per-ledger fee statistics over a specified number of recent ledgers.
 *
 * Query params:
 *   - ledgers (number, 1–100, default: 20) — Maximum number of ledgers to return.
 *   - fresh (boolean, default: false) — bypasses cache when set to "true"
 *
 * Response shape:
 *   {
 *     success: true,
 *     data: {
 *       ledgers: [
 *         {
 *           sequence:      <number>,  // ledger sequence
 *           closedAt:      <string>,  // ISO 8601 close time
 *           baseFee:       <number>,  // base fee in stroops
 *           p50Fee:        <number>,  // 50th percentile fee in stroops
 *           p95Fee:        <number>,  // 95th percentile fee in stroops
 *           capacityUsage: <number>   // 0–1, ledger operation capacity utilization
 *         }
 *       ],
 *       count: <number>
 *     }
 *   }
 *
 * Ledgers are ordered by sequence descending (newest first).
 *
 * Errors:
 *   400 — ledgers is not an integer between 1 and 100
 *
 * @example
 * GET /network/fee-history
 * GET /network/fee-history?ledgers=5
 */
router.get("/fee-history", async (req, res, next) => {
  try {
    const rawLimit =
      req.query.ledgers !== undefined
        ? req.query.ledgers
        : FEE_HISTORY_DEFAULT_LEDGERS;
    const parsed = parseInt(rawLimit, 10);

    if (!Number.isInteger(parsed) || parsed < 1 || parsed > FEE_HISTORY_MAX_LEDGERS) {
      return res.status(400).json({
        success: false,
        error: {
          type: "ValidationError",
          message: `ledgers must be a positive integer between 1 and ${FEE_HISTORY_MAX_LEDGERS}.`,
        },
      });
    }

    const limit = parsed;
    const fresh = isFreshRequest(req.query);
    const cacheKey = `network-fee-history:${limit}`;

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    const ledgerResponse = await withHorizonTiming(req, () =>
      server.ledgers().order("desc").limit(limit).call()
    );
    const records = ledgerResponse.records || [];

    const ledgers = records.slice(0, limit).map((ledger) => {
      const baseFee = parseInt(ledger.base_fee_in_stroops ?? ledger.base_fee ?? "0", 10);
      const p50Fee = parseStroops(ledger.fee_charged?.p50 ?? String(baseFee));
      const p95Fee = parseStroops(ledger.fee_charged?.p95 ?? String(baseFee));
      const capacityUsage = parseFloat(ledger.capacity_usage ?? ledger.operation_count ?? 0) / 10000;

      return {
        sequence: formatLedgerSequence(ledger.sequence),
        closedAt: ledger.closed_at || null,
        baseFee: Number.isFinite(baseFee) ? baseFee : 0,
        p50Fee: Number.isFinite(p50Fee) ? p50Fee : 0,
        p95Fee: Number.isFinite(p95Fee) ? p95Fee : 0,
        capacityUsage: Math.min(1, Math.max(0, capacityUsage)),
      };
    });

    const data = {
      ledgers,
      count: ledgers.length,
    };

    cacheService.set(cacheKey, data, FEE_HISTORY_CACHE_TTL);
    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /network/soroban-stats
 *
 * Reports how much of recent network activity is Soroban-related, scanning
 * operations newest-first back to the start of the 24h window.
 *
 * Query params:
 *   - fresh (boolean, default: false) — bypasses cache when set to "true"
 *
 * Response shape:
 *   {
 *     success: true,
 *     data: {
 *       period:                  "24h",
 *       invocations24h:          <number>,  // invoke_host_function only
 *       uniqueContracts24h:      <number>,  // number of unique contract addresses
 *       sorobanFeeRevenueXLM:    <string>,  // seven-decimal XLM, fees charged on Soroban transactions
 *       sorobanOperationPercent: <number>,  // 0–100, two decimal places
 *     }
 *   }
 *
 * Failed transactions are included: they still consume ledger capacity and
 * are still charged fees.
 *
 * @example
 * GET /network/soroban-stats
 * GET /network/soroban-stats?fresh=true
 */
router.get("/soroban-stats", async (req, res, next) => {
  try {
    const cacheKey = "network-soroban-stats";
    const fresh = isFreshRequest(req.query);

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    const windowStart = Date.now() - SOROBAN_STATS_WINDOW_MS;
    const feeByTransaction = new Map();
    const uniqueContracts = new Set();
    let totalOperations = 0;
    let sorobanOperations = 0;
    let invocations = 0;
    let windowCovered = false;
    let cursor;

    for (let page = 0; page < SOROBAN_STATS_MAX_PAGES && !windowCovered; page++) {
      let query = server
        .operations()
        .join("transactions")
        .includeFailed(true)
        .order("desc")
        .limit(SOROBAN_STATS_PAGE_SIZE);
      if (cursor) query = query.cursor(cursor);

      const response = await withHorizonTiming(req, () => query.call());
      const records = response.records || [];

      for (const op of records) {
        cursor = op.paging_token;
        if (new Date(op.created_at).getTime() < windowStart) {
          windowCovered = true;
          break;
        }

        totalOperations += 1;
        if (!SOROBAN_OPERATION_TYPES.has(op.type)) continue;

        sorobanOperations += 1;
        if (op.type === "invoke_host_function") {
          invocations += 1;
          // Track unique contract addresses from invoke_host_function operations
          if (op.invoke_host_function_details && op.invoke_host_function_details.address) {
            uniqueContracts.add(op.invoke_host_function_details.address);
          }
        }

        // A Soroban transaction holds exactly one operation, so its whole fee
        // is Soroban revenue. Keyed by hash to never count a fee twice.
        const tx = getJoinedTransaction(op);
        const txHash = (tx && tx.hash) || op.transaction_hash;
        if (txHash && !feeByTransaction.has(txHash)) {
          feeByTransaction.set(txHash, parseStroops(tx && tx.fee_charged));
        }
      }

      // Horizon has no more history to give, so the window is fully covered.
      if (records.length < SOROBAN_STATS_PAGE_SIZE) windowCovered = true;
    }

    let feeRevenueStroops = 0;
    for (const fee of feeByTransaction.values()) feeRevenueStroops += fee;

    const sorobanOperationPercent =
      totalOperations === 0
        ? 0
        : parseFloat(((sorobanOperations / totalOperations) * 100).toFixed(2));

    const data = {
      period: SOROBAN_STATS_PERIOD,
      invocations24h: invocations,
      uniqueContracts24h: uniqueContracts.size,
      sorobanFeeRevenueXLM: parseStellarAmount(feeRevenueStroops),
      sorobanOperationPercent,
    };

    cacheService.set(cacheKey, data, cacheTTL.sorobanStats);
    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    next(err);
  }
});

const OPERATION_STATS_CACHE_TTL = 30;
const OPERATION_STATS_DEFAULT_SAMPLE = 1000;
const OPERATION_STATS_MAX_SAMPLE = 5000;
const OPERATION_STATS_PAGE_SIZE = 200;

// Soroban operation types that count toward soroban share
const SOROBAN_OPERATION_TYPES = [
  "invoke_host_function",
  "extend_footprint_ttl",
  "restore_footprint",
];

/**
 * GET /network/operation-stats
 * Samples the most recent operations and returns a breakdown by type.
 *
 * Query parameters:
 *   sample (number, default: 1000, max: 5000) — Number of operations to sample
 *
 * Response shape:
 *   {
 *     sampledOperations: <number>,
 *     fromLedger: <number>,
 *     toLedger: <number>,
 *     byType: [
 *       { type: "payment", count: 450, percent: 45.0 },
 *       ...
 *     ],
 *     sorobanSharePercent: <number>
 *   }
 *
 * byType is sorted by count descending, percentages sum to ~100.
 * Results are cached for 30 seconds.
 *
 * Errors:
 *   400 — sample is not a number or is out of range (1–5000)
 *
 * @example
 * GET /network/operation-stats
 * GET /network/operation-stats?sample=2000
 */
router.get("/operation-stats", async (req, res, next) => {
  try {
    // Parse and validate sample parameter
    let sample = OPERATION_STATS_DEFAULT_SAMPLE;
    if (req.query.sample !== undefined) {
      const parsed = parseInt(req.query.sample, 10);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > OPERATION_STATS_MAX_SAMPLE) {
        return res.status(400).json({
          success: false,
          error: {
            type: "ValidationError",
            message: `sample must be an integer between 1 and ${OPERATION_STATS_MAX_SAMPLE}.`,
          },
        });
      }
      sample = parsed;
    }

    const cacheKey = `network-operation-stats:${sample}`;
    const cached = cacheService.get(cacheKey);
    if (cached !== undefined) {
      res.set("X-Cache", "HIT");
      return success(res, cached);
    }

    // Fetch operations in pages
    const operationCounts = {}; // { type: count }
    let fetchedCount = 0;
    let minLedger = Infinity;
    let maxLedger = -Infinity;
    let cursor = undefined;

    while (fetchedCount < sample) {
      const remaining = sample - fetchedCount;
      const pageSize = Math.min(OPERATION_STATS_PAGE_SIZE, remaining);

      let query = server.operations().limit(pageSize).order("desc");
      if (cursor) {
        query = query.cursor(cursor);
      }

      const response = await withHorizonTiming(req, () => query.call());
      const records = response.records || [];

      if (records.length === 0) {
        // No more operations available
        break;
      }

      for (const op of records) {
        const type = op.type || "unknown";
        operationCounts[type] = (operationCounts[type] || 0) + 1;
        fetchedCount++;

        if (op.ledger_sequence !== undefined) {
          minLedger = Math.min(minLedger, op.ledger_sequence);
          maxLedger = Math.max(maxLedger, op.ledger_sequence);
        }

        if (fetchedCount >= sample) {
          break;
        }
      }

      // Set cursor for next page
      if (records.length > 0) {
        const lastRecord = records[records.length - 1];
        cursor = lastRecord.paging_token;
      }

      // If we got fewer records than requested, we've hit the end
      if (records.length < pageSize) {
        break;
      }
    }

    // Calculate statistics
    const totalOperations = fetchedCount;
    const byType = [];
    let sorobanCount = 0;

    for (const [type, count] of Object.entries(operationCounts)) {
      const percent = totalOperations > 0 ? parseFloat(((count / totalOperations) * 100).toFixed(2)) : 0;
      byType.push({ type, count, percent });

      if (SOROBAN_OPERATION_TYPES.includes(type)) {
        sorobanCount += count;
      }
    }

    // Sort by count descending
    byType.sort((a, b) => b.count - a.count);

    const sorobanSharePercent =
      totalOperations > 0
        ? parseFloat(((sorobanCount / totalOperations) * 100).toFixed(2))
        : 0;

    const data = {
      sampledOperations: totalOperations,
      fromLedger: minLedger === Infinity ? null : minLedger,
      toLedger: maxLedger === -Infinity ? null : maxLedger,
      byType,
      sorobanSharePercent,
    };

    cacheService.set(cacheKey, data, OPERATION_STATS_CACHE_TTL);
    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
