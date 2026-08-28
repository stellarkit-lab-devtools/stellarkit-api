/**
 * POST /accounts/balances
 *
 * Fetch XLM and asset balances for up to 20 Stellar addresses in a single
 * normalised response. Designed for portfolio dashboards and exchange UIs
 * that need to display multi-account balance views without issuing one
 * HTTP request per account.
 *
 * Request body:
 *   { "addresses": ["G...", "G...", ...] }   (max 20 addresses)
 *
 * Successful response:
 *   {
 *     "success": true,
 *     "data": {
 *       "results": {
 *         "GABC...": { "balances": [ { asset, balance, ... }, ... ] },
 *         "GDEF...": { "error": { "type": "AccountNotFound", "message": "..." } }
 *       }
 *     }
 *   }
 *
 * Error responses:
 *   400 — missing / non-array addresses field, or more than 20 addresses
 *   (invalid individual addresses return an error entry rather than a 400)
 */

const express = require("express");
const router = express.Router();

const { server, NETWORK } = require("../config/stellar");
const { success } = require("../utils/response");
const { validateStellarAddress } = require("../utils/validators");
const { isNativeAsset, isNonNativeAsset } = require("../utils/assetHelpers");
const { normalizeAsset } = require("../utils/asset");
const { formatBalance } = require("../utils/formatBalance");

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_ADDRESSES = 20;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Normalise a raw Horizon account balances array into the StellarKit shape
 * used by GET /account/:id/balances.
 *
 * @param {Array} balances - Raw balances from Horizon account record
 * @returns {{ xlm: object, assets: Array }}
 */
function normaliseBalances(balances) {
  const xlmEntry = (balances || []).find((b) => isNativeAsset(b));
  const assets = (balances || [])
    .filter((b) => isNonNativeAsset(b))
    .map((b) => ({
      asset: normalizeAsset(b.asset_code, b.asset_issuer, b.asset_type),
      balance: formatBalance(b.balance),
      limit: b.limit,
      buyingLiabilities: b.buying_liabilities,
      sellingLiabilities: b.selling_liabilities,
      isAuthorized: b.is_authorized,
      isClawbackEnabled: b.is_clawback_enabled,
    }));

  return {
    xlm: {
      balance: formatBalance(xlmEntry ? xlmEntry.balance : "0.0000000"),
      buyingLiabilities: formatBalance(xlmEntry ? xlmEntry.buying_liabilities : "0"),
      sellingLiabilities: formatBalance(xlmEntry ? xlmEntry.selling_liabilities : "0"),
    },
    assets,
  };
}

/**
 * Attempt to load an account from Horizon and return either a normalised
 * balances payload or a structured error object for that address.
 *
 * @param {string} address - Stellar public key to look up
 * @returns {Promise<{ address: string, result: object }>}
 */
async function fetchBalancesForAddress(address) {
  // Validate address format first — no network call needed for invalid keys
  if (!validateStellarAddress(address)) {
    return {
      address,
      result: {
        error: {
          type: "InvalidAddress",
          message: `"${String(address).slice(0, 60)}" is not a valid Stellar account address.`,
          suggestion: "Account addresses start with G and are 56 characters long.",
        },
      },
    };
  }

  try {
    const account = await server.loadAccount(address);
    const { xlm, assets } = normaliseBalances(account.balances);

    return {
      address,
      result: {
        balances: [
          {
            asset: { code: "XLM", issuer: null, type: "native" },
            balance: xlm.balance,
            buyingLiabilities: xlm.buyingLiabilities,
            sellingLiabilities: xlm.sellingLiabilities,
          },
          ...assets.map((a) => ({
            asset: a.asset,
            balance: a.balance,
            limit: a.limit,
            buyingLiabilities: a.buyingLiabilities,
            sellingLiabilities: a.sellingLiabilities,
            isAuthorized: a.isAuthorized,
            isClawbackEnabled: a.isClawbackEnabled,
          })),
        ],
      },
    };
  } catch (err) {
    // Horizon 404 → account not found
    if (err && err.response && err.response.status === 404) {
      return {
        address,
        result: {
          error: {
            type: "AccountNotFound",
            message: `Account ${address} was not found on the Stellar ${NETWORK} network.`,
            suggestion:
              "Verify the account address is correct and that the account has been funded.",
          },
        },
      };
    }

    // Any other Horizon or network error
    return {
      address,
      result: {
        error: {
          type: "LookupFailed",
          message: err.message || "Failed to fetch account data from Horizon.",
        },
      },
    };
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────

/**
 * POST /accounts/balances
 *
 * Accepts an array of up to 20 Stellar public keys and returns their balances
 * in a single normalised response. All Horizon lookups are made in parallel
 * using Promise.allSettled so a single failing account never blocks the rest.
 *
 * @example
 * POST /accounts/balances
 * {
 *   "addresses": [
 *     "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
 *     "GBBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5"
 *   ]
 * }
 */
router.post("/balances", async (req, res, next) => {
  try {
    const { addresses } = req.body || {};

    // ── Input validation ─────────────────────────────────────────────────────

    if (!addresses || !Array.isArray(addresses)) {
      const err = new Error("Property 'addresses' is required and must be an array.");
      err.isValidation = true;
      err.field = "addresses";
      err.receivedValue = typeof addresses;
      err.expectedFormat = "Array of Stellar public keys (G... addresses)";
      return next(err);
    }

    if (addresses.length === 0) {
      const err = new Error("Property 'addresses' must contain at least one address.");
      err.isValidation = true;
      err.field = "addresses";
      err.receivedValue = "[]";
      err.expectedFormat = "Non-empty array of Stellar public keys";
      return next(err);
    }

    if (addresses.length > MAX_ADDRESSES) {
      const err = new Error(
        `Too many addresses. Maximum allowed is ${MAX_ADDRESSES}, received ${addresses.length}.`
      );
      err.isValidation = true;
      err.field = "addresses";
      err.receivedValue = String(addresses.length);
      err.expectedFormat = `Array of 1–${MAX_ADDRESSES} Stellar public keys`;
      err.status = 400;
      return next(err);
    }

    // ── Parallel lookups ─────────────────────────────────────────────────────

    // Promise.allSettled ensures all addresses are processed even when
    // individual lookups throw — fetchBalancesForAddress already catches
    // Horizon errors and maps them to per-entry error objects, so the outer
    // allSettled primarily guards against unexpected synchronous throws.
    const settled = await Promise.allSettled(
      addresses.map((addr) => fetchBalancesForAddress(addr))
    );

    // Build the results map keyed by address
    const results = {};
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") {
        const { address, result } = outcome.value;
        results[address] = result;
      } else {
        // This branch is a safety net; fetchBalancesForAddress should never
        // reject. If it somehow does, surface a generic error for that entry.
        // We cannot recover the address here, so we skip the entry silently.
        // In practice this path should never be reached.
      }
    }

    return success(res, { results });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
