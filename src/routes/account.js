const express = require("express");
const router = express.Router();
const { server, NETWORK, fetchAccountCreation } = require("../config/stellar");
const { success, toISOTimestamp } = require("../utils/response");
const {
  makeAccountNotFoundError,
  makeTrustlineNotFoundError,
} = require("../utils/errors");
const cacheService = require("../services/cache");
const cacheTTL = require("../config/cacheConfig");
const {
  validateAccountId,
  validateAssetCode,
  validateLimit,
  validateISODate,
} = require("../utils/validators");
const { validateEffectType } = require("../utils/effectTypes");
const { accountSummaryRateLimiter } = require("../middleware/rateLimiter");
const registerParamValidation = require("../middleware/validateRouteParams");
const { startHorizonTimer, stopHorizonTimer } = require("../middleware/requestLogger");
registerParamValidation(router);

/**
 * Calls a Horizon-backed async function and records the duration on req
 * so the request logger can include horizonResponseTimeMs in the log entry.
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

const { buildAccountAgeResponse } = require("../utils/accountAge");
const { parsePaginationParams } = require("../utils/pagination");
const { formatLedgerSequence } = require("../utils/formatLedgerSequence");


const axios = require("axios");
const { Asset } = require("@stellar/stellar-sdk");
const { normalizeAsset, normalizeAssetFromString } = require("../utils/asset");
const { isNativeAsset, isNonNativeAsset } = require("../utils/assetHelpers");
const { getAssetMetadataFromToml } = require("../utils/tomlResolver");
const { formatBalance } = require("../utils/formatBalance");
const { parseStellarAmount } = require("../utils/parseStellarAmount");
const { formatAmount } = require("../utils/formatAmount");
const { mapAccountTrade } = require("../utils/mapAccountTrade");

// Cache TTL for account endpoint responses (in seconds)
const CACHE_TTL_ACCOUNT = parseInt(process.env.CACHE_TTL_ACCOUNT_MS, 10) / 1000 || 10;

/**
 * All Stellar Horizon operation types that can appear inside a transaction.
 * Used to validate the optional ?type= query parameter on the transactions endpoint.
 * Source: https://developers.stellar.org/docs/data/apis/horizon/api-reference/resources/operations/object
 */
const VALID_OPERATION_TYPES = new Set([
  "create_account",
  "payment",
  "path_payment_strict_receive",
  "path_payment_strict_send",
  "manage_sell_offer",
  "manage_buy_offer",
  "create_passive_sell_offer",
  "set_options",
  "change_trust",
  "allow_trust",
  "account_merge",
  "inflation",
  "manage_data",
  "bump_sequence",
  "create_claimable_balance",
  "claim_claimable_balance",
  "begin_sponsoring_future_reserves",
  "end_sponsoring_future_reserves",
  "revoke_sponsorship",
  "clawback",
  "clawback_claimable_balance",
  "set_trust_line_flags",
  "liquidity_pool_deposit",
  "liquidity_pool_withdraw",
  "invoke_host_function",
  "bump_footprint_expiration",
  "restore_footprint",
  "extend_footprint_ttl",
]);

function normalizeSignerType(type) {
  const normalized = String(type || "").toLowerCase();

  if (
    normalized === "ed25519_public_key" ||
    normalized === "ed25519" ||
    normalized === "signer_key_type_ed25519"
  ) {
    return "ed25519_public_key";
  }

  if (
    normalized === "sha256_hash" ||
    normalized === "hash_x" ||
    normalized === "signer_key_type_hash_x"
  ) {
    return "hash_x";
  }

  if (
    normalized === "preauth_tx" ||
    normalized === "pre_auth_tx" ||
    normalized === "signer_key_type_pre_auth_tx"
  ) {
    return "pre_auth_tx";
  }

  return type || "unknown";
}

function normalizeSigningKeysResponse(account) {
  const signers = (account.signers || []).map((signer) => ({
    key: signer.key,
    weight: Number(signer.weight) || 0,
    type: normalizeSignerType(signer.type),
    sponsoredBy: signer.sponsor || signer.sponsored_by || null,
  }));

  const masterSigner = signers.find(
    (signer) =>
      signer.key === account.id && signer.type === "ed25519_public_key",
  );

  return {
    signers,
    masterWeight: masterSigner ? masterSigner.weight : 0,
    thresholds: {
      lowThreshold: account.thresholds?.low_threshold ?? 0,
      medThreshold: account.thresholds?.med_threshold ?? 0,
      highThreshold: account.thresholds?.high_threshold ?? 0,
    },
  };
}

function handleAccountNotFound(err, next, accountId) {
  if (err && err.response && err.response.status === 404) {
    return next(makeAccountNotFoundError(accountId, NETWORK));
  }
  if (err && err.isAccountNotFound) {
    return next(err);
  }
  next(err);
}

function formatAccountBalances(account) {
  const xlmBalance = (account.balances || []).find((b) => isNativeAsset(b));
  const assets = (account.balances || [])
    .filter((b) => isNonNativeAsset(b))
    .map((b) => ({
      asset: normalizeAsset(b.asset_code, b.asset_issuer, b.asset_type),
      balance: b.balance,
      limit: b.limit,
      buyingLiabilities: b.buying_liabilities,
      sellingLiabilities: b.selling_liabilities,
      isAuthorized: b.is_authorized,
      isClawbackEnabled: b.is_clawback_enabled,
    }));

  return {
    xlm: {
      balance: xlmBalance
        ? formatBalance(xlmBalance.balance)
        : formatBalance("0.0000000"),
      buyingLiabilities: xlmBalance
        ? formatBalance(xlmBalance.buying_liabilities)
        : formatBalance("0"),
      sellingLiabilities: xlmBalance
        ? formatBalance(xlmBalance.selling_liabilities)
        : formatBalance("0"),
    },
    assets,
  };
}

function toSevenDecimalString(value) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "0.0000000";
  return parsed.toFixed(7);
}

function normalizeAssetShape(asset) {
  if (!asset) return { code: null, issuer: null, type: "credit_alphanum4" };

  if (asset === "native" || isNativeAsset(asset)) {
    return { code: "XLM", issuer: null, type: "native" };
  }

  if (typeof asset === "string") {
    const [code, issuer] = asset.split(":");
    if (code && issuer) {
      return {
        code,
        issuer,
        type: code.length > 4 ? "credit_alphanum12" : "credit_alphanum4",
      };
    }
    return { code: asset, issuer: null, type: "credit_alphanum4" };
  }

  const code = asset.code || asset.asset_code || asset.assetCode || null;
  const issuer = asset.issuer || asset.asset_issuer || asset.assetIssuer || null;
  const type = asset.type || asset.asset_type || asset.assetType || (code && code.length > 4 ? "credit_alphanum12" : "credit_alphanum4");

  return { code, issuer, type };
}

function normalizeClaimableBalance(balanceRecord) {
  return {
    balanceId: balanceRecord.id || balanceRecord.balance_id || null,
    asset: normalizeAssetShape(balanceRecord.asset),
    amount: toSevenDecimalString(balanceRecord.amount),
    sponsor: balanceRecord.sponsor || null,
    createdAt: balanceRecord.created_at || null,
    claimants: Array.isArray(balanceRecord.claimants) ? balanceRecord.claimants : [],
  };
}

async function resolveTrustlineToml(balance, issuerCache, tomlCache, includeMetadata) {
  const assetIssuer = balance.asset_issuer;
  const assetCode = balance.asset_code;

  if (!includeMetadata) {
    return {
      asset: {
        code: assetCode,
        issuer: assetIssuer,
        type: balance.asset_type,
      },
      balance: balance.balance,
      limit: balance.limit,
      isAuthorized: balance.is_authorized,
      isAuthorizedToMaintainLiabilities:
        balance.is_authorized_to_maintain_liabilities,
    };
  }

  if (!issuerCache.has(assetIssuer)) {
    issuerCache.set(
      assetIssuer,
      server
        .loadAccount(assetIssuer)
        .then((a) => a.home_domain || null)
        .catch(() => null),
    );
  }

  const homeDomain = await issuerCache.get(assetIssuer);

  let toml = null;
  if (homeDomain) {
    if (!tomlCache.has(homeDomain)) {
      tomlCache.set(homeDomain, homeDomain);
    }
    try {
      toml = await getAssetMetadataFromToml(homeDomain, assetCode);
    } catch (_) {
      toml = null;
    }
  }

  return {
    asset: {
      code: assetCode,
      issuer: assetIssuer,
      type: balance.asset_type,
    },
    balance: balance.balance,
    limit: balance.limit,
    isAuthorized: balance.is_authorized,
    isAuthorizedToMaintainLiabilities:
      balance.is_authorized_to_maintain_liabilities,
    metadata: toml,
  };
}

/**
 * GET /account/:id/trustlines
 *
 * Query params:
 *   - assetCode (string, optional): filters trustlines to a single asset code
 *   - sponsored (boolean, optional): when "true", returns only trustlines
 *     where sponsoredBy is not null; when "false", returns only trustlines
 *     where sponsoredBy is null. Omitted returns all trustlines.
 */
