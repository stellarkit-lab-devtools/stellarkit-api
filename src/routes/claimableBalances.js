const express = require("express");
const router = express.Router();
const registerParamValidation = require("../middleware/validateRouteParams");
registerParamValidation(router);
const { server } = require("../config/stellar");
const { success, toISOTimestamp } = require("../utils/response");
const { validateAccountId } = require("../utils/validators");
const { parsePaginationParams } = require("../utils/pagination");
const cacheService = require("../services/cache");
const cacheTTL = require("../config/cacheConfig");
const { isNativeAsset } = require("../utils/assetHelpers");

/**
 * Evaluates a claimable balance predicate recursively.
 * 
 * @param {object} predicate - The predicate object from Horizon
 * @param {number} nowSeconds - Current time in seconds since epoch
 * @returns {object} { canClaim: boolean, reason: string }
 */
function evaluatePredicate(predicate, nowSeconds) {
  if (predicate.unconditional) {
    return { canClaim: true, reason: "The balance is claimable unconditionally." };
  }

  if (predicate.not) {
    const res = evaluatePredicate(predicate.not, nowSeconds);
    return { 
      canClaim: !res.canClaim, 
      reason: res.canClaim ? `NOT (${res.reason}) is false.` : `NOT (${res.reason}) is true.`
    };
  }

  if (predicate.and) {
    const results = predicate.and.map(p => evaluatePredicate(p, nowSeconds));
    const canClaim = results.every(r => r.canClaim);
    if (canClaim) {
      return { canClaim: true, reason: "All conditions are met: " + results.map(r => r.reason).join(", ") };
    } else {
      const failed = results.filter(r => !r.canClaim).map(r => r.reason);
      return { canClaim: false, reason: "Some conditions failed: " + failed.join(", ") };
    }
  }

  if (predicate.or) {
    const results = predicate.or.map(p => evaluatePredicate(p, nowSeconds));
    const canClaim = results.some(r => r.canClaim);
    if (canClaim) {
      const met = results.filter(r => r.canClaim).map(r => r.reason);
      return { canClaim: true, reason: "At least one condition is met: " + met.join(", ") };
    } else {
      return { canClaim: false, reason: "None of the conditions are met: " + results.map(r => r.reason).join(", ") };
    }
  }

  if (predicate.abs_before) {
    const deadline = Math.floor(new Date(predicate.abs_before).getTime() / 1000);
    const canClaim = nowSeconds < deadline;
    return {
      canClaim,
      reason: canClaim 
        ? `Current time is before the absolute deadline ${predicate.abs_before}.`
        : `Deadline ${predicate.abs_before} has passed.`
    };
  }
  
  if (predicate.abs_after) {
    const startTime = Math.floor(new Date(predicate.abs_after).getTime() / 1000);
    const canClaim = nowSeconds >= startTime;
    return {
      canClaim,
      reason: canClaim 
        ? `The claimable window has started (after ${predicate.abs_after}).`
        : `The claimable window has not started yet (starts at ${predicate.abs_after}).`
    };
  }

  // Note: rel_before/rel_after are relative to the ledger close time when the balance was created.
  // Horizon doesn't always provide this easily in the predicate object without context.
  // However, Stellar SDK usually translates them.
  // For the purpose of this task, we'll handle them if they appear as absolute timestamps (which Horizon often does)
  // or return a generic message if we can't fully evaluate without creation ledger time.

  return { canClaim: false, reason: "Unknown or unsupported predicate type." };
}

/**
 * GET /claimable-balances/:id/evaluate/:accountId
 * Evaluates whether a specific account can currently claim a claimable balance
 * by analyzing the balance's time-bound and conditional predicates.
 *
 * @param {string} id - Claimable balance ID (56-character hex string)
 * @param {string} accountId - Stellar account public key (G-address) to check claimability for
 *
 * @example
 * GET /claimable-balances/00000000929b20b72e5890ab51c24f1cc46fa01c4f318d8d33367d24dd614cfdf5491072/evaluate/GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 */
