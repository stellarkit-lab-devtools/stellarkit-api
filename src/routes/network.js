const express = require("express");
const router = express.Router();
const { server, horizonUrl } = require("../config/stellar");
const { success } = require("../utils/response");
const cacheService = require("../services/cache");

const VALIDATORS_CACHE_TTL = 300; // 5 minutes
const BASE_FEE_CACHE_TTL = 5;     // 5 seconds — one ledger close interval

/**
 * GET /network/base-fee
 * Returns the current Stellar network base fee from the most recent ledger.
 * Cached for 5 seconds (one ledger close interval) to avoid hammering Horizon
 * on every request while still reflecting fee changes quickly.
 *
 * Query params:
 *   ?fresh=true  — bypass the cache and fetch directly from Horizon
 *
 * Response headers:
 *   X-Cache: HIT  — served from cache
 *   X-Cache: MISS — fetched live from Horizon
 */
router.get("/base-fee", async (req, res, next) => {
  try {
    const cacheKey = "network-base-fee";
    const fresh = req.query.fresh === "true";

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    const ledger = await server.ledgers().order("desc").limit(1).call();
    const latest = ledger.records[0];

    if (!latest) {
      const err = new Error("Unable to fetch latest ledger from Horizon.");
      err.status = 502;
      return next(err);
    }

    const baseFeeStroops = parseInt(latest.base_fee_in_stroops || latest.base_fee, 10) || 0;

    const data = {
      baseFeeStroops,
      baseFeeXLM: (baseFeeStroops / 1e7).toFixed(7),
      ledgerSequence: latest.sequence,
      ledgerClosedAt: latest.closed_at,
      note: "Base fee is in stroops. 1 XLM = 10,000,000 stroops. Cached for 5 seconds.",
    };

    cacheService.set(cacheKey, data, BASE_FEE_CACHE_TTL);

    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND" || err.cause?.code === "ECONNREFUSED") {
      const horizonErr = new Error("Unable to fetch base fee from Horizon. Please try again.");
      horizonErr.status = 502;
      return next(horizonErr);
    }
    next(err);
  }
});

/**
 * GET /network/validators
 * Returns the current validator list from Horizon, normalised and grouped by organisation.
 */
router.get("/validators", async (req, res, next) => {
  try {
    const cacheKey = "network-validators";
    const fresh = req.query.fresh === "true";

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

    cacheService.set(cacheKey, data, VALIDATORS_CACHE_TTL);

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

module.exports = router;