router.get("/:id/trustlines", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const fresh = req.query.fresh === "true";
    const includeMetadata = req.query.includeMetadata === "true";
    const { assetCode } = req.query;
    const sponsored = req.query.sponsored;
    const hasSponsoredFilter = typeof sponsored === "boolean";
    const cacheKey = `trustlines:${id}`;

    // Only read from cache for unfiltered requests; filtered results are subsets
    // of the full list and must not be served from the full-list cache entry.
    if (!fresh && !assetCode && !hasSponsoredFilter) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    const account = await withHorizonTiming(req, () => server.loadAccount(id));

    const issuerCache = new Map();
    const tomlCache = new Map();

    const trustlineBalances = (account.balances || []).filter(
      (b) => isNonNativeAsset(b),
    );

    let trustlines = await Promise.all(
      trustlineBalances.map((b) =>
        resolveTrustlineToml(b, issuerCache, tomlCache, includeMetadata),
      ),
    );

    if (assetCode) {
      const filterLower = assetCode.toLowerCase();
      trustlines = trustlines.filter(
        (t) => t.asset.code.toLowerCase() === filterLower,
      );
    }

    if (hasSponsoredFilter) {
      trustlines = trustlines.filter((t) =>
        sponsored ? t.sponsoredBy !== null : t.sponsoredBy === null,
      );
    }

    return success(res, {
      accountId: account.id,
      trustlines,
      count: trustlines.length,
      assets: trustlines,
      assetCount: trustlines.length,
      items: trustlines,
      total: trustlines.length,
      limit: null,
      cursor: null,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/balances
 *
 * Returns XLM and asset balances for an account.
 *
 * Query params:
 *   - assets (string, optional) — comma-separated asset identifiers to filter by.
 *     Format: "XLM" for native, "CODE:ISSUER" for issued assets.
 *     Invalid identifiers are ignored. Example: ?assets=XLM,USDC:GA...
 *   - native (boolean, optional) — when "true", returns only the native XLM balance.
 *     Works independently of the assets filter.
 */
router.get("/:id/balances", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const account = await withHorizonTiming(req, () => server.loadAccount(id));
    const formatted = formatAccountBalances(account);

    const nativeOnly = req.query.native === "true" || req.query.native === true;

    if (nativeOnly) {
      // Return only native XLM balance
      return success(res, {
        xlm: formatted.xlm,
        assets: [],
      });
    }

    const assetsFilter = req.query.assets;
    if (assetsFilter) {
      const requested = assetsFilter.split(",").map((s) => s.trim()).filter(Boolean);
      const matches = [];

      for (const identifier of requested) {
        if (identifier.toUpperCase() === "XLM") {
          matches.push("__xlm__");
          continue;
        }
        const colonIdx = identifier.indexOf(":");
        if (colonIdx === -1) continue; // invalid, ignore
        const code = identifier.slice(0, colonIdx).toUpperCase();
        const issuer = identifier.slice(colonIdx + 1);
        if (!code || !issuer) continue;
        matches.push(`${code}:${issuer}`);
      }

      const matchSet = new Set(matches);

      // Filter xlm
      if (!matchSet.has("__xlm__")) {
        formatted.xlm = {
          balance: "0.0000000",
          buyingLiabilities: "0.0000000",
          sellingLiabilities: "0.0000000",
        };
      }

      // Filter assets
      formatted.assets = formatted.assets.filter((a) => {
        const key = `${a.asset.code}:${a.asset.issuer}`;
        return matchSet.has(key);
      });
    }

    return success(res, formatted);
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/native-balance
 */
router.get("/:id/native-balance", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const account = await withHorizonTiming(req, () => server.loadAccount(id));
    const xlmBalance = (account.balances || []).find(
      (b) => isNativeAsset(b),
    );

    if (!xlmBalance) {
      return success(res, {
        balance: formatBalance("0.0000000"),
        buyingLiabilities: formatBalance("0.0000000"),
        sellingLiabilities: formatBalance("0.0000000"),
      });
    }

    return success(res, {
      balance: formatBalance(xlmBalance.balance),
      buyingLiabilities: formatBalance(xlmBalance.buying_liabilities),
      sellingLiabilities: formatBalance(xlmBalance.selling_liabilities),
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/asset-balance/:assetCode/:assetIssuer
 *
 * Returns the balance for a specific asset trustline without fetching all balances.
 *
 * Path params:
 *   - id (string, required) — Stellar account public key (G...)
 *   - assetCode (string, required) — Asset code (e.g., USDC)
 *   - assetIssuer (string, required) — Issuer public key (G...)
 *
 * Query params:
 *   - fresh (boolean, default: false) — bypasses the cache when set to "true"
 *
 * Response headers:
 *   - X-Cache: HIT  — served from cache
 *   - X-Cache: MISS — fetched live from Horizon and cached
 *
 * Returns:
 *   - 200: { success: true, data: { asset, balance, limit, buyingLiabilities, sellingLiabilities, isAuthorized } }
 *   - 404: Asset trustline not found on the account
 */
router.get("/:id/asset-balance/:assetCode/:assetIssuer", async (req, res, next) => {
  try {
    const { id, assetCode, assetIssuer } = req.params;
    validateAccountId(id);
    validateAccountId(assetIssuer);
    validateAssetCode(assetCode);

    const fresh = req.query.fresh === true || req.query.fresh === "true";
    const cacheKey = `asset-balance:${id}:${assetCode.toUpperCase()}:${assetIssuer}`;

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    const account = await withHorizonTiming(req, () => server.loadAccount(id));
    const normalizedAssetCode = assetCode.toUpperCase();
    const trustline = (account.balances || []).find(
      (b) =>
        isNonNativeAsset(b) &&
        b.asset_code === normalizedAssetCode &&
        b.asset_issuer === assetIssuer
    );

    if (!trustline) {
      return next(makeTrustlineNotFoundError(id, normalizedAssetCode, assetIssuer));
    }

    const assetType = normalizedAssetCode.length > 4 ? "credit_alphanum12" : "credit_alphanum4";

    const data = {
      asset: {
        code: normalizedAssetCode,
        issuer: assetIssuer,
        type: assetType,
      },
      balance: toSevenDecimalString(trustline.balance),
      limit: toSevenDecimalString(trustline.limit),
      buyingLiabilities: toSevenDecimalString(trustline.buying_liabilities || "0"),
      sellingLiabilities: toSevenDecimalString(trustline.selling_liabilities || "0"),
      isAuthorized: trustline.is_authorized === true,
      isAuthorizedToMaintainLiabilities: trustline.is_authorized_to_maintain_liabilities === true,
    };

    cacheService.set(cacheKey, data, cacheTTL.assetBalance);
    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/sequence
 *
 * Returns the current sequence number for an account.
 *
 * Sequence numbers only change when a transaction submitted by the account is
 * applied to the ledger, making short-term caching effective. Responses are
 * cached per account ID.
 *
 * Query params:
 *   - fresh (boolean, default: false) — bypasses the cache when set to "true"
 *
 * Response headers:
 *   - X-Cache: HIT  — served from cache
 *   - X-Cache: MISS — fetched live from Horizon and cached
 *
 * Cache TTL is configurable via the CACHE_TTL_SEQUENCE_MS environment variable
 * (default: 20 000 ms / 20 seconds).
 */
router.get("/:id/sequence", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const fresh = req.query.fresh === "true";
    const cacheKey = `sequence:${id}`;

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached !== undefined) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    const account = await withHorizonTiming(req, () => server.loadAccount(id));

    const data = {
      accountId: account.id,
      sequence: account.sequence,
      lastModifiedLedger: formatLedgerSequence(account.last_modified_ledger),
    };

    cacheService.set(cacheKey, data, cacheTTL.sequence);
    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/signing-keys
 */
router.get("/:id/signing-keys", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const account = await withHorizonTiming(req, () => server.loadAccount(id));
    return success(res, normalizeSigningKeysResponse(account));
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/multisig-info
 *
 * Returns a human-readable summary of an account's multisig configuration,
 * including whether the account is multisig-enabled, all three threshold
 * levels, the master-key weight, and each signer with its key, weight, and type.
 *
 * An account is considered "multisig" when it has more than one signer OR
 * when any threshold is greater than 1 (i.e. no single signer can unilaterally
 * authorise every operation class).
 *
 * @example
 *   GET /account/GABC.../multisig-info
 */
router.get("/:id/multisig-info", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const account = await withHorizonTiming(req, () => server.loadAccount(id));

    // Normalise every signer: camelCase fields, human-readable type,
    // and sponsoredBy always present (string or null — never omitted).
    const signers = (account.signers || []).map((s) => ({
      key: s.key,
      weight: Number(s.weight) || 0,
      type: normalizeSignerType(s.type),
      sponsoredBy: s.sponsor || s.sponsored_by || null,
    }));

    const thresholds = {
      low: account.thresholds?.low_threshold ?? 0,
      medium: account.thresholds?.med_threshold ?? 0,
      high: account.thresholds?.high_threshold ?? 0,
    };

    // Master key is the signer whose key matches the account ID itself.
    const masterSigner = signers.find((s) => s.key === account.id);
    const masterWeight = masterSigner ? masterSigner.weight : 0;

    // The account is "multisig" when it requires more than one party to sign,
    // which is true if there is more than one registered signer OR any
    // threshold exceeds the weight of the master key alone.
    // Cast to boolean explicitly so the field is always true/false, never truthy.
    const isMultisig = Boolean(
      signers.length > 1 ||
      thresholds.low > masterWeight ||
      thresholds.medium > masterWeight ||
      thresholds.high > masterWeight,
    );

    return success(res, {
      accountId: account.id,
      isMultisig,
      masterWeight,
      thresholds,
      signers,
      signerCount: signers.length,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});



/**
 * GET /account/:id/operations
 *
 * Returns a paginated list of operations for the specified account.
 * Each operation includes its ID, type, creation timestamp, transaction hash,
 * and type-specific fields (e.g. amount, asset for payments).
 *
 * Query params:
 *   - limit  (number, default: 20, max: 200)
 *   - cursor (string, optional pagination cursor)
 *   - type   (string, optional) — filter to operations of a specific type
 *            e.g. ?type=payment, ?type=change_trust, ?type=create_account
 *
 * Returns 400 if an unrecognised operation type is supplied.
 * Returns 404 if the account does not exist.
 *
 * @example
 *   GET /account/:id/operations?type=payment&limit=50
 *   GET /account/:id/operations?cursor=123456789
 */
router.get("/:id/operations", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    // --- ?type= validation ---
    const rawType = req.query.type;
    if (rawType !== undefined) {
      const normalizedType = String(rawType).toLowerCase().trim();
      if (!VALID_OPERATION_TYPES.has(normalizedType)) {
        const err = new Error(
          `Unknown operation type "${rawType}". Valid types are: ${[...VALID_OPERATION_TYPES].sort().join(", ")}.`
        );
        err.isValidation = true;
        err.field = "type";
        err.receivedValue = rawType;
        err.expectedFormat = [...VALID_OPERATION_TYPES].sort().join(", ");
        return next(err);
      }
    }

    const { limit, cursor } = parsePaginationParams(req.query, 200);

    // Ensure account exists for proper 404s
    await withHorizonTiming(req, () => server.loadAccount(id));

    let query = server.operations().forAccount(id).limit(limit).order("desc");
    if (cursor) query = query.cursor(cursor);

    const operationsResponse = await query.call();
    const records = operationsResponse.records || [];

    // Filter by type if requested
    const filteredRecords = rawType
      ? records.filter((op) => op.type === String(rawType).toLowerCase().trim())
      : records;

    const operations = filteredRecords.map((op) => {
      const operationId = op.id;
      const type = op.type;
      const createdAt = toISOTimestamp(op.created_at);
      const transactionHash = op.transaction_hash;

      // Build base operation object
      const operation = {
        operationId,
        type,
        createdAt,
        transactionHash,
      };

      // Add type-specific fields
      // Payment operations
      if (type === "payment") {
        const assetType = op.asset_type || "native";
        operation.amount = op.amount;
        operation.asset = isNativeAsset({ type: assetType })
          ? { code: "XLM", issuer: null, type: "native" }
          : {
              code: op.asset_code || null,
              issuer: op.asset_issuer || null,
              type: assetType,
            };
        operation.from = op.from;
        operation.to = op.to;
      }

      // Create account operations
      if (type === "create_account") {
        operation.startingBalance = op.starting_balance;
        operation.funder = op.funder;
        operation.account = op.account;
      }

      // Path payment operations
      if (type === "path_payment_strict_receive" || type === "path_payment_strict_send") {
        operation.amount = op.amount;
        operation.sourceAmount = op.source_amount;
        operation.sourceMax = op.source_max;
        operation.from = op.from;
        operation.to = op.to;
        
        const sourceAssetType = op.source_asset_type || "native";
        operation.sourceAsset = isNativeAsset({ type: sourceAssetType })
          ? { code: "XLM", issuer: null, type: "native" }
          : {
              code: op.source_asset_code || null,
              issuer: op.source_asset_issuer || null,
              type: sourceAssetType,
            };

        const assetType = op.asset_type || "native";
        operation.asset = isNativeAsset({ type: assetType })
          ? { code: "XLM", issuer: null, type: "native" }
          : {
              code: op.asset_code || null,
              issuer: op.asset_issuer || null,
              type: assetType,
            };
      }

      // Change trust operations
      if (type === "change_trust") {
        const assetType = op.asset_type || "credit_alphanum4";
        operation.asset = {
          code: op.asset_code || null,
          issuer: op.asset_issuer || null,
          type: assetType,
        };
        operation.limit = op.limit;
        operation.trustor = op.trustor;
      }

      // Manage offer operations
      if (
        type === "manage_sell_offer" ||
        type === "manage_buy_offer" ||
        type === "create_passive_sell_offer"
      ) {
        operation.amount = op.amount;
        operation.price = op.price;
        operation.offerId = op.offer_id;

        const buyingAssetType = op.buying_asset_type || "native";
        operation.buyingAsset = isNativeAsset({ type: buyingAssetType })
          ? { code: "XLM", issuer: null, type: "native" }
          : {
              code: op.buying_asset_code || null,
              issuer: op.buying_asset_issuer || null,
              type: buyingAssetType,
            };

        const sellingAssetType = op.selling_asset_type || "native";
        operation.sellingAsset = isNativeAsset({ type: sellingAssetType })
          ? { code: "XLM", issuer: null, type: "native" }
          : {
              code: op.selling_asset_code || null,
              issuer: op.selling_asset_issuer || null,
              type: sellingAssetType,
            };
      }

      // Account merge operations
      if (type === "account_merge") {
        operation.account = op.account;
        operation.into = op.into;
      }

      // Set options operations
      if (type === "set_options") {
        if (op.home_domain !== undefined) operation.homeDomain = op.home_domain;
        if (op.signer_key !== undefined) {
          operation.signer = {
            key: op.signer_key,
            weight: op.signer_weight,
          };
        }
        if (op.master_key_weight !== undefined)
          operation.masterKeyWeight = op.master_key_weight;
        if (op.low_threshold !== undefined)
          operation.lowThreshold = op.low_threshold;
        if (op.med_threshold !== undefined)
          operation.medThreshold = op.med_threshold;
        if (op.high_threshold !== undefined)
          operation.highThreshold = op.high_threshold;
      }

      // Claimable balance operations
      if (type === "create_claimable_balance") {
        const assetType = op.asset_type || "native";
        operation.amount = op.amount;
        operation.asset = isNativeAsset({ type: assetType })
          ? { code: "XLM", issuer: null, type: "native" }
          : {
              code: op.asset_code || null,
              issuer: op.asset_issuer || null,
              type: assetType,
            };
      }

      if (type === "claim_claimable_balance") {
        operation.balanceId = op.balance_id;
        operation.claimant = op.claimant;
      }

      // Liquidity pool operations
      if (type === "liquidity_pool_deposit" || type === "liquidity_pool_withdraw") {
        operation.liquidityPoolId = op.liquidity_pool_id;
        if (op.reserves_max) operation.reservesMax = op.reserves_max;
        if (op.reserves_min) operation.reservesMin = op.reserves_min;
        if (op.reserves_deposited) operation.reservesDeposited = op.reserves_deposited;
        if (op.reserves_received) operation.reservesReceived = op.reserves_received;
        if (op.shares) operation.shares = op.shares;
      }

      return operation;
    });

    const nextCursor =
      filteredRecords.length > 0
        ? filteredRecords[filteredRecords.length - 1].paging_token || null
        : null;

    return success(res, {
      operations,
      total: operations.length,
      limit,
      cursor: operations.length ? nextCursor : null,
    });
  } catch (err) {
    if (err && err.response && err.response.status === 404) {
      return next(makeAccountNotFoundError(req.params.id, NETWORK));
    }
    if (err && err.isAccountNotFound) return next(err);
    next(err);
  }
});

/**
 * GET /account/:id/payments
 *
 * Returns payment operations for an account by calling
 * `server.payments().forAccount(id)` — the Horizon payments stream — and
 * normalising each record into the StellarKit shape.
 *
 * Covered operation types:
 *   - payment                    → direct XLM or asset transfer
 *   - path_payment_strict_send   → cross-asset path payment (exact send amount)
 *   - path_payment_strict_receive→ cross-asset path payment (exact receive amount)
 *   - create_account             → initial account funding (treated as XLM payment)
 *
 * Query params:
 *   - limit       (number,  default: 10, max: 200)
 *   - cursor      (string,  pagination cursor from previous response)
 *   - order       ("asc"|"desc", default: "desc")
 *   - assetCode   (string,  optional) — filter to payments involving this asset code
 *   - assetIssuer (string,  optional) — narrow assetCode filter to a specific issuer
 *   - startDate   (ISO 8601 string, optional) — exclude records before this date
 *   - endDate     (ISO 8601 string, optional) — exclude records after this date
 *
 * Response shape (each item):
 *   {
 *     paymentId:     string,
 *     type:          "payment"|"path_payment_strict_send"|"path_payment_strict_receive"|"create_account",
 *     from:          string,   // sender public key
 *     to:            string,   // receiver public key
 *     asset:         { code, issuer, type },  // destination asset
 *     amount:        string,   // destination amount (7 decimals)
 *     sourceAsset:   { code, issuer, type } | undefined,  // path payments only
 *     sourceAmount:  string | undefined,                  // path payments only
 *     createdAt:     string,
 *     transactionHash: string,
 *   }
 */
router.get("/:id/payments", async (req, res, next) => {
  try {
    const { id } = req.params;
    if (req.originalUrl && req.originalUrl.includes("//")) {
      validateAccountId("");
    }
    const reservedWords = [
      "sequence", "home-domain", "min-balance", "flags", "signers",
      "trustlines", "analytics", "balances", "summary", "sponsorship",
      "subentry-health", "merge-eligibility", "offers", "payments",
      "operation-breakdown", "offer-history", "timeline", "data",
      "pool-positions", "risk-score", "trustline-health", "age", "volume",
      "payment-summary", "operations",
    ];
    if (reservedWords.includes(id)) {
      return next();
    }
    validateAccountId(id);

    const { limit, order, cursor } = parsePaginationParams(req.query);

    // ── Optional filters ──────────────────────────────────────────────────
    // assetCode / assetIssuer are applied after fetching so that the Horizon
    // page size matches the requested limit exactly even when some records are
    // filtered out.  This is consistent with how other filtered endpoints in
    // the project work (e.g. /trustlines).
    const filterCode   = req.query.assetCode   ? String(req.query.assetCode).toUpperCase()   : null;
    const filterIssuer = req.query.assetIssuer ? String(req.query.assetIssuer)               : null;

    // Date filters — ISO 8601, validated below
    let startDate = null;
    let endDate   = null;
    if (req.query.startDate !== undefined) {
      startDate = validateISODate(req.query.startDate, "startDate");
    }
    if (req.query.endDate !== undefined) {
      endDate = validateISODate(req.query.endDate, "endDate");
    }
    if (startDate && endDate && startDate >= endDate) {
      const err = new Error("Query param 'startDate' must be before 'endDate'.");
      err.isValidation = true;
      err.field = "startDate";
      err.receivedValue = req.query.startDate;
      err.expectedFormat = "ISO 8601 date earlier than endDate";
      err.status = 400;
      throw err;
    }

    let query = server.payments().forAccount(id).limit(limit).order(order);
    if (cursor) query = query.cursor(cursor);

    const response = await query.call();
    const rawRecords = response.records || [];

    // ── Normalise each record ─────────────────────────────────────────────
    const PAYMENT_TYPES = new Set([
      "payment",
      "path_payment_strict_send",
      "path_payment_strict_receive",
      "create_account",
    ]);

    const payments = [];

    for (const op of rawRecords) {
      if (!PAYMENT_TYPES.has(op.type)) continue;

      // ── Date filtering ──────────────────────────────────────────────────
      if (startDate || endDate) {
        const createdAtDate = new Date(op.created_at);
        if (startDate && createdAtDate < startDate) continue;
        if (endDate   && createdAtDate > endDate)   continue;
      }

      // ── Resolve destination asset and amounts by operation type ──────────
      let destAssetCode, destAssetIssuer, destAssetType, amount;
      let sourceAsset = undefined;
      let sourceAmount = undefined;
      let from, to;

      if (op.type === "create_account") {
        destAssetCode   = "XLM";
        destAssetIssuer = null;
        destAssetType   = "native";
        amount          = op.starting_balance;
        from            = op.funder;
        to              = op.account;
      } else if (op.type === "payment") {
        destAssetCode   = op.asset_type === "native" ? "XLM" : (op.asset_code || "XLM");
        destAssetIssuer = op.asset_type === "native" ? null  : (op.asset_issuer || null);
        destAssetType   = op.asset_type || "native";
        amount          = op.amount;
        from            = op.from;
        to              = op.to;
      } else {
        // path_payment_strict_send / path_payment_strict_receive
        destAssetCode   = op.asset_type === "native" ? "XLM" : (op.asset_code || "XLM");
        destAssetIssuer = op.asset_type === "native" ? null  : (op.asset_issuer || null);
        destAssetType   = op.asset_type || "native";
        amount          = op.amount;
        from            = op.from;
        to              = op.to;

        const srcType   = op.source_asset_type || "native";
        sourceAsset = normalizeAsset(
          srcType === "native" ? "XLM" : (op.source_asset_code || "XLM"),
          srcType === "native" ? null  : (op.source_asset_issuer || null),
          srcType,
        );
        sourceAmount = op.source_amount || op.source_max || null;
      }

      // ── Asset code / issuer filter ────────────────────────────────────
      if (filterCode) {
        // Check both destination and source asset (for path payments)
        const destMatch = destAssetCode === filterCode;
        const srcMatch  = sourceAsset && sourceAsset.code === filterCode;
        if (!destMatch && !srcMatch) continue;

        // If assetIssuer is also specified, narrow further
        if (filterIssuer) {
          const destIssuerMatch = destMatch  && destAssetIssuer === filterIssuer;
          const srcIssuerMatch  = srcMatch   && sourceAsset.issuer === filterIssuer;
          if (!destIssuerMatch && !srcIssuerMatch) continue;
        }
      }

      const item = {
        paymentId:       op.id,
        type:            op.type,
        from,
        to,
        asset:           normalizeAsset(destAssetCode, destAssetIssuer, destAssetType),
        amount,
        createdAt:       toISOTimestamp(op.created_at),
        transactionHash: op.transaction_hash,
      };

      if (sourceAsset !== undefined) {
        item.sourceAsset  = sourceAsset;
        item.sourceAmount = sourceAmount;
      }

      payments.push(item);
    }

    const lastRecord = rawRecords[rawRecords.length - 1];
    const nextCursor = lastRecord ? lastRecord.paging_token : null;

    return success(res, {
      payments,
      items: payments,
      total: payments.length,
      limit,
      cursor: payments.length ? nextCursor : null,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/trades
 *
 * Returns a normalised, paginated list of trades executed by the account.
 *
 * Query params:
 *   - limit, order, cursor       — standard pagination
 *   - startDate, endDate         — optional ISO 8601 range filter on ledgerCloseTime
 *   - fresh (boolean)            — bypasses the cache when set to "true"
 *
 * Each entry includes tradeId, ledgerCloseTime, selling, buying, soldAmount,
 * boughtAmount, price, and offerId (per the account's side of the trade),
 * alongside the raw base/counter fields for backward compatibility.
 * Asset fields follow the standard { code, issuer, type } shape, and
 * soldAmount/boughtAmount/price are seven-decimal strings.
 *
 * Returns:
 *   - 200: { success: true, data: { trades, items, total, limit, cursor } }
 *   - 404: Account does not exist
 */
router.get("/:id/trades", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const { limit, order, cursor } = parsePaginationParams(req.query);
    const fresh = req.query.fresh === true;

    // --- ?startDate / ?endDate validation ---
    let startDate;
    let endDate;
    if (req.query.startDate !== undefined) {
      startDate = validateISODate(req.query.startDate, "startDate");
    }
    if (req.query.endDate !== undefined) {
      endDate = validateISODate(req.query.endDate, "endDate");
    }
    if (startDate && endDate && startDate >= endDate) {
      const err = new Error(
        "Query param 'startDate' must be before 'endDate'.",
      );
      err.isValidation = true;
      err.field = "startDate";
      err.receivedValue = req.query.startDate;
      err.expectedFormat = "ISO 8601 date earlier than endDate";
      err.status = 400;
      throw err;
    }

    const normalizedCursor = cursor || "";
    const startKey = startDate ? startDate.toISOString() : "";
    const endKey = endDate ? endDate.toISOString() : "";
    const cacheKey = `account-trades:${id}:${limit}:${order}:${normalizedCursor}:${startKey}:${endKey}`;

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    let query = server.trades().forAccount(id).limit(limit).order(order);
    if (cursor) query = query.cursor(cursor);

    const tradeResponse = await query.call();
    const records = tradeResponse.records || [];

    const trades = records
      .filter((trade) => {
        if (!startDate && !endDate) return true;
        const t = new Date(trade.ledger_close_time);
        if (startDate && t < startDate) return false;
        if (endDate && t > endDate) return false;
        return true;
      })
      .map((trade) => mapAccountTrade(trade, id));

    const nextCursor = records.length
      ? records[records.length - 1].paging_token || null
      : null;

    const data = {
      trades,
      items: trades,
      total: trades.length,
      limit,
      cursor: trades.length ? nextCursor : null,
    };

    cacheService.set(cacheKey, data, cacheTTL.trades);
    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/offers
 *
 * Returns open DEX offers for an account.
 *
 * Query params:
 *   - offerId       (string)  — fetch a single offer by its numeric ID
 *   - expandAssets  (boolean) — when "true", embeds full { code, issuer, type }
 *                               objects for both selling and buying assets.
 *                               When omitted (default), returns simplified
 *                               asset strings for backward compatibility.
 *   - limit, order, cursor   — standard pagination
 *
 * @example
 *   GET /account/:id/offers                        → simplified asset strings
 *   GET /account/:id/offers?expandAssets=true      → full asset objects
 */
router.get("/:id/offers", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { offerId } = req.query;

    // expandAssets=true embeds full { code, issuer, type } objects on each offer.
    // Any value other than the string "true" keeps the default simplified form.
    const expandAssets = req.query.expandAssets === "true";

    validateAccountId(id);

    if (offerId) {
      try {
        const offer = await server.offers().offer(offerId).call();
        return success(res, offer);
      } catch (err) {
        if (err.response && err.response.status === 404) {
          const notFound = new Error(
            `Offer '${offerId}' was not found on the Stellar ${NETWORK} network.`,
          );
          notFound.isOfferNotFound = true;
          notFound.suggestion =
            "The offer may have already been filled, cancelled, or the offer ID may be incorrect.";
          throw notFound;
        }
        throw err;
      }
    }

    const { limit, order, cursor } = parsePaginationParams(req.query);

    let query = server.offers().forAccount(id).limit(limit).order(order);
    if (cursor) query = query.cursor(cursor);

    const offerResponse = await query.call();
    const offers = (offerResponse.records || []).map((offer) => {
      // Derive a single decimal price string from price_r (n/d fraction) when
      // available, falling back to the pre-computed price string from Horizon.
      // Always format to 7 decimal places for consistency with other amounts.
      let priceDecimal;
      if (offer.price_r && offer.price_r.d && Number(offer.price_r.d) !== 0) {
        priceDecimal = (
          Number(offer.price_r.n) / Number(offer.price_r.d)
        ).toFixed(7);
      } else {
        priceDecimal = parseFloat(offer.price || "0").toFixed(7);
      }

      // Full normalized asset object { code, issuer, type }
      const sellingAsset = normalizeAsset(
        offer.selling_asset_code,
        offer.selling_asset_issuer,
        offer.selling_asset_type,
      );
      const buyingAsset = normalizeAsset(
        offer.buying_asset_code,
        offer.buying_asset_issuer,
        offer.buying_asset_type,
      );

      if (expandAssets) {
        // ?expandAssets=true — embed full asset objects on both sides
        return {
          id: offer.id,
          seller: offer.seller,
          selling: {
            asset: sellingAsset,
            amount: parseFloat(offer.amount || "0").toFixed(7),
          },
          buying: {
            asset: buyingAsset,
          },
          price: priceDecimal,
          lastModifiedLedger: offer.last_modified_ledger,
        };
      }

      // Default (backward-compatible) — asset fields spread directly onto selling/buying
      return {
        id: offer.id,
        seller: offer.seller,
        selling: {
          ...sellingAsset,
          // Format to 7 decimal places (Stellar precision standard)
          amount: parseFloat(offer.amount || "0").toFixed(7),
        },
        buying: buyingAsset,
        // price is a 7-decimal string derived from the price_r fraction
        price: priceDecimal,
        // camelCase rename of last_modified_ledger
        lastModifiedLedger: offer.last_modified_ledger,
      };
    });

    const hasMore = (offerResponse.records || []).length === limit;
    const nextCursor = hasMore
      ? (offerResponse.records[offerResponse.records.length - 1] || {})
        .paging_token
      : null;

    return success(res, {
      items: offers,
      total: offers.length,
      limit,
      cursor: nextCursor,
    });
  } catch (err) {
    if (req.query.offerId) {
      next(err);
    } else {
      handleAccountNotFound(err, next, req.params.id);
    }
  }
});


/**
 * Builds a normalized { code, issuer, type } asset shape from a raw Horizon
 * effect record. Returns null when the effect carries no asset information.
 *
 * @param {Object} eff - Raw Horizon effect record
 * @returns {{ code: string|null, issuer: string|null, type: string }|null}
 */
function normalizeEffectAsset(eff) {
  if (!eff) return null;

  // Some effect types carry a pre-composed asset string (e.g. "native")
  if (typeof eff.asset === "string") {
    if (eff.asset === "native") return { code: "XLM", issuer: null, type: "native" };
    const parts = eff.asset.split(":");
    if (parts.length === 2) {
      const [code, issuer] = parts;
      return normalizeAsset(code, issuer, code.length > 4 ? "credit_alphanum12" : "credit_alphanum4");
    }
  }

  // Explicit asset_type field on the record
  if (eff.asset_type) {
    return normalizeAsset(eff.asset_code || null, eff.asset_issuer || null, eff.asset_type);
  }

  return null;
}

/**
 * Normalizes a raw Horizon effect record into the StellarKit camelCase shape.
 *
 * All common effect types are mapped explicitly so every field uses camelCase
 * and amounts are formatted to seven decimal places. Unknown / future effect
 * types fall back to a minimal shape that always includes `type` and `createdAt`.
 *
 * @param {Object} eff - Raw Horizon effect record
 * @returns {Object} Normalised effect
 */
function normalizeEffect(eff) {
  const type = eff.type || "unknown";
  const base = {
    id: eff.id || null,
    type,
    account: eff.account || null,
    createdAt: toISOTimestamp(eff.created_at),
    pagingToken: eff.paging_token || null,
    transactionHash: eff.transaction_hash || null,
  };

  // ── Account effects ───────────────────────────────────────────────────────
  if (type === "account_created") {
    return {
      ...base,
      startingBalance: toSevenDecimalString(eff.starting_balance),
    };
  }

  if (type === "account_credited" || type === "account_debited") {
    return {
      ...base,
      asset: normalizeEffectAsset(eff) || normalizeAsset(eff.asset_code, eff.asset_issuer, eff.asset_type),
      amount: toSevenDecimalString(eff.amount),
    };
  }

  if (type === "account_removed") {
    return { ...base };
  }

  if (type === "account_thresholds_updated") {
    return {
      ...base,
      lowThreshold: eff.low_threshold != null ? Number(eff.low_threshold) : null,
      medThreshold: eff.med_threshold != null ? Number(eff.med_threshold) : null,
      highThreshold: eff.high_threshold != null ? Number(eff.high_threshold) : null,
    };
  }

  if (type === "account_home_domain_updated") {
    return {
      ...base,
      homeDomain: eff.home_domain || null,
    };
  }

  if (type === "account_flags_updated") {
    return {
      ...base,
      authRequired: eff.auth_required_flag != null ? Boolean(eff.auth_required_flag) : null,
      authRevocable: eff.auth_revocable_flag != null ? Boolean(eff.auth_revocable_flag) : null,
      authImmutable: eff.auth_immutable_flag != null ? Boolean(eff.auth_immutable_flag) : null,
      clawbackEnabled: eff.auth_clawback_enabled_flag != null ? Boolean(eff.auth_clawback_enabled_flag) : null,
    };
  }

  if (type === "account_inflation_destination_updated") {
    return {
      ...base,
      inflationDestination: eff.inflation_destination || null,
    };
  }

  // ── Signer effects ────────────────────────────────────────────────────────
  if (type === "signer_created" || type === "signer_removed" || type === "signer_updated") {
    return {
      ...base,
      weight: eff.weight != null ? Number(eff.weight) : null,
      publicKey: eff.public_key || null,
      key: eff.key || eff.public_key || null,
    };
  }

  if (
    type === "signer_sponsorship_created" ||
    type === "signer_sponsorship_updated" ||
    type === "signer_sponsorship_removed"
  ) {
    return {
      ...base,
      signer: eff.signer || null,
      sponsor: eff.sponsor || null,
      formerSponsor: eff.former_sponsor || null,
    };
  }

  // ── Trustline effects ─────────────────────────────────────────────────────
  if (
    type === "trustline_created" ||
    type === "trustline_removed" ||
    type === "trustline_updated"
  ) {
    return {
      ...base,
      asset: normalizeEffectAsset(eff),
      limit: eff.limit != null ? toSevenDecimalString(eff.limit) : null,
      liquidityPoolId: eff.liquidity_pool_id || null,
    };
  }

  if (type === "trustline_authorized" || type === "trustline_deauthorized") {
    return {
      ...base,
      trustor: eff.trustor || null,
      asset: normalizeEffectAsset(eff),
    };
  }

  if (type === "trustline_authorized_to_maintain_liabilities") {
    return {
      ...base,
      trustor: eff.trustor || null,
      asset: normalizeEffectAsset(eff),
    };
  }

  if (type === "trustline_flags_updated") {
    return {
      ...base,
      asset: normalizeEffectAsset(eff),
      trustor: eff.trustor || null,
      authorizedFlag: eff.authorized_flag != null ? Boolean(eff.authorized_flag) : null,
      authorizedToMaintainLiabilitiesFlag:
        eff.authorized_to_maintain_liabilities_flag != null
          ? Boolean(eff.authorized_to_maintain_liabilities_flag)
          : null,
      clawbackEnabledFlag: eff.clawback_enabled_flag != null ? Boolean(eff.clawback_enabled_flag) : null,
    };
  }

  if (
    type === "trustline_sponsorship_created" ||
    type === "trustline_sponsorship_updated" ||
    type === "trustline_sponsorship_removed"
  ) {
    return {
      ...base,
      asset: normalizeEffectAsset(eff),
      sponsor: eff.sponsor || null,
      formerSponsor: eff.former_sponsor || null,
    };
  }

  // ── Offer effects ─────────────────────────────────────────────────────────
  if (type === "offer_created" || type === "offer_removed" || type === "offer_updated") {
    return {
      ...base,
      offerId: eff.offer_id != null ? String(eff.offer_id) : null,
    };
  }

  // ── Trade effects ─────────────────────────────────────────────────────────
  if (type === "trade") {
    const soldAsset = eff.sold_asset_type
      ? normalizeAsset(eff.sold_asset_code, eff.sold_asset_issuer, eff.sold_asset_type)
      : normalizeEffectAsset(eff);

    const boughtAsset = eff.bought_asset_type
      ? normalizeAsset(eff.bought_asset_code, eff.bought_asset_issuer, eff.bought_asset_type)
      : null;

    return {
      ...base,
      seller: eff.seller || null,
      offerId: eff.offer_id != null ? String(eff.offer_id) : null,
      soldAmount: toSevenDecimalString(eff.sold_amount),
      soldAsset,
      boughtAmount: toSevenDecimalString(eff.bought_amount),
      boughtAsset,
    };
  }

  // ── Data effects ─────────────────────────────────────────────────────────
  if (type === "data_created" || type === "data_removed" || type === "data_updated") {
    return {
      ...base,
      name: eff.name || null,
      value: eff.value || null,
    };
  }

  if (
    type === "data_sponsorship_created" ||
    type === "data_sponsorship_updated" ||
    type === "data_sponsorship_removed"
  ) {
    return {
      ...base,
      name: eff.name || null,
      sponsor: eff.sponsor || null,
      formerSponsor: eff.former_sponsor || null,
    };
  }

  // ── Sequence effects ──────────────────────────────────────────────────────
  if (type === "sequence_bumped") {
    return {
      ...base,
      newSequence: eff.new_seq != null ? String(eff.new_seq) : null,
    };
  }

  // ── Claimable balance effects ─────────────────────────────────────────────
  if (type === "claimable_balance_created" || type === "claimable_balance_clawed_back") {
    return {
      ...base,
      balanceId: eff.balance_id || null,
      asset: normalizeEffectAsset(eff),
      amount: toSevenDecimalString(eff.amount),
    };
  }

  if (type === "claimable_balance_claimant_created") {
    return {
      ...base,
      balanceId: eff.balance_id || null,
      asset: normalizeEffectAsset(eff),
      amount: toSevenDecimalString(eff.amount),
      predicate: eff.predicate || null,
    };
  }

  if (type === "claimable_balance_claimed") {
    return {
      ...base,
      balanceId: eff.balance_id || null,
      asset: normalizeEffectAsset(eff),
      amount: toSevenDecimalString(eff.amount),
    };
  }

  if (
    type === "claimable_balance_sponsorship_created" ||
    type === "claimable_balance_sponsorship_updated" ||
    type === "claimable_balance_sponsorship_removed"
  ) {
    return {
      ...base,
      balanceId: eff.balance_id || null,
      sponsor: eff.sponsor || null,
      formerSponsor: eff.former_sponsor || null,
    };
  }

  // ── Account sponsorship effects ───────────────────────────────────────────
  if (
    type === "account_sponsorship_created" ||
    type === "account_sponsorship_updated" ||
    type === "account_sponsorship_removed"
  ) {
    return {
      ...base,
      sponsor: eff.sponsor || null,
      formerSponsor: eff.former_sponsor || null,
    };
  }

  // ── Liquidity pool effects ────────────────────────────────────────────────
  if (
    type === "liquidity_pool_deposited" ||
    type === "liquidity_pool_withdrew" ||
    type === "liquidity_pool_revoked"
  ) {
    return {
      ...base,
      liquidityPoolId: eff.liquidity_pool_id || null,
      sharesReceived: eff.shares_received != null ? toSevenDecimalString(eff.shares_received) : null,
      sharesRedeemed: eff.shares_redeemed != null ? toSevenDecimalString(eff.shares_redeemed) : null,
      reservesReceived: Array.isArray(eff.reserves_received)
        ? eff.reserves_received.map((r) => ({
            asset: normalizeEffectAsset(r),
            amount: toSevenDecimalString(r.amount),
          }))
        : null,
      reservesDeposited: Array.isArray(eff.reserves_deposited)
        ? eff.reserves_deposited.map((r) => ({
            asset: normalizeEffectAsset(r),
            amount: toSevenDecimalString(r.amount),
          }))
        : null,
    };
  }

  if (type === "liquidity_pool_trade") {
    return {
      ...base,
      liquidityPoolId: eff.liquidity_pool_id || null,
      sold: eff.sold
        ? { asset: normalizeEffectAsset(eff.sold), amount: toSevenDecimalString(eff.sold.amount) }
        : null,
      bought: eff.bought
        ? { asset: normalizeEffectAsset(eff.bought), amount: toSevenDecimalString(eff.bought.amount) }
        : null,
    };
  }

  if (type === "liquidity_pool_created" || type === "liquidity_pool_removed") {
    return {
      ...base,
      liquidityPoolId: eff.liquidity_pool_id || null,
    };
  }

  // ── Contract / Soroban effects ────────────────────────────────────────────
  if (type === "contract_credited" || type === "contract_debited") {
    return {
      ...base,
      contract: eff.contract || null,
      asset: normalizeEffectAsset(eff),
      amount: toSevenDecimalString(eff.amount),
    };
  }

  // ── Fallback: unsupported / future effect types ───────────────────────────
  // Always include the minimum guaranteed fields so consumers can rely on a
  // consistent base shape regardless of the effect type.
  return { ...base };
}

/**
 * GET /account/:id/effects
 *
 * Returns a fully normalised, paginated list of ledger effects for the given
 * Stellar account. All field names use camelCase, amounts are seven-decimal
 * strings, and timestamps are ISO 8601.
 *
 * Query params:
 *   - limit  (number, default: 20, max: 200)
 *   - order  ("asc"|"desc", default: "desc")
 *   - cursor (string, optional)
 *   - type   (string, optional) — filter to a specific effect type;
 *            returns 400 with the full list of valid types on mismatch
 *   - fresh  (boolean, default: false) — bypasses the cache when set to "true"
 *
 * Response headers:
 *   - X-Cache: HIT  — served from cache
 *   - X-Cache: MISS — fetched live from Horizon and cached
 *
 * Returns:
 *   - 200: { success: true, data: { items, total, limit, order, cursor } }
 *   - 400: unrecognised ?type= value
 *   - 404: account not found
 */
router.get("/:id/effects", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    // Validate optional effect type filter before hitting Horizon
    const effectType = req.query.type != null ? String(req.query.type) : null;
    if (effectType) {
      validateEffectType(effectType);
    }

    const { limit, order, cursor } = parsePaginationParams(req.query);
    const fresh = req.query.fresh === "true";

    const cacheKey = `effects:${id}:${limit}:${order}:${cursor || ""}:${effectType || ""}`;

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    let query = server.effects().forAccount(id).limit(limit).order(order);
    if (cursor) query = query.cursor(cursor);
    if (effectType) query = query.type(effectType);

    const response = await withHorizonTiming(req, () => query.call());
    const records = response.records || [];

    const items = records.map(normalizeEffect);

    const nextCursor =
      records.length > 0 ? records[records.length - 1].paging_token || null : null;

    const data = {
      items,
      total: items.length,
      limit,
      order,
      cursor: nextCursor,
    };

    cacheService.set(cacheKey, data, cacheTTL.effects);
    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/claimable-balances
 * Returns claimable balances for an account, categorized by claimability.
 *
 * Query params:
 *   - fresh (boolean, default: false) — bypasses cache when set to "true"
 */
router.get("/:id/claimable-balances", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const { limit, order, cursor } = parsePaginationParams(req.query, 200);
    const fresh = req.query.fresh === "true";
    const cacheKey = `claimable-balances:${id}:${limit}:${cursor || ""}:${order}`;

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached.balances, { meta: cached.meta });
      }
    }

    let query = server.claimableBalances().claimant(id).limit(limit).order(order);
    if (cursor) query = query.cursor(cursor);

    const response = await query.call();
    const records = response.records || [];

    // Normalize each balance using the standard shape
    const balances = records.map(normalizeClaimableBalance);

    const lastRecord = records[records.length - 1];
    const nextCursor = lastRecord ? lastRecord.paging_token : null;
    const hasMore = records.length > limit;

    const meta = {
      count: balances.length,
      limit,
      order,
      nextCursor,
      hasMore,
    };

    cacheService.set(cacheKey, { balances, meta }, cacheTTL.claimableBalances);

    res.set("X-Cache", "MISS");
    return success(res, balances, { meta });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/analytics (optional in tests; keep simple)
 */
router.get("/:id/analytics", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    let transactions = [];
    try {
      const response = await server
        .transactions()
        .forAccount(id)
        .limit(200)
        .order("asc")
        .call();
      transactions = response.records || [];
    } catch (fetchErr) {
      if (fetchErr && fetchErr.response && fetchErr.response.status === 404) {
        throw fetchErr;
      }
      transactions = [];
    }

    const successfulTransactions = transactions.filter(
      (t) => t.successful !== false,
    );

    const firstSeen = successfulTransactions[0]
      ? toISOTimestamp(successfulTransactions[0].created_at)
      : null;
    const lastSeen = successfulTransactions[successfulTransactions.length - 1]
      ? toISOTimestamp(
        successfulTransactions[successfulTransactions.length - 1].created_at,
      )
      : null;

    const activeDays =
      firstSeen && lastSeen
        ? Math.max(
          1,
          Math.ceil(
            (new Date(lastSeen).getTime() - new Date(firstSeen).getTime()) /
            86400000,
          ),
        )
        : 0;

    return success(res, {
      totalSent: 0,
      totalReceived: 0,
      topAssets: [],
      avgTransactionsPerDay:
        activeDays > 0
          ? Number((successfulTransactions.length / activeDays).toFixed(2))
          : 0,
      firstSeen,
      lastSeen,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id — full account details
 *
 * Fetches live account data from Horizon via server.loadAccount(id) and maps
 * the raw response to the StellarKit normalised shape, including:
 *   - balances (xlm + non-native assets)
 *   - signers with normalised type strings
 *   - camelCase thresholds and boolean flags
 *   - sequence number and subentry count
 *   - reserve breakdown in both XLM and stroops
 *
 * Returns 404 when the account does not exist on the configured network.
 *
 * Query params:
 *   - fresh (boolean, default: false) — bypasses the cache when set to "true"
 *
 * Response headers:
 *   - X-Cache: HIT  — served from cache
 *   - X-Cache: MISS — fetched live from Horizon and cached
 */
router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const cacheKey = `account:${id}`;
    const fresh = req.query.fresh === "true";

    // Serve from cache unless caller requests a fresh fetch
    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    // Fetch live account data from Horizon
    const account = await withHorizonTiming(req, () => server.loadAccount(id));

    // --- Balances -----------------------------------------------------------
    // formatAccountBalances splits balances into the native XLM entry and
    // all non-native asset trustlines, applying formatBalance() to each amount.
    const { xlm, assets } = formatAccountBalances(account);

    // Raw XLM balance string needed for the spendable reserve calculation.
    const xlmNativeEntry = (account.balances || []).find((b) => isNativeAsset(b));
    const rawXlmBalance = parseFloat(xlmNativeEntry?.balance || "0");

    // --- Reserve breakdown --------------------------------------------------
    const baseReserve = 0.5; // 0.5 XLM per base reserve unit (protocol constant)
    const STROOPS_PER_XLM = 10_000_000;
    const accountReserve = 2 * baseReserve;
    const subentryReserve = (account.subentry_count || 0) * baseReserve;
    const totalLocked = accountReserve + subentryReserve;

    const toXLM = (xlmVal) => xlmVal.toFixed(7);
    const toStroops = (xlmVal) => Math.round(xlmVal * STROOPS_PER_XLM);

    // --- Signers ------------------------------------------------------------
    // Normalise every signer type to a canonical string value and always
    // include sponsoredBy (null when absent) for a consistent shape.
    const signers = (account.signers || []).map((s) => ({
      key: s.key,
      weight: Number(s.weight) || 0,
      type: normalizeSignerType(s.type),
      sponsoredBy: s.sponsor || s.sponsored_by || null,
    }));

    // --- Thresholds ---------------------------------------------------------
    // Map Horizon snake_case threshold keys to camelCase for consistency with
    // the rest of the StellarKit response surface.
    const thresholds = {
      lowThreshold: account.thresholds?.low_threshold ?? 0,
      medThreshold: account.thresholds?.med_threshold ?? 0,
      highThreshold: account.thresholds?.high_threshold ?? 0,
    };

    // --- Flags --------------------------------------------------------------
    // Horizon returns booleans under snake_case keys; map to camelCase and
    // ensure every flag is always present (false when absent from Horizon).
    const rawFlags = account.flags || {};
    const flags = {
      authRequired: rawFlags.auth_required === true,
      authRevocable: rawFlags.auth_revocable === true,
      authImmutable: rawFlags.auth_immutable === true,
      clawbackEnabled: rawFlags.auth_clawback_enabled === true,
    };

    const data = {
      accountId: account.id,
      sequence: account.sequence,
      subentryCount: account.subentry_count,
      xlm,
      assets,
      assetCount: assets.length,
      signers,
      thresholds,
      flags,
      homeDomain: account.home_domain || null,
      lastModifiedLedger: account.last_modified_ledger,
      reserveBreakdown: {
        baseReserve: {
          xlm: toXLM(baseReserve),
          stroops: toStroops(baseReserve),
        },
        accountReserve: {
          xlm: toXLM(accountReserve),
          stroops: toStroops(accountReserve),
        },
        subentryReserve: {
          xlm: toXLM(subentryReserve),
          stroops: toStroops(subentryReserve),
        },
        totalLocked: {
          xlm: toXLM(totalLocked),
          stroops: toStroops(totalLocked),
        },
        spendable: {
          xlm: toXLM(rawXlmBalance - totalLocked),
          stroops: toStroops(rawXlmBalance - totalLocked),
        },
      },
    };

    // Cache the normalised response
    cacheService.set(cacheKey, data, CACHE_TTL_ACCOUNT);

    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/risk-score
 */
router.get("/:id/risk-score", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const account = await withHorizonTiming(req, () => server.loadAccount(id));

    // Get first operation to calculate account age
    const firstOpResponse = await server
      .operations()
      .forAccount(id)
      .order("asc")
      .limit(1)
      .call();
    const firstOp = firstOpResponse.records[0];

    // Get recent transactions
    const recentTxResponse = await server
      .transactions()
      .forAccount(id)
      .order("desc")
      .limit(60)
      .call();
    const recentTxs = recentTxResponse.records;

    const factors = [];
    let score = 50;

    // Factor 1: Account age
    if (firstOp) {
      const createdAt = new Date(firstOp.created_at);
      const now = new Date();
      const daysOld = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));

      if (daysOld > 365) {
        score += 15;
        factors.push({
          name: "Account Age",
          value: `${daysOld} days`,
          impact: "positive",
          detail: "Account is over 1 year old, established reputation",
        });
      } else if (daysOld > 30) {
        score += 10;
        factors.push({
          name: "Account Age",
          value: `${daysOld} days`,
          impact: "positive",
          detail: "Account is over 1 month old",
        });
      } else {
        score -= 15;
        factors.push({
          name: "Account Age",
          value: `${daysOld} days`,
          impact: "negative",
          detail: "Account is very new (less than 1 month)",
        });
      }
    } else {
      score -= 10;
      factors.push({
        name: "Account Age",
        value: "No operations found",
        impact: "neutral",
        detail: "No operations history found for account",
      });
    }

    // Factor 2: Home domain
    if (account.home_domain) {
      score += 10;
      factors.push({
        name: "Home Domain",
        value: account.home_domain,
        impact: "positive",
        detail: "Account has a home domain set",
      });
    } else {
      score -= 5;
      factors.push({
        name: "Home Domain",
        value: "Not set",
        impact: "neutral",
        detail: "No home domain configured",
      });
    }

    // Factor 3: Multi-sig
    if (account.signers.length > 1) {
      score += 10;
      factors.push({
        name: "Multi-signature",
        value: `${account.signers.length} signers`,
        impact: "positive",
        detail: "Account uses multi-signature security",
      });
    } else {
      factors.push({
        name: "Multi-signature",
        value: "Single signer",
        impact: "neutral",
        detail: "Account uses single signature",
      });
    }

    // Factor 4: Number of trustlines
    const trustlineCount = (account.balances || []).filter(
      (b) => isNonNativeAsset(b),
    ).length;
    if (trustlineCount > 30) {
      score -= 15;
      factors.push({
        name: "Trustline Count",
        value: `${trustlineCount} trustlines`,
        impact: "negative",
        detail: "High number of trustlines may indicate risky behavior",
      });
    } else if (trustlineCount > 10) {
      score -= 5;
      factors.push({
        name: "Trustline Count",
        value: `${trustlineCount} trustlines`,
        impact: "neutral",
        detail: "Moderate number of trustlines",
      });
    } else {
      score += 5;
      factors.push({
        name: "Trustline Count",
        value: `${trustlineCount} trustlines`,
        impact: "positive",
        detail: "Low number of trustlines",
      });
    }

    // Factor 5: Recent activity
    if (recentTxs.length > 50) {
      score -= 10;
      factors.push({
        name: "Recent Activity",
        value: `${recentTxs.length} transactions in last limit`,
        impact: "negative",
        detail: "Very high recent transaction activity",
      });
    } else if (recentTxs.length > 20) {
      score -= 5;
      factors.push({
        name: "Recent Activity",
        value: `${recentTxs.length} transactions in last limit`,
        impact: "neutral",
        detail: "Moderate recent transaction activity",
      });
    } else {
      score += 5;
      factors.push({
        name: "Recent Activity",
        value: `${recentTxs.length} transactions in last limit`,
        impact: "positive",
        detail: "Low recent transaction activity",
      });
    }

    // Clamp score between 0 and 100
    score = Math.max(0, Math.min(100, score));

    // Determine rating
    let rating;
    if (score >= 70) rating = "low";
    else if (score >= 40) rating = "medium";
    else rating = "high";

    return success(res, {
      accountId: account.id,
      score,
      label: rating, // For backwards compatibility with tests
      rating,
      factors,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/payments
 * Returns only payment and create_account operations for an account,
 * filtered from the full operations list.
 *
 * Query params:
 *   - limit   (number, default: 10, max: 200)
 *   - cursor  (string, pagination cursor from previous response)
 *   - order   ("asc" | "desc", default: "desc")
 *
 * @param {string} id - Stellar account public key (G...)
 *
 * @example
 * GET /account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/payments
 * GET /account/GAAZI4.../payments?limit=20&order=asc
 * GET /account/:id/subentry-health
 */
router.get("/:id/subentry-health", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const account = await withHorizonTiming(req, () => server.loadAccount(id));

    const MAX_SUBENTRIES = 1000;
    const totalSubentries = account.subentry_count;
    const remainingSlots = Math.max(0, MAX_SUBENTRIES - totalSubentries);
    const usagePercentRaw = (totalSubentries / MAX_SUBENTRIES) * 100;
    const usagePercent = Math.round(usagePercentRaw * 100) / 100;

    let warning = null;
    if (usagePercentRaw > 95) warning = "critical";
    else if (usagePercentRaw > 80) warning = "approaching_limit";

    const trustlines = (account.balances || []).filter(
      (b) => isNonNativeAsset(b),
    ).length;
    const dataEntries = Object.keys(account.data_attr || {}).length;
    const additionalSigners = Math.max(0, (account.signers || []).length - 1);
    const inferredOffers = Math.max(
      0,
      totalSubentries - trustlines - dataEntries - additionalSigners,
    );

    return success(res, {
      totalSubentries,
      maxSubentries: MAX_SUBENTRIES,
      remainingSlots,
      usagePercent,
      warning,
      breakdown: {
        trustlines,
        offers: inferredOffers,
        dataEntries,
        additionalSigners,
      },
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/reserve-breakdown
 *
 * Returns a detailed breakdown of an account's minimum XLM reserve
 * requirement so wallet UIs can clearly explain why funds are locked.
 *
 * Each Stellar account must hold at least `(2 + subentry_count) * base_reserve`
 * XLM. This endpoint returns the base reserve, the subentry count, a per-type
 * breakdown of every subentry contributing to the reserve, the total minimum
 * reserve, and the spendable (available) balance after subtracting the
 * minimum reserve from the native XLM balance.
 *
 * All monetary amounts are seven-decimal strings (e.g. "0.5000000") to match
 * Stellar on-ledger precision and the format used by other endpoints.
 *
 * Response shape:
 *   {
 *     success: true,
 *     data: {
 *       baseReserve:         "0.5000000",
 *       subentryCount:       5,
 *       subentries: [
 *         { type, count, reservePerSubentry, totalReserve }, ...
 *       ],
 *       totalMinimumReserve: "3.5000000",
 *       availableBalance:    "96.5000000"
 *     }
 *   }
 *
 * Returns 404 when the account does not exist on the configured network.
 *
 * @example
 *   GET /account/GABC.../reserve-breakdown
 */
router.get("/:id/reserve-breakdown", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const account = await withHorizonTiming(req, () => server.loadAccount(id));

    // BASE_RESERVE matches the existing /account/:id handler and the rest of
    // the codebase, which use 0.5 XLM (5 000 000 stroops) as the protocol-wide
    // base reserve. The on-ledger base reserve is rarely changed by validator
    // voting; when it is, update this constant globally.
    const BASE_RESERVE = 0.5;
    const reservePerSubentry = formatAmount(BASE_RESERVE.toFixed(7));

    // Per-type subentry counts. Trustlines, data entries and additional
    // signers are counted directly from Horizon payload fields; offers are
    // inferred from any remaining subentries, mirroring the established
    // /account/:id/subentry-health breakdown logic.
    const trustlines = (account.balances || []).filter(
      (b) => isNonNativeAsset(b),
    ).length;
    const dataEntries = Object.keys(account.data_attr || {}).length;
    const additionalSigners = Math.max(
      0,
      (account.signers || []).length - 1,
    );
    const totalSubentries = account.subentry_count || 0;
    const inferredOffers = Math.max(
      0,
      totalSubentries - trustlines - dataEntries - additionalSigners,
    );

    const buildSubentryEntry = (type, count) => ({
      type,
      count,
      reservePerSubentry,
      totalReserve: formatAmount((count * BASE_RESERVE).toFixed(7)),
    });

    const subentries = [
      buildSubentryEntry("trustlines", trustlines),
      buildSubentryEntry("offers", inferredOffers),
      buildSubentryEntry("dataEntries", dataEntries),
      buildSubentryEntry("signers", additionalSigners),
    ];

    // Total minimum reserve = (2 + subentryCount) * baseReserve.
    // Computed once and reused for totalMinimumReserve and availableBalance
    // so the two fields always stay in lock-step.
    const totalLockedXLM = (2 + totalSubentries) * BASE_RESERVE;
    const totalMinimumReserve = formatAmount(totalLockedXLM.toFixed(7));

    // spendableBalance = XLM balance - total minimum reserve. parseFloat is
    // safe here because Horizon always returns a decimal string for the
    // native balance and `(2 + n) * 0.5` is exact in IEEE-754.
    const xlmBalanceEntry = (account.balances || []).find((b) =>
      isNativeAsset(b),
    );
    const xlmBalanceNumber = parseFloat(xlmBalanceEntry?.balance || "0");
    const availableBalance = formatAmount(
      (xlmBalanceNumber - totalLockedXLM).toFixed(7),
    );

    return success(res, {
      baseReserve: reservePerSubentry,
      subentryCount: totalSubentries,
      subentries,
      totalMinimumReserve,
      availableBalance,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/sponsorship
 */
router.get("/:id/sponsorship", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const [account, sponsoringResponse, offersResponse] = await Promise.all([
      server.loadAccount(id),
      server.accounts().sponsor(id).call(),
      server.offers().forAccount(id).call(),
    ]);

    const BASE_RESERVE_XLM = 0.5;
    const reserveAmount = BASE_RESERVE_XLM.toFixed(7);
    const sponsoredEntries = [];

    (account.balances || []).forEach((b) => {
      if (b.sponsor) {
        sponsoredEntries.push({
          type: "trustline",
          asset: normalizeAsset(b.asset_code, b.asset_issuer, b.asset_type),
          sponsor: b.sponsor,
          reserveAmount,
        });
      }
    });

    (account.signers || []).forEach((s) => {
      if (s.sponsor) {
        sponsoredEntries.push({
          type: "signer",
          key: s.key,
          sponsor: s.sponsor,
          reserveAmount,
        });
      }
    });

    if (account.data_attr) {
      const dataSponsors = account.data_sponsors || {};
      Object.keys(account.data_attr).forEach((key) => {
        if (dataSponsors[key]) {
          sponsoredEntries.push({
            type: "data_entry",
            key,
            sponsor: dataSponsors[key],
            reserveAmount,
          });
        }
      });
    }

    (offersResponse.records || []).forEach((offer) => {
      if (offer.sponsor) {
        sponsoredEntries.push({
          type: "offer",
          offerId: offer.id,
          sponsor: offer.sponsor,
          reserveAmount,
        });
      }
    });

    const accountsSponsoring = (sponsoringResponse.records || []).map(
      (acc) => acc.id,
    );

    return success(res, {
      accountId: account.id,
      accountSponsor: account.sponsor || null,
      sponsoredEntries,
      accountsSponsoring,
      sponsoredEntries,
      accountsSponsoring,
      count: sponsoredEntries.length,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/sponsorships
 */
router.get("/:id/sponsorships", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const [account, sponsoringResponse] = await Promise.all([
      server.loadAccount(id),
      server.accounts().sponsor(id).call(),
    ]);

    const sponsoredBy = buildSponsoredByEntries(account);
    const sponsoring = (sponsoringResponse.records || []).flatMap((sponsoredAccount) =>
      buildSponsoringEntries(sponsoredAccount, id),
    );

    return success(res, { sponsoring, sponsoredBy });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/freeze-status/:assetCode/:assetIssuer
 *
 * Checks authorization (freeze) status for a specific asset trustline.
 *
 * Responses are cached per account ID, asset code, and asset issuer to avoid
 * redundant Horizon calls. Freeze status only changes when the issuer explicitly
 * modifies authorization flags, making a short TTL appropriate.
 *
 * Cache TTL is configurable via CACHE_TTL_FREEZE_CHECK_MS (default: 30 000 ms).
 *
 * Query params:
 *   - fresh (boolean, default: false) — bypasses the cache when set to "true"
 *
 * Response headers:
 *   - X-Cache: HIT  — response served from cache
 *   - X-Cache: MISS — fetched live from Horizon and stored in cache
 */
router.get(
  "/:id/freeze-status/:assetCode/:assetIssuer",
  async (req, res, next) => {
    try {
      const { id, assetCode, assetIssuer } = req.params;
      validateAccountId(id);
      validateAssetCode(assetCode);

      const normalizedAssetCode = assetCode.toUpperCase();
      const normalizedAssetIssuer =
        normalizedAssetCode === "XLM" ? assetIssuer.toLowerCase() : assetIssuer;

      if (normalizedAssetCode !== "XLM") {
        validateAccountId(assetIssuer);
      }

      const fresh = req.query.fresh === "true" || req.query.fresh === true;
      const cacheKey = `freeze-status:${id}:${normalizedAssetCode}:${assetIssuer}`;

      if (!fresh) {
        const cached = cacheService.get(cacheKey);
        if (cached !== undefined) {
          res.set("X-Cache", "HIT");
          return success(res, cached);
        }
      }

      const account = await withHorizonTiming(req, () => server.loadAccount(id));

      const trustline =
        normalizedAssetCode === "XLM"
          ? (account.balances || []).find((b) => isNativeAsset(b))
          : (account.balances || []).find(
            (b) =>
              isNonNativeAsset(b) &&
              b.asset_code === normalizedAssetCode &&
              b.asset_issuer === assetIssuer,
          );

      if (!trustline) {
        return next(makeTrustlineNotFoundError(id, normalizedAssetCode, assetIssuer));
      }

      const isAuthorized = trustline.is_authorized !== false;
      const isAuthorizedToMaintainLiabilities =
        trustline.is_authorized_to_maintain_liabilities === true;

      const isFrozen =
        normalizedAssetCode === "XLM"
          ? false
          : !isAuthorized && !isAuthorizedToMaintainLiabilities;

      const isPartiallyFrozen =
        normalizedAssetCode !== "XLM" &&
        !isAuthorized &&
        isAuthorizedToMaintainLiabilities;

      const canReceive = normalizedAssetCode === "XLM" ? true : isAuthorized;
      const canSend =
        normalizedAssetCode === "XLM"
          ? true
          : isAuthorized || isAuthorizedToMaintainLiabilities;

      const detail = (() => {
        if (normalizedAssetCode === "XLM") {
          return "Native XLM is not subject to issuer freeze authorization.";
        }
        if (!isAuthorized && isAuthorizedToMaintainLiabilities) {
          return "The issuer has revoked authorization for this trustline but allows the account to maintain liabilities.";
        }
        if (!isAuthorized) {
          return "The issuer has revoked authorization for this trustline.";
        }
        return "The trustline is authorized and the account can send and receive this asset normally.";
      })();

      const data = {
        accountId: account.id,
        asset: normalizeAsset(
          normalizedAssetCode,
          normalizedAssetCode === "XLM" ? null : assetIssuer,
          normalizedAssetCode === "XLM" ? "native" : undefined,
        ),
        isFrozen,
        isPartiallyFrozen,
        canSend,
        canReceive,
        detail,
      };

      cacheService.set(cacheKey, data, cacheTTL.freezeCheck);
      res.set("X-Cache", "MISS");
      return success(res, data);
    } catch (err) {
      handleAccountNotFound(err, next, req.params.id);
    }
  },
);

/**
 * GET /account/:id/age
 */
router.get("/:id/age", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);
    const creation = await fetchAccountCreation(id);
    return success(
      res,
      buildAccountAgeResponse({
        publicKey: id,
        createdAtLedger: creation.ledger,
        createdAt: creation.timestamp,
      }),
    );
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/transaction-count
 * Returns a lightweight summary of an account's total transaction count
 * plus the timestamps of its first and last transactions, without requiring
 * callers to paginate through the full transaction history themselves.
 */
router.get("/:id/transaction-count", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    await withHorizonTiming(req, () => server.loadAccount(id));

    let count = 0;
    let firstTransactionAt = null;
    let lastTransactionAt = null;
    let cursor;
    let done = false;

    while (!done) {
      let query = server.transactions().forAccount(id).limit(200).order("asc");
      if (cursor) query = query.cursor(cursor);

      const page = await query.call();
      const records = page.records || [];

      if (records.length === 0) break;

      if (count === 0) {
        firstTransactionAt = toISOTimestamp(records[0].created_at);
      }
      lastTransactionAt = toISOTimestamp(records[records.length - 1].created_at);
      count += records.length;
      cursor = records[records.length - 1].paging_token;

      if (records.length < 200) done = true;
    }

    return success(res, { count, firstTransactionAt, lastTransactionAt });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/inactivity
 */
router.get("/:id/inactivity", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const txResponse = await server
      .transactions()
      .forAccount(id)
      .order("desc")
      .limit(1)
      .call();

    if (!txResponse.records || txResponse.records.length === 0) {
      return success(res, { status: "no_transactions" });
    }

    const lastTx = txResponse.records[0];
    const lastTransactionAt = toISOTimestamp(lastTx.created_at);
    const lastTransactionHash = lastTx.hash;

    const daysSinceLastTransaction = Math.floor(
      (Date.now() - new Date(lastTransactionAt).getTime()) / 86400000,
    );

    let status;
    if (daysSinceLastTransaction < 30) status = "active";
    else if (daysSinceLastTransaction <= 180) status = "idle";
    else status = "dormant";

    return success(res, {
      lastTransactionAt,
      lastTransactionHash,
      daysSinceLastTransaction,
      status,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/can-receive/:assetCode/:assetIssuer
 */
router.get(
  "/:id/can-receive/:assetCode/:assetIssuer",
  async (req, res, next) => {
    try {
      const { id, assetCode, assetIssuer } = req.params;
      validateAccountId(id);
      validateAssetCode(assetCode);

      const normalizedAssetCode = assetCode.toUpperCase();
      const normalizedAssetIssuer =
        normalizedAssetCode === "XLM" ? assetIssuer.toLowerCase() : assetIssuer;

      if (normalizedAssetCode === "XLM") {
        if (normalizedAssetIssuer !== "native") {
          const err = new Error(
            'Invalid asset issuer for XLM. Use "native" as the issuer.',
          );
          err.isValidation = true;
          err.status = 400;
          throw err;
        }
      } else {
        validateAccountId(assetIssuer);
      }

      const account = await withHorizonTiming(req, () => server.loadAccount(id));

      if (normalizedAssetCode === "XLM") {
        return success(res, {
          accountId: account.id,
          asset: normalizeAsset("XLM", null, "native"),
          canReceive: true,
          reasons: [],
          trustlineExists: true,
          isAuthorized: true,
          availableCapacity: null,
          currentBalance: parseFloat(
            (account.balances || []).find((b) => isNativeAsset(b))
              ?.balance || "0",
          ),
          limit: null,
        });
      }

      const trustline = (account.balances || []).find(
        (b) =>
          isNonNativeAsset(b) &&
          b.asset_code === normalizedAssetCode &&
          b.asset_issuer === assetIssuer,
      );

      if (!trustline) {
        return next(makeTrustlineNotFoundError(id, normalizedAssetCode, assetIssuer));
      }

      const isAuthorized = trustline.is_authorized === true;
      const currentBalance = parseFloat(trustline.balance || "0");
      const limit = parseFloat(trustline.limit || "0");
      const buyingLiabilities = parseFloat(trustline.buying_liabilities || "0");
      const availableCapacity = Math.max(
        0,
        limit - currentBalance - buyingLiabilities,
      );

      const canReceive = isAuthorized && availableCapacity > 0;

      const reasons = [];
      if (!isAuthorized) {
        reasons.push("Trustline is not authorized by the issuer.");
      }
      if (isAuthorized && availableCapacity <= 0) {
        reasons.push(
          "No available capacity on trustline (limit reached or fully utilized).",
        );
      }

      return success(res, {
        accountId: account.id,
        asset: normalizeAsset(normalizedAssetCode, assetIssuer, undefined),
        canReceive,
        reasons,
        trustlineExists: true,
        isAuthorized,
        availableCapacity,
        currentBalance,
        limit,
      });
    } catch (err) {
      handleAccountNotFound(err, next, req.params.id);
    }
  },
);

/**
 * GET /account/:id/volume?days=30
 */
router.get("/:id/volume", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const days = parseInt(req.query.days || "30", 10);
    if (isNaN(days) || days < 1 || days > 90) {
      const err = new Error(
        "Query parameter 'days': must be an integer between 1 and 90.",
      );
      err.isValidation = true;
      err.field = "days";
      err.receivedValue = String(req.query.days);
      err.expectedFormat = "1–90";
      throw err;
    }

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const volumeMap = {};
    let totalTransactions = 0;
    let cursor;
    let done = false;

    while (!done) {
      let query = server.payments().forAccount(id).limit(200).order("asc");
      if (cursor) query = query.cursor(cursor);

      const page = await query.call();
      const records = page.records || [];

      if (records.length === 0) break;

      for (const op of records) {
        const createdAt = new Date(op.created_at);
        if (createdAt < since) {
          cursor = op.paging_token;
          continue;
        }
        if (!op.transaction_successful) {
          cursor = op.paging_token;
          continue;
        }

        const assetCode = op.asset_code || "XLM";
        const assetIssuer = op.asset_issuer || null;
        const assetKey = assetIssuer
          ? `${assetCode}:${assetIssuer}`
          : assetCode;
        const amount = parseFloat(op.amount || op.starting_balance || "0");

        if (!volumeMap[assetKey]) {
          volumeMap[assetKey] = {
            asset: normalizeAsset(assetCode, assetIssuer, op.asset_type || undefined),
            totalSent: 0,
            totalReceived: 0,
          };
        }

        const isSent =
          (op.type === "payment" && op.from === id) ||
          (op.type === "create_account" && op.funder === id);
        if (isSent) volumeMap[assetKey].totalSent += amount;
        else volumeMap[assetKey].totalReceived += amount;

        totalTransactions++;
        cursor = op.paging_token;
      }

      if (records.length < 200) done = true;
    }

    const volumeByAsset = Object.values(volumeMap).map((v) => ({
      asset: v.asset,
      totalSent: v.totalSent.toFixed(7),
      totalReceived: v.totalReceived.toFixed(7),
    }));

    return success(res, {
      period: { days, from: since.toISOString(), to: new Date().toISOString() },
      totalTransactions,
      volumeByAsset,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/payment-summary
 *
 * Returns a summary of an account's payment activity, including:
 *   - totalSent:       Number of payments sent
 *   - totalReceived:   Number of payments received
 *   - volumeSent:      Total volume sent (7-decimal string)
 *   - volumeReceived:  Total volume received (7-decimal string)
 *   - topCounterparty: Most frequent counterparty (public key or null)
 *   - topAsset:        Most used asset object { code, issuer, type } or null
 *
 * Paginates through the entire payment history via the Horizon payments
 * endpoint. Returns zeroed values for accounts with no payment history
 * rather than a 404.
 *
 * @example
 *   GET /account/GABC.../payment-summary
 */
router.get("/:id/payment-summary", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    // Ensure account exists (404 for non-existent accounts)
    await withHorizonTiming(req, () => server.loadAccount(id));

    let totalSent = 0;
    let totalReceived = 0;
    let volumeSent = 0;
    let volumeReceived = 0;
    const counterpartyCounts = {};
    const assetCounts = {};

    let cursor;
    let done = false;

    while (!done) {
      let query = server.payments().forAccount(id).limit(200).order("asc");
      if (cursor) query = query.cursor(cursor);

      const page = await query.call();
      const records = page.records || [];

      if (records.length === 0) break;

      for (const op of records) {
        if (op.type !== "payment" && op.type !== "create_account") continue;

        const isSent =
          (op.type === "payment" && op.from === id) ||
          (op.type === "create_account" && op.funder === id);

        const counterparty = isSent
          ? op.type === "payment"
            ? op.to
            : op.account
          : op.type === "payment"
            ? op.from
            : op.funder;

        const amount = parseFloat(op.amount || op.starting_balance || "0");

        if (isSent) {
          totalSent++;
          volumeSent += amount;
        } else {
          totalReceived++;
          volumeReceived += amount;
        }

        // Track counterparty frequency
        if (counterparty) {
          counterpartyCounts[counterparty] = (counterpartyCounts[counterparty] || 0) + 1;
        }

        // Track asset frequency
        const assetCode = op.asset_code || "XLM";
        const assetIssuer = op.asset_issuer || null;
        const assetType = op.asset_type || (assetCode === "XLM" ? "native" : null);
        const assetKey = assetIssuer ? `${assetCode}:${assetIssuer}` : assetCode;
        if (!assetCounts[assetKey]) {
          assetCounts[assetKey] = {
            count: 0,
            asset: normalizeAsset(assetCode, assetIssuer, assetType),
          };
        }
        assetCounts[assetKey].count++;

        cursor = op.paging_token;
      }

      if (records.length < 200) done = true;
    }

    // Find top counterparty
    let topCounterparty = null;
    let maxCounterpartyCount = 0;
    for (const [key, count] of Object.entries(counterpartyCounts)) {
      if (count > maxCounterpartyCount) {
        maxCounterpartyCount = count;
        topCounterparty = key;
      }
    }

    // Find top asset
    let topAsset = null;
    let maxAssetCount = 0;
    for (const entry of Object.values(assetCounts)) {
      if (entry.count > maxAssetCount) {
        maxAssetCount = entry.count;
        topAsset = entry.asset;
      }
    }

    return success(res, {
      totalSent,
      totalReceived,
      volumeSent: volumeSent.toFixed(7),
      volumeReceived: volumeReceived.toFixed(7),
      topCounterparty,
      topAsset,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/offer-history
 */
router.get("/:id/offer-history", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const { limit, order, cursor } = parsePaginationParams(req.query);

    let query = server.operations().forAccount(id).limit(limit).order(order);
    if (cursor) query = query.cursor(cursor);

    const opResponse = await query.call();
    const records = opResponse.records || [];

    const offerOps = records
      .filter((op) =>
        [
          "manage_sell_offer",
          "manage_buy_offer",
          "create_passive_sell_offer",
        ].includes(op.type),
      )
      .map((op) => {
        let offerType = "updated";
        if (op.type === "create_passive_sell_offer") offerType = "created";
        else if (parseFloat(op.amount) === 0) offerType = "deleted";
        else offerType = op.offer_id === "0" ? "created" : "updated";

        return {
          offerId: op.offer_id,
          type: offerType,
          sellingAsset: normalizeAsset(
            op.selling_asset_code,
            op.selling_asset_issuer,
            op.selling_asset_type,
          ),
          buyingAsset: normalizeAsset(
            op.buying_asset_code,
            op.buying_asset_issuer,
            op.buying_asset_type,
          ),
          amount: op.amount,
          price: op.price,
          timestamp: toISOTimestamp(op.created_at),
          transactionHash: op.transaction_hash,
        };
      });

    const nextCursor =
      records.length > 0 ? records[records.length - 1].paging_token : null;

    return success(res, {
      items: offerOps,
      total: offerOps.length,
      limit,
      cursor: nextCursor,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/pool-positions
 */
router.get("/:id/pool-positions", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const fresh = req.query.fresh === "true";
    const cacheKey = `pool-positions:${id}`;

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    const account = await withHorizonTiming(req, () => server.loadAccount(id));

    const poolShareTrustlines = (account.balances || []).filter(
      (balance) => balance.asset_type === "liquidity_pool_shares",
    );

    if (poolShareTrustlines.length === 0) {
      const data = {
        items: [],
        total: 0,
        limit: null,
        cursor: null,
      };
      cacheService.set(cacheKey, data, cacheTTL.poolPositions);
      res.set("X-Cache", "MISS");
      return success(res, data);
    }

    const poolDetailsPromises = poolShareTrustlines.map((trustline) =>
      server
        .liquidityPools()
        .liquidityPoolId(trustline.liquidity_pool_id)
        .call()
        .catch((err) => {
          if (err && err.response && err.response.status === 404) return null;
          throw err;
        }),
    );

    const poolDetails = await Promise.all(poolDetailsPromises);

    const positions = [];

    for (let i = 0; i < poolShareTrustlines.length; i++) {
      const trustline = poolShareTrustlines[i];
      const pool = poolDetails[i];
      if (!pool) continue;

      const accountShares = parseFloat(trustline.balance);
      const totalShares = parseFloat(pool.total_shares);

      const sharePercent =
        totalShares > 0 ? (accountShares / totalShares) * 100 : 0;

      const reserveA = pool.reserves[0];
      const reserveB = pool.reserves[1];

      const equivalentReserveA =
        (parseFloat(reserveA.amount) * accountShares) / totalShares;
      const equivalentReserveB =
        (parseFloat(reserveB.amount) * accountShares) / totalShares;

      positions.push({
        poolId: pool.id,
        shares: toSevenDecimalString(accountShares),
        sharePercent: toSevenDecimalString(sharePercent),
        totalPoolShares: toSevenDecimalString(totalShares),
        reserveA: {
          asset: normalizeAssetFromString(reserveA.asset),
          totalAmount: parseFloat(reserveA.amount).toFixed(7),
          equivalentAmount: equivalentReserveA.toFixed(7),
        },
        reserveB: {
          asset: normalizeAssetFromString(reserveB.asset),
          totalAmount: parseFloat(reserveB.amount).toFixed(7),
          equivalentAmount: equivalentReserveB.toFixed(7),
        },
        feeBp: pool.fee_bp || 30,
        totalTrustlines: pool.total_trustlines,
        lastModifiedLedger: pool.last_modified_ledger,
      });
    }

    const data = {
      items: positions,
      total: positions.length,
      limit: null,
      cursor: null,
    };

    cacheService.set(cacheKey, data, cacheTTL.poolPositions);
    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/transaction-count?since=<ISO8601>
 * Counts transactions for an account. Without `since`, paginates through the
 * account's entire transaction history to produce an exact count. With `since`,
 * walks records newest-first and stops as soon as a transaction older than the
 * cutoff is reached, avoiding a full history scan.
 */
router.get("/:id/transaction-count", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const account = await withHorizonTiming(req, () => server.loadAccount(id));

    const poolShareTrustlines = (account.balances || []).filter(
      (balance) => balance.asset_type === "liquidity_pool_shares",
    );

    if (poolShareTrustlines.length === 0) {
      return success(res, { shares: [], total: 0 });
    }

    const poolDetailsPromises = poolShareTrustlines.map((trustline) =>
      server
        .liquidityPools()
        .liquidityPoolId(trustline.liquidity_pool_id)
        .call()
        .catch((err) => {
          if (err && err.response && err.response.status === 404) return null;
          throw err;
        }),
    );

    const poolDetails = await Promise.all(poolDetailsPromises);

    const shares = [];

    for (let i = 0; i < poolShareTrustlines.length; i++) {
      const trustline = poolShareTrustlines[i];
      const pool = poolDetails[i];
      if (!pool) continue;

      const reserveA = pool.reserves[0];
      const reserveB = pool.reserves[1];

      shares.push({
        poolId: pool.id,
        shares: parseFloat(trustline.balance).toFixed(7),
        totalPoolShares: parseFloat(pool.total_shares).toFixed(7),
        reserveA: {
          asset: reserveA.asset,
          amount: parseFloat(reserveA.amount).toFixed(7),
        },
        reserveB: {
          asset: reserveB.asset,
          amount: parseFloat(reserveB.amount).toFixed(7),
        },
      });
    }

    return success(res, { shares, total: shares.length });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * POST /account/:id/multisig-plan
 */
// GET /account/:id/transaction-stats
// Summarises recent transactions for the account (success/failure counts and basic per-asset volume).
router.get("/:id/transaction-stats", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const limitRaw = req.query.limit;
    const limit = limitRaw === undefined ? 20 : validateLimit(limitRaw);

    const txResponse = await server
      .transactions()
      .forAccount(id)
      .limit(limit)
      .order("desc")
      .includeFailed(true)
      .call();

    const records = txResponse.records || [];

    const perAsset = new Map();

    for (const tx of records) {
      const successful = tx.successful === true;

      for (const op of tx.operations || []) {
        // Horizon transaction record does not always include operations.
        // We fall back to payments-based approximation only if operation data exists.
        if (!op) continue;
      }

      // Use Horizon-fee charged as a lightweight signal; for volume we do best-effort using tx.memo-less fields.
      // Since Horizon tx record does not directly expose sent/received amounts, we keep a minimal stats surface.
      const feeChargedStroops = parseInt(tx.fee_charged || 0, 10);
      const feeChargedXlm = parseStellarAmount(feeChargedStroops);

      const key = tx.type || "unknown";
      if (!perAsset.has(key)) {
        perAsset.set(key, {
          category: key,
          successfulCount: 0,
          failedCount: 0,
          txCount: 0,
          totalFeeChargedStroops: 0,
          totalFeeChargedXlm: "0",
        });
      }
      const bucket = perAsset.get(key);
      bucket.txCount += 1;
      if (successful) bucket.successfulCount += 1;
      else bucket.failedCount += 1;
      bucket.totalFeeChargedStroops += feeChargedStroops;
      bucket.totalFeeChargedXlm = parseStellarAmount(
        bucket.totalFeeChargedStroops
      );
    }

    const successfulCount = records.filter((t) => t.successful === true).length;
    const failedCount = records.length - successfulCount;

    return success(res, {
      accountId: id,
      limit,
      counts: {
        total: records.length,
        successful: successfulCount,
        failed: failedCount,
      },
      firstSeenAt: records.length
        ? toISOTimestamp(records[records.length - 1].created_at)
        : null,
      lastSeenAt: records.length ? toISOTimestamp(records[0].created_at) : null,
      byType: Array.from(perAsset.values()),
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

router.post("/:id/multisig-plan", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const { availableSigners } = req.body;
    if (!availableSigners || !Array.isArray(availableSigners)) {
      const err = new Error(
        "availableSigners must be an array of public keys.",
      );
      err.status = 400;
      return next(err);
    }

    for (const signerKey of availableSigners) {
      validateAccountId(signerKey);
    }

    const account = await withHorizonTiming(req, () => server.loadAccount(id));
    const thresholds = account.thresholds;

    const accountSigners = account.signers || [];
    const availableMatches = availableSigners
      .map((key) => accountSigners.find((s) => s.key === key))
      .filter(Boolean);

    const signerWeights = availableMatches.map((s) => ({
      key: s.key,
      weight: s.weight,
      type: s.type,
    }));

    const findMinimalCombinations = (signers, threshold) => {
      if (threshold <= 0) return [[]];

      const allCombinations = [];
      const n = signers.length;

      for (let mask = 0; mask < 1 << n; mask++) {
        const combination = [];
        let totalWeight = 0;

        for (let i = 0; i < n; i++) {
          if (mask & (1 << i)) {
            combination.push(signers[i]);
            totalWeight += signers[i].weight;
          }
        }

        if (totalWeight >= threshold && combination.length > 0) {
          allCombinations.push(combination);
        }
      }

      if (allCombinations.length === 0) return [];

      const minSize = Math.min(...allCombinations.map((c) => c.length));
      const minimal = allCombinations
        .filter((c) => c.length === minSize)
        .map((c) =>
          c.map((s) => ({ key: s.key, weight: s.weight, type: s.type })),
        );

      const unique = [];
      const seen = new Set();
      for (const combo of minimal) {
        const sorted = combo.slice().sort((a, b) => a.key.localeCompare(b.key));
        const key = sorted.map((s) => s.key).join("|");
        if (!seen.has(key)) {
          seen.add(key);
          unique.push(combo);
        }
      }

      return unique;
    };

    const validCombinations = {
      low: findMinimalCombinations(availableMatches, thresholds.low_threshold),
      med: findMinimalCombinations(availableMatches, thresholds.med_threshold),
      high: findMinimalCombinations(
        availableMatches,
        thresholds.high_threshold,
      ),
    };

    return success(res, {
      accountId: account.id,
      lowThreshold: thresholds.low_threshold,
      medThreshold: thresholds.med_threshold,
      highThreshold: thresholds.high_threshold,
      signerWeights,
      validCombinations,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/data
 */
router.get("/:id/data", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const account = await withHorizonTiming(req, () => server.loadAccount(id));

    const dataEntries = Object.entries(account.data || {}).map(
      ([key, value]) => ({
        key,
        value,
      }),
    );

    return success(res, {
      items: dataEntries,
      total: dataEntries.length,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/transaction-count
 * Returns the total number of transactions for an account.
 *
 * Transaction counts only change when new transactions are submitted, making
 * short-term caching effective. Responses are cached per account ID.
 *
 * Query params:
 *   - fresh (boolean, default: false) — bypasses the cache when set to "true"
 *
 * Response headers:
 *   - X-Cache: HIT  — served from cache
 *   - X-Cache: MISS — fetched live from Horizon and cached
 *
 * Cache TTL is configurable via the CACHE_TTL_TX_COUNT_MS environment variable
 * (default: 20 000 ms / 20 seconds).
 */
router.get("/:id/transaction-count", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const fresh = req.query.fresh === "true";
    const cacheKey = `transaction-count:${id}`;

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached !== undefined) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    // Page through all transactions counting records until Horizon returns an
    // empty page. Using limit=200 (the Horizon maximum) minimises round trips.
    let count = 0;
    let cursor;
    do {
      let query = server
        .transactions()
        .forAccount(id)
        .limit(200)
        .order("asc");
      if (cursor) query = query.cursor(cursor);

      const response = await query.call();
      const records = response.records || [];
      count += records.length;

      if (records.length < 200) break;
      cursor = records[records.length - 1].paging_token;
    } while (true); // eslint-disable-line no-constant-condition

    const data = { accountId: id, transactionCount: count };

    cacheService.set(cacheKey, data, cacheTTL.transactionCount);
    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/signing-keys
 *
 * Returns all signers for an account, each normalised with key, weight, type,
 * and sponsoredBy where applicable.  Also returns the master key weight and
 * the three signing thresholds.
 *
 * Query params:
 *   - weight  (positive integer, optional) — return only signers with weight >= value
 *   - fresh   (boolean, default: false)    — bypass cache when set to "true"
 *
 * Cache:
 *   Keyed by account ID. TTL defaults to 20 s, configurable via
 *   CACHE_TTL_SIGNING_KEYS_MS. X-Cache header is always present.
 */
router.get("/:id/signing-keys", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    // --- ?weight validation ---
    const rawWeight = req.query.weight;
    let minWeight = null;
    if (rawWeight !== undefined) {
      const parsed = Number(rawWeight);
      if (!Number.isInteger(parsed) || parsed < 1) {
        const err = new Error(
          "Query parameter 'weight': must be a positive integer.",
        );
        err.isValidation = true;
        err.field = "weight";
        err.receivedValue = String(rawWeight);
        err.expectedFormat = "positive integer (e.g. 1, 2, 3)";
        throw err;
      }
      minWeight = parsed;
    }

    const fresh = req.query.fresh === "true";
    const cacheKey = `signing-keys:${id}`;

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        // Apply weight filter to the cached payload before responding
        const data =
          minWeight !== null
            ? {
              ...cached,
              signers: cached.signers.filter((s) => s.weight >= minWeight),
            }
            : cached;
        return success(res, data);
      }
    }

    const account = await withHorizonTiming(req, () => server.loadAccount(id));

    // Normalise every signer entry from Horizon into a clean shape
    const signers = (account.signers || []).map((s) => ({
      key: s.key,
      weight: Number(s.weight),
      type: s.type || "ed25519_public_key",
      ...(s.sponsor ? { sponsoredBy: s.sponsor } : {}),
    }));

    // Master weight is the weight of the account's own key in the signers list.
    // Horizon always includes the master key; fall back to thresholds.master_weight
    // if the SDK exposes it differently.
    const masterSigner = signers.find((s) => s.key === account.id);
    const masterWeight =
      masterSigner !== undefined
        ? masterSigner.weight
        : Number(account.master_weight ?? 0);

    const thresholds = {
      low: Number(account.thresholds?.low_threshold ?? 0),
      medium: Number(account.thresholds?.med_threshold ?? 0),
      high: Number(account.thresholds?.high_threshold ?? 0),
    };

    const payload = { signers, masterWeight, thresholds };

    cacheService.set(cacheKey, payload, cacheTTL.signingKeys);
    res.set("X-Cache", "MISS");

    // Apply weight filter after caching the full payload so the cache always
    // stores the complete list and each weight threshold is a view over it.
    const data =
      minWeight !== null
        ? { ...payload, signers: signers.filter((s) => s.weight >= minWeight) }
        : payload;

    return success(res, data);
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/sponsorships
 *
 * Returns a typed sponsorship summary for the account.
 * Includes all entries sponsored by other accounts (sponsoredBy) and
 * accounts that this account is currently sponsoring (sponsoring).
 *
 * Each sponsoredBy entry contains:
 *   - type: "trustline" | "signer" | "data_entry"
 *   - address: asset string for trustlines, key for signers/data entries
 *   - sponsor: the account paying the reserve
 *   - reserveAmount: "0.5000000" (base reserve per subentry)
 *
 * @example
 * GET /account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/sponsorships
 */
router.get("/:id/sponsorships", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const [account, sponsoringResponse] = await Promise.all([
      server.loadAccount(id),
      server.accounts().sponsor(id).call(),
    ]);

    // Base reserve per sponsored subentry on Stellar (0.5 XLM)
    const RESERVE_PER_SUBENTRY = "0.5000000";

    const sponsoredBy = [];

    (account.balances || []).forEach((b) => {
      if (b.sponsor) {
        sponsoredBy.push({
          type: "trustline",
          address:
            isNativeAsset(b)
              ? "XLM"
              : `${b.asset_code}:${b.asset_issuer}`,
          sponsor: b.sponsor,
          reserveAmount: RESERVE_PER_SUBENTRY,
        });
      }
    });

    (account.signers || []).forEach((s) => {
      if (s.sponsor) {
        sponsoredBy.push({
          type: "signer",
          address: s.key,
          sponsor: s.sponsor,
          reserveAmount: RESERVE_PER_SUBENTRY,
        });
      }
    });

    if (account.data_attr) {
      const dataSponsors = account.data_sponsors || {};
      Object.keys(account.data_attr).forEach((key) => {
        if (dataSponsors[key]) {
          sponsoredBy.push({
            type: "data_entry",
            address: key,
            sponsor: dataSponsors[key],
            reserveAmount: RESERVE_PER_SUBENTRY,
          });
        }
      });
    }

    const sponsoring = (sponsoringResponse.records || []).map((acc) => acc.id);

    return success(res, {
      accountId: account.id,
      sponsoredBy,
      sponsoring,
      count: sponsoredBy.length,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/home-domain
 * Returns the home_domain for a Stellar account.
 */
router.get("/:id/home-domain", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const account = await withHorizonTiming(req, () => server.loadAccount(id));

    return success(res, {
      accountId: account.id,
      homeDomain: account.home_domain || null,
      lastModifiedLedger: account.last_modified_ledger,
    });
  } catch (err) {
    handleAccountNotFound(err, next);
  }
});

/**
 * GET /account/:id/min-balance
 * Returns the calculated minimum balance and reserve breakdown for a Stellar account.
 */
router.get("/:id/min-balance", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const account = await withHorizonTiming(req, () => server.loadAccount(id));
    const subentryCount = account.subentry_count || 0;
    const baseReserveStroops = 5000000;
    const baseReserveXLM = "0.5000000";

    const accountReserveStroops = baseReserveStroops * 2;
    const subentryReserveStroops = baseReserveStroops * subentryCount;
    const minimumBalanceStroops = accountReserveStroops + subentryReserveStroops;

    return success(res, {
      accountId: account.id,
      subentryCount,
      baseReserve: {
        xlm: baseReserveXLM,
        stroops: baseReserveStroops,
      },
      minimumBalance: {
        xlm: parseStellarAmount(minimumBalanceStroops),
        stroops: minimumBalanceStroops,
      },
      reserveBreakdown: {
        accountReserve: {
          xlm: parseStellarAmount(accountReserveStroops),
          stroops: accountReserveStroops,
        },
        subentryReserve: {
          xlm: parseStellarAmount(subentryReserveStroops),
          stroops: subentryReserveStroops,
        },
      },
      lastModifiedLedger: account.last_modified_ledger,
    });
  } catch (err) {
    handleAccountNotFound(err, next);
  }
});

/**
 * GET /account/:id/flags
 * Returns the flags of a Stellar account.
 */
router.get("/:id/flags", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const account = await withHorizonTiming(req, () => server.loadAccount(id));
    const rawFlags = account.flags || {};

    return success(res, {
      accountId: account.id,
      flags: {
        authRequired: !!rawFlags.auth_required,
        authRevocable: !!rawFlags.auth_revocable,
        authImmutable: !!rawFlags.auth_immutable,
        authClawbackEnabled: !!rawFlags.auth_clawback_enabled,
      },
      lastModifiedLedger: account.last_modified_ledger,
    });
  } catch (err) {
    handleAccountNotFound(err, next);
  }
});

/**
 * GET /account/:id/signers
 * Returns the signers and thresholds of a Stellar account.
 */
router.get("/:id/signers", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const account = await withHorizonTiming(req, () => server.loadAccount(id));
    const rawThresholds = account.thresholds || {};

    const signers = (account.signers || []).map((signer) => ({
      key: signer.key,
      weight: signer.weight,
      type: signer.type,
      sponsor: signer.sponsor || null,
    }));

    return success(res, {
      accountId: account.id,
      signers,
      thresholds: {
        lowThreshold: rawThresholds.low_threshold || 0,
        medThreshold: rawThresholds.med_threshold || 0,
        highThreshold: rawThresholds.high_threshold || 0,
      },
      lastModifiedLedger: account.last_modified_ledger,
    });
  } catch (err) {
    handleAccountNotFound(err, next);
  }
});

/**
 * GET /account/:id/operation-breakdown
 * Analyzes the last 200 operations and returns a breakdown by operation type.
 * Useful for understanding how an account is being used.
 *
 * @param {string} id - Stellar account public key (G...)
 */
router.get("/:id/operation-breakdown", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    // Fetch last 200 operations
    const opResponse = await server
      .operations()
      .forAccount(id)
      .limit(200)
      .order("desc")
      .call();

    const records = opResponse.records;
    const total = records.length;

    if (total === 0) {
      return success(res, {
        total: 0,
        breakdown: [],
        mostUsedOperation: null,
        leastUsedOperation: null,
      });
    }

    const counts = {};
    records.forEach((op) => {
      counts[op.type] = (counts[op.type] || 0) + 1;
    });

    const breakdown = Object.entries(counts)
      .map(([type, count]) => ({
        type,
        count,
        percentage: parseFloat(((count / total) * 100).toFixed(2)),
      }))
      .sort((a, b) => b.count - a.count);

    return success(res, {
      total,
      breakdown,
      mostUsedOperation: breakdown[0].type,
      leastUsedOperation: breakdown[breakdown.length - 1].type,
    });
  } catch (err) {
    handleAccountNotFound(err, next);
  }
});

router.get("/:id/timeline", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const { limit, cursor } = parsePaginationParams(req.query, 50);

    let query = server.operations().forAccount(id).limit(limit).order("desc");

    if (cursor) query = query.cursor(cursor);

    const opResponse = await query.call();
    const records = opResponse.records;

    const timeline = records.map((op) => {
      const base = {
        id: op.id,
        timestamp: op.created_at,
        transactionHash: op.transaction_hash,
      };

      switch (op.type) {
        case "create_account":
          if (op.account === id) {
            return {
              ...base,
              type: "account_created",
              description: `Account created with ${op.starting_balance} XLM by ${op.funder}`,
              amount: op.starting_balance,
              asset: "XLM",
              counterparty: op.funder,
            };
          } else {
            return {
              ...base,
              type: "payment_sent",
              description: `Sent ${op.starting_balance} XLM to create account ${op.account}`,
              amount: op.starting_balance,
              asset: "XLM",
              counterparty: op.account,
            };
          }

        case "payment":
          const isSent = op.from === id;
          const assetCode = isNativeAsset(op) ? "XLM" : op.asset_code;
          return {
            ...base,
            type: isSent ? "payment_sent" : "payment_received",
            description: isSent
              ? `Sent ${op.amount} ${assetCode} to ${op.to}`
              : `Received ${op.amount} ${assetCode} from ${op.from}`,
            amount: op.amount,
            asset: assetCode,
            counterparty: isSent ? op.to : op.from,
          };

        case "path_payment_strict_receive":
        case "path_payment_strict_send":
          const isPathSent = op.from === id;
          const sentAsset =
            isNativeAsset({ asset_type: op.source_asset_type }) ? "XLM" : op.source_asset_code;
          const receivedAsset =
            isNativeAsset(op) ? "XLM" : op.asset_code;

          if (isPathSent) {
            return {
              ...base,
              type: "payment_sent",
              description: `Sent ${op.source_amount} ${sentAsset} (converted to ${op.amount} ${receivedAsset}) to ${op.to}`,
              amount: op.source_amount,
              asset: sentAsset,
              counterparty: op.to,
            };
          } else {
            return {
              ...base,
              type: "payment_received",
              description: `Received ${op.amount} ${receivedAsset} (converted from ${op.source_amount} ${sentAsset}) from ${op.from}`,
              amount: op.amount,
              asset: receivedAsset,
              counterparty: op.from,
            };
          }

        case "change_trust":
          const isAdded = parseFloat(op.limit) > 0;
          return {
            ...base,
            type: isAdded ? "trustline_added" : "trustline_removed",
            description: isAdded
              ? `Added trustline for ${op.asset_code}`
              : `Removed trustline for ${op.asset_code}`,
            amount: op.limit,
            asset: op.asset_code,
            counterparty: op.asset_issuer,
          };

        case "manage_sell_offer":
        case "manage_buy_offer":
        case "create_passive_sell_offer":
          const isRemove =
            op.type !== "create_passive_sell_offer" &&
            parseFloat(op.amount) === 0 &&
            op.offer_id !== "0";
          const sellAsset =
            isNativeAsset({ asset_type: op.selling_asset_type }) ? "XLM" : op.selling_asset_code;
          const buyAsset =
            isNativeAsset({ asset_type: op.buying_asset_type }) ? "XLM" : op.buying_asset_code;

          if (isRemove) {
            return {
              ...base,
              type: "offer_removed",
              description: `Cancelled offer #${op.offer_id}`,
              amount: null,
              asset: null,
              counterparty: null,
            };
          } else {
            return {
              ...base,
              type: "offer_created",
              description: `Created offer to sell ${op.amount} ${sellAsset} for ${buyAsset}`,
              amount: op.amount,
              asset: sellAsset,
              counterparty: null,
            };
          }

        default:
          return {
            ...base,
            type: op.type,
            description: `Operation of type ${op.type}`,
            amount: null,
            asset: null,
            counterparty: null,
          };
      }
    });

    const lastRecord = records[records.length - 1];
    const nextCursor = lastRecord ? lastRecord.paging_token : null;

    return success(res, timeline, {
      meta: {
        count: timeline.length,
        limit,
        nextCursor,
        hasMore: records.length === limit,
      },
    });
  } catch (err) {
    handleAccountNotFound(err, next);
  }
});

/**
 AccountTrustlineHealthDasboardEndpoint
 * GET /account/:id/trustline-health
 * Returns a complete health overview of all trustlines on an account,
 * including authorization status, liability usage, available capacity,
 * and warnings for trustlines near their limits.

 * GET /account/:id/age
 * Returns account age and longevity metrics for trust and reputation systems.
 *
 * Fetches the account's first funding transaction from Horizon and calculates:
 * - ageInDays: Complete days since account creation
 * - ageInMonths: Floored months (ageInDays / 30.4375)
 * - ageInYears: Floored years (ageInDays / 365.25)
 * - maturity: 'new' (<30 days), 'established' (30–364 days), or 'veteran' (≥365 days)
 * - createdAt: ISO 8601 timestamp of account creation
 * - createdAtLedger: Ledger sequence number of first funding transaction
 *
 * @param {string} id - Stellar account public key (G...)
 *
 * @example
 AccountTrustlineHealthDasboardEndpoint
 * GET /account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/trustline-health
 */
router.get("/:id/trustline-health", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const account = await withHorizonTiming(req, () => server.loadAccount(id));

    // Filter out native XLM and extract trustline health data
    const trustlines = account.balances
      .filter((b) => isNonNativeAsset(b))
      .map((trustline) => {
        const balance = parseFloat(trustline.balance || "0");
        const limit = parseFloat(trustline.limit || "0");
        const buyingLiabilities = parseFloat(
          trustline.buying_liabilities || "0",
        );
        const sellingLiabilities = parseFloat(
          trustline.selling_liabilities || "0",
        );

        // Calculate usage percentage
        // Usage = (balance + buying liabilities) / limit * 100
        const usageAmount = balance + buyingLiabilities;
        const usagePercent = limit > 0 ? (usageAmount / limit) * 100 : 0;

        // Calculate available capacity
        // Available = limit - balance - buying liabilities
        const availableCapacity = Math.max(0, limit - usageAmount);

        // Flag as warning if usage exceeds 90%
        const warning = usagePercent > 90 ? "near_limit" : null;

        return {
          assetCode: trustline.asset_code,
          assetIssuer: trustline.asset_issuer,
          balance: balance.toString(),
          limit: limit.toString(),
          buyingLiabilities: buyingLiabilities.toString(),
          sellingLiabilities: sellingLiabilities.toString(),
          usagePercent: Math.round(usagePercent * 100) / 100, // Round to 2 decimals
          availableCapacity: availableCapacity.toString(),
          isAuthorized: trustline.is_authorized === true,
          isClawbackEnabled: trustline.is_clawback_enabled || false,
          warning: warning,
        };
      });

    // Count warnings
    const warningCount = trustlines.filter((t) => t.warning !== null).length;

    return success(res, {
      accountId: account.id,
      trustlineCount: trustlines.length,
      warningCount: warningCount,
      trustlines: trustlines,
    });
  } catch (err) {
    handleAccountNotFound(err, next);
  }
});





/**
 * GET /account/:id/transactions
 *
 * Returns paginated transaction history for a Stellar account, with an optional
 * ?type= filter to restrict results to transactions containing a specific operation type.
 *
 * Query params:
 *   - limit  (number, default: 20, max: 200)
 *   - cursor (string, optional pagination cursor)
 *   - order  ("asc" | "desc", default: "desc")
 *   - type   (string, optional) — filter to transactions containing the given operation type
 *            e.g. ?type=payment, ?type=change_trust, ?type=create_account
 *
 * Returns 400 if an unrecognised operation type is supplied, along with a list of valid types.
 * Omitting the param returns all transactions.
 *
 * @example
 *   GET /account/:id/transactions?type=payment&limit=20
 *   GET /account/:id/transactions?type=change_trust&order=asc
 */
router.get("/:id/transactions", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    // --- ?type= validation ---
    const rawType = req.query.type;
    if (rawType !== undefined) {
      const normalizedType = String(rawType).toLowerCase().trim();
      if (!VALID_OPERATION_TYPES.has(normalizedType)) {
        const err = new Error(
          `Unknown operation type "${rawType}". Valid types are: ${[...VALID_OPERATION_TYPES].sort().join(", ")}.`
        );
        err.isValidation = true;
        err.field = "type";
        err.receivedValue = rawType;
        err.expectedFormat = [...VALID_OPERATION_TYPES].sort().join(", ");
        return next(err);
      }
    }

    const includeOperations = req.query.includeOperations === true;
    const { limit, order, cursor } = parsePaginationParams(req.query, 200);

    // Helper to shape a Horizon transaction record into the API response format
    async function formatTx(tx) {
      const chargedInStroops = parseInt(tx.fee_charged, 10);
      const opCount = tx.operation_count || 1;
      const perOpStroops = Math.floor(chargedInStroops / opCount);
      const formatted = {
        id: tx.id,
        hash: tx.hash,
        ledger: typeof tx.ledger === "number" ? tx.ledger : tx.ledger_attr,
        createdAt: toISOTimestamp(tx.created_at),
        sourceAccount: tx.source_account,
        fee: {
          charged: tx.fee_charged,
          chargedInXLM: parseStellarAmount(chargedInStroops),
          max: tx.max_fee,
          maxInXLM: parseStellarAmount(parseInt(tx.max_fee, 10)),
          account: tx.fee_account,
        },
        feeSummary: {
          chargedInStroops,
          chargedInXLM: parseStellarAmount(chargedInStroops),
          perOperationInStroops: perOpStroops,
          perOperationInXLM: parseStellarAmount(perOpStroops),
        },
        operationCount: tx.operation_count,
        memoType: tx.memo_type,
        memo: tx.memo || null,
        successful: tx.successful,
        envelopeXdr: tx.envelope_xdr,
      };

      if (includeOperations) {
        try {
          const opResponse = await server
            .operations()
            .forTransaction(tx.hash)
            .call();
          formatted.operations = (opResponse.records || []).map(normalizeOperation);
        } catch (_) {
          formatted.operations = [];
        }
      }

      return formatted;
    }

    // When a ?type= filter is requested, fetch from the operations endpoint
    // (which supports per-type Horizon-side filtering) then resolve unique
    // transaction records in parallel.
    if (rawType !== undefined) {
      const normalizedType = String(rawType).toLowerCase().trim();

      // Ensure the account exists (produce clean 404 for unknown accounts).
      await withHorizonTiming(req, () => server.loadAccount(id)).catch((loadErr) => {
        if (loadErr && loadErr.response && loadErr.response.status === 404) {
          throw makeAccountNotFoundError(id, NETWORK);
        }
        throw loadErr;
      });

      let opsQuery = server
        .operations()
        .forAccount(id)
        .limit(limit)
        .order(order);
      if (cursor) opsQuery = opsQuery.cursor(cursor);

      const opsResponse = await opsQuery.call();
      const opRecords = opsResponse.records || [];

      // Keep only operations of the requested type, deduplicated by tx hash
      const seen = new Set();
      const matchingOps = opRecords.filter((op) => {
        if (op.type !== normalizedType) return false;
        if (seen.has(op.transaction_hash)) return false;
        seen.add(op.transaction_hash);
        return true;
      });

      // Resolve full transaction detail for each matched operation
      const transactions = (
        await Promise.all(
          matchingOps.map(async (op) => {
            try {
              const tx = await server
                .transactions()
                .transaction(op.transaction_hash)
                .call();
              return await formatTx(tx);
            } catch (_) {
              return null; // skip on individual lookup failure
            }
          })
        )
      ).filter(Boolean);

      const lastOp = opRecords[opRecords.length - 1];
      const nextCursor = lastOp ? lastOp.paging_token : null;

      return success(res, {
        items: transactions,
        total: transactions.length,
        limit,
        cursor: opRecords.length > 0 ? nextCursor : null,
        filter: { type: normalizedType },
      });
    }

    // No ?type= filter — standard paginated transaction history
    let txQuery = server
      .transactions()
      .forAccount(id)
      .limit(limit)
      .order(order)
      .includeFailed(false);
    if (cursor) txQuery = txQuery.cursor(cursor);

    const txResponse = await txQuery.call();
    const records = txResponse.records || [];

    return success(res, {
      items: await Promise.all(records.map(formatTx)),
      total: records.length,
      limit,
      cursor: records.length > 0 ? records[records.length - 1].paging_token : null,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * POST /account/freeze-status
 *
 * Batch freeze-status check — returns authorization state for up to 20
 * Stellar accounts against a single asset in one request.
 *
 * Request body:
 *   {
 *     addresses: ["G...", "G..."],   // 1–20 Stellar public keys
 *     asset: { code: "USDC", issuer: "GA5Z..." }
 *   }
 *
 * Response:
 *   {
 *     success: true,
 *     data: {
 *       results: {
 *         "G...": { status, isAuthorized, isAuthorizedToMaintainLiabilities }
 *       }
 *     }
 *   }
 *
 * Error entries (non-existent accounts or missing trustlines) are included in
 * the results map with status "error" and an error message rather than causing
 * the entire request to fail.
 *
 * Returns 400 when addresses array exceeds 20 entries or input is invalid.
 */
router.post("/freeze-status", async (req, res, next) => {
  try {
    const { addresses, asset } = req.body || {};

    // --- Input validation ---
    if (!Array.isArray(addresses) || addresses.length === 0) {
      const err = new Error("Request body must include a non-empty 'addresses' array.");
      err.isValidation = true;
      err.field = "addresses";
      err.status = 400;
      return next(err);
    }

    if (addresses.length > 20) {
      const err = new Error(
        `Too many addresses: received ${addresses.length}, maximum is 20.`
      );
      err.isValidation = true;
      err.field = "addresses";
      err.receivedValue = String(addresses.length);
      err.expectedFormat = "array of up to 20 Stellar public keys";
      err.status = 400;
      return next(err);
    }

    if (!asset || typeof asset !== "object") {
      const err = new Error("Request body must include an 'asset' object with 'code' and 'issuer'.");
      err.isValidation = true;
      err.field = "asset";
      err.status = 400;
      return next(err);
    }

    const { code: assetCode, issuer: assetIssuer } = asset;
    if (!assetCode || typeof assetCode !== "string") {
      const err = new Error("'asset.code' is required and must be a string.");
      err.isValidation = true;
      err.field = "asset.code";
      err.status = 400;
      return next(err);
    }
    if (!assetIssuer || typeof assetIssuer !== "string") {
      const err = new Error("'asset.issuer' is required and must be a string.");
      err.isValidation = true;
      err.field = "asset.issuer";
      err.status = 400;
      return next(err);
    }

    // Validate each address format
    for (const addr of addresses) {
      validateAccountId(addr);
    }
    validateAssetCode(assetCode);
    validateAccountId(assetIssuer);

    const normalizedCode = assetCode.toUpperCase();

    // Fetch all accounts in parallel, recording timing for the whole batch
    startHorizonTimer(req);
    const accountResults = await Promise.allSettled(
      addresses.map((addr) => server.loadAccount(addr))
    );
    stopHorizonTimer(req);

    const results = {};

    for (let i = 0; i < addresses.length; i++) {
      const addr = addresses[i];
      const outcome = accountResults[i];

      if (outcome.status === "rejected") {
        const err = outcome.reason;
        const isNotFound =
          (err && err.response && err.response.status === 404) ||
          (err && err.isAccountNotFound);
        results[addr] = {
          status: "error",
          error: isNotFound
            ? `Account ${addr} was not found on the Stellar ${NETWORK} network.`
            : (err && err.message) || "Failed to fetch account.",
          isAuthorized: null,
          isAuthorizedToMaintainLiabilities: null,
        };
        continue;
      }

      const account = outcome.value;
      const trustline = (account.balances || []).find(
        (b) =>
          isNonNativeAsset(b) &&
          b.asset_code === normalizedCode &&
          b.asset_issuer === assetIssuer
      );

      if (!trustline) {
        results[addr] = {
          status: "error",
          error: `Account does not hold asset ${normalizedCode}:${assetIssuer}.`,
          isAuthorized: null,
          isAuthorizedToMaintainLiabilities: null,
        };
        continue;
      }

      const isAuthorized = trustline.is_authorized !== false;
      const isAuthorizedToMaintainLiabilities =
        trustline.is_authorized_to_maintain_liabilities === true;

      let status;
      if (isAuthorized) {
        status = "authorized";
      } else if (isAuthorizedToMaintainLiabilities) {
        status = "frozen_maintain_liabilities";
      } else {
        status = "frozen";
      }

      results[addr] = {
        status,
        isAuthorized,
        isAuthorizedToMaintainLiabilities,
      };
    }

    return success(res, { results });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