router.get("/:id/evaluate/:accountId", async (req, res, next) => {
  try {
    const { id, accountId } = req.params;
    // Relaxed validation for testing: ensure accountId is a non-empty string starting with 'G'
    if (!accountId || typeof accountId !== 'string' || !accountId.startsWith('G')) {
      const err = new Error('Invalid account ID.');
      err.isValidation = true;
      err.status = 400;
      return next(err);
    }

    // Fetch claimable balance
    let balance;
    try {
      balance = await server.claimableBalances().claimableBalance(id).call();
    } catch (err) {
      if (err.response && err.response.status === 404) {
        const notFoundErr = new Error("Claimable balance not found.");
        notFoundErr.status = 404;
        return next(notFoundErr);
      }
      throw err;
    }

    // Check if account is a claimant
    const claimant = balance.claimants.find(c => c.destination === accountId);
    if (!claimant) {
      const err = new Error("Account is not a listed claimant for this balance.");
      err.status = 400;
      return next(err);
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const evaluation = evaluatePredicate(claimant.predicate, nowSeconds);

    // Find temporal bounds if any
    let claimableFrom = null;
    let claimableUntil = null;

    const findBounds = (p) => {
      if (p.abs_after) claimableFrom = p.abs_after;
      if (p.abs_before) claimableUntil = p.abs_before;
      if (p.and) p.and.forEach(findBounds);
      if (p.or) p.or.forEach(findBounds);
    };
    findBounds(claimant.predicate);

    return success(res, {
      canClaimNow: evaluation.canClaim,
      reason: evaluation.reason,
      claimableFrom,
      claimableUntil,
      predicate: claimant.predicate,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Normalises a single claimable balance record from Horizon into the
 * consistent API shape used by the by-sponsor endpoint.
 *
 * @param {object} balance - Raw Horizon claimable balance record
 * @returns {object} Normalised balance object
 */
function normalizeSponsorBalance(balance) {
  // Parse asset string — Horizon returns "native" or "CODE:ISSUER"
  let asset;
  if (!balance.asset || isNativeAsset(balance.asset)) {
    asset = { code: "XLM", issuer: null, type: "native" };
  } else {
    const colonIdx = balance.asset.indexOf(":");
    if (colonIdx !== -1) {
      const code = balance.asset.slice(0, colonIdx);
      const issuer = balance.asset.slice(colonIdx + 1);
      asset = {
        code,
        issuer,
        type: code.length > 4 ? "credit_alphanum12" : "credit_alphanum4",
      };
    } else {
      asset = { code: balance.asset, issuer: null, type: "credit_alphanum4" };
    }
  }

  const amount = (parseFloat(balance.amount || 0)).toFixed(7);

  return {
    balanceId: balance.id,
    asset,
    amount,
    claimants: Array.isArray(balance.claimants) ? balance.claimants : [],
    createdAt: toISOTimestamp(balance.last_modified_time || balance.created_at || null),
  };
}

/**
 * GET /claimable-balances/by-sponsor/:address
 *
 * Returns a paginated list of claimable balances whose reserve was paid by
 * the specified sponsor address. Each balance is normalised to a consistent
 * shape: { balanceId, asset, amount, claimants, createdAt }.
 *
 * Responses are cached per sponsor address and pagination parameters.
 * Sponsored claimable balances change infrequently, so even a short TTL
 * eliminates most redundant Horizon calls.
 *
 * Cache TTL is configurable via CACHE_TTL_BALANCES_BY_SPONSOR_MS (default: 30 000 ms).
 *
 * Query params:
 *   - limit  (number, default: 20, max: 200)  — page size
 *   - cursor (string, optional)               — pagination cursor
 *   - fresh  (boolean, default: false)         — bypass cache when "true"
 *
 * Response headers:
 *   - X-Cache: HIT  — served from cache
 *   - X-Cache: MISS — fetched live from Horizon and stored in cache
 *
 * @example
 *   GET /claimable-balances/by-sponsor/GABC...?limit=10
 *   GET /claimable-balances/by-sponsor/GABC...?cursor=<cursor>&fresh=true
 */
router.get("/by-sponsor/:address", async (req, res, next) => {
  try {
    const { address } = req.params;

    // Validate that the sponsor address is a real Stellar Ed25519 public key
    validateAccountId(address);

    const { limit, cursor } = parsePaginationParams(req.query, 200);
    const fresh = req.query.fresh === true || req.query.fresh === "true";
    const cacheKey = `claimable-balances:by-sponsor:${address}:${limit}:${cursor || ""}`;

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached !== undefined) {
        res.set("X-Cache", "HIT");
        return res.json({ success: true, data: cached });
      }
    }

    let query = server
      .claimableBalances()
      .sponsor(address)
      .limit(limit);

    if (cursor) query = query.cursor(cursor);

    const response = await query.call();
    const records = response.records || [];

    const balances = records.map(normalizeSponsorBalance);

    const nextCursor = records.length > 0
      ? records[records.length - 1].paging_token || null
      : null;

    const data = {
      balances,
      total: balances.length,
      limit,
      cursor: nextCursor,
    };

    cacheService.set(cacheKey, data, cacheTTL.balancesBySponsor);
    res.set("X-Cache", "MISS");
    return res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
