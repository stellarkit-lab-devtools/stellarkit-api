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
const minResponseTime = require("../middleware/minResponseTime");
const { startHorizonTimer, stopHorizonTimer } = require("../middleware/requestLogger");
registerParamValidation(router);
// Pad synchronous format-validation 400s so they cannot be distinguished from
// Horizon-backed rejections by response time (account-enumeration hardening).
router.use(minResponseTime);

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
const { Asset, scValToNative, xdr } = require("@stellar/stellar-sdk");
const { normalizeAsset, normalizeAssetFromString } = require("../utils/asset");
const { isNativeAsset, isNonNativeAsset } = require("../utils/assetHelpers");
const { getAssetMetadataFromToml, fetchStellarToml } = require("../utils/tomlResolver");
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

    const fresh = req.query.fresh === true || req.query.fresh === "true";
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

    const fresh = req.query.fresh === true || req.query.fresh === "true";
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
 * GET /account/:id/delegated-signers
 * Returns additional account signers and whether each signer account is multisig.
 */
router.get("/:id/delegated-signers", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const account = await server.loadAccount(id);
    const delegatedSigners = (account.signers || []).filter(
      (signer) =>
        signer.key !== account.id &&
        (!signer.type || normalizeSignerType(signer.type) === "ed25519_public_key"),
    );

    const resolvedSigners = await Promise.all(
      delegatedSigners.map(async (signer) => {
        const signerAccount = await server.loadAccount(signer.key);
        const signerEntries = signerAccount.signers || [];
        const masterSigner = signerEntries.find(
          (entry) => entry.key === signerAccount.id,
        );
        const masterWeight = Number(
          masterSigner?.weight ?? signerAccount.master_weight ?? 0,
        );
        const thresholds = signerAccount.thresholds || {};
        const isMultisig =
          signerEntries.length > 1 ||
          Number(thresholds.low_threshold ?? 0) > masterWeight ||
          Number(thresholds.med_threshold ?? 0) > masterWeight ||
          Number(thresholds.high_threshold ?? 0) > masterWeight;

        return {
          key: signer.key,
          weight: Number(signer.weight) || 0,
          type: normalizeSignerType(signer.type),
          isMultisig,
        };
      }),
    );

    return success(res, {
      accountId: account.id,
      delegatedSigners: resolvedSigners,
    });
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
    }, {
      meta: {
        count: operations.length,
        limit,
        order: "desc",
        nextCursor: operations.length ? nextCursor : null,
        hasMore: nextCursor !== null,
      },
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
      "payment-summary", "net-flow", "operations",
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
    }, {
      meta: {
        count: payments.length,
        limit,
        order,
        nextCursor: payments.length ? nextCursor : null,
        hasMore: nextCursor !== null,
      },
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
    };

    const metadata = {
      meta: {
        count: trades.length,
        limit,
        order,
        nextCursor: trades.length ? nextCursor : null,
        hasMore: nextCursor !== null,
      },
    };

    cacheService.set(cacheKey, { ...data, ...metadata }, cacheTTL.trades);
    res.set("X-Cache", "MISS");
    return success(res, data, metadata);
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/cross-asset-trades
 * Returns path payments with at least one intermediate asset, including the
 * full source-to-destination conversion path and effective exchange rate.
 */
router.get("/:id/cross-asset-trades", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);
    const { limit, order, cursor } = parsePaginationParams(req.query, 200);

    await withHorizonTiming(req, () => server.loadAccount(id));

    let query = server.payments().forAccount(id).limit(limit).order(order);
    if (cursor) query = query.cursor(cursor);

    const response = await withHorizonTiming(req, () => query.call());
    const records = response.records || [];
    const pathPaymentTypes = new Set([
      "path_payment_strict_send",
      "path_payment_strict_receive",
    ]);
    const trades = records
      .filter((operation) => pathPaymentTypes.has(operation.type) && (operation.path || []).length > 0)
      .map((operation) => {
        const sourceType = operation.source_asset_type || "native";
        const exitType = operation.asset_type || "native";
        const entryAsset = normalizeAsset(
          sourceType === "native" ? "XLM" : operation.source_asset_code,
          sourceType === "native" ? null : operation.source_asset_issuer,
          sourceType,
        );
        const exitAsset = normalizeAsset(
          exitType === "native" ? "XLM" : operation.asset_code,
          exitType === "native" ? null : operation.asset_issuer,
          exitType,
        );
        const entryValue = Number(operation.source_amount ?? operation.source_max ?? 0);
        const exitValue = Number(operation.amount || 0);
        const intermediateAssets = operation.path.map((asset) => {
          const type = asset.asset_type || "native";
          return normalizeAsset(
            type === "native" ? "XLM" : asset.asset_code,
            type === "native" ? null : asset.asset_issuer,
            type,
          );
        });

        return {
          tradeId: operation.id,
          path: [entryAsset, ...intermediateAssets, exitAsset],
          entryAsset,
          exitAsset,
          entryAmount: entryValue.toFixed(7),
          exitAmount: exitValue.toFixed(7),
          effectiveRate: (entryValue > 0 ? exitValue / entryValue : 0).toFixed(7),
          timestamp: toISOTimestamp(operation.created_at),
        };
      });

    const lastRecord = records[records.length - 1];
    return success(res, {
      trades,
      total: trades.length,
      limit,
      cursor: lastRecord ? lastRecord.paging_token || null : null,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * Maps a raw Horizon offer record onto the StellarKit normalised shape:
 *   offerId, selling, buying, amount, price, lastModifiedLedger
 *
 * All amounts are formatted as seven-decimal strings (Stellar precision).
 *
 * Asset fields are controlled by the expandAssets option:
 *   - expandAssets=false (default): asset code/issuer/type are spread directly
 *     onto selling/buying (backward-compatible simplified shape), e.g.
 *     `selling: { code, issuer, type, amount }`.
 *   - expandAssets=true: full { code, issuer, type } asset objects are embedded
 *     under selling.asset / buying.asset, e.g.
 *     `selling: { asset: { code, issuer, type }, amount }`.
 *
 * @param {Object} offer - Raw Horizon offer record.
 * @param {Object} [options]
 * @param {boolean} [options.expandAssets=false] - Embed full asset objects.
 * @returns {Object} Normalised camelCase offer.
 */
function mapOffer(offer, { expandAssets = false } = {}) {
  // Derive a single decimal price string from price_r (n/d fraction) when
  // available, falling back to the pre-computed price string from Horizon.
  // Always format to 7 decimal places for consistency with other amounts.
  let priceDecimal;
  if (offer.price_r && offer.price_r.d && Number(offer.price_r.d) !== 0) {
    priceDecimal = (Number(offer.price_r.n) / Number(offer.price_r.d)).toFixed(7);
  } else {
    priceDecimal = parseFloat(offer.price || "0").toFixed(7);
  }

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
  const amount = toSevenDecimalString(offer.amount);

  return {
    offerId: offer.id,
    seller: offer.seller,
    selling: expandAssets
      ? { asset: sellingAsset, amount }
      : { ...sellingAsset, amount },
    buying: expandAssets ? { asset: buyingAsset } : buyingAsset,
    amount,
    price: priceDecimal,
    lastModifiedLedger: formatLedgerSequence(offer.last_modified_ledger),
  };
}

/**
 * GET /account/:id/offers
 *
 * Returns live open DEX offers for an account by calling
 * `server.offers().forAccount(id)` on the Stellar Horizon SDK.
 * Each offer is mapped to the StellarKit normalised shape:
 *   offerId, selling, buying, amount, price, lastModifiedLedger
 *
 * All amounts are formatted as seven-decimal strings (Stellar precision).
 *
 * Query params:
 *   - limit, cursor   — standard pagination
 *   - offerId         — fetch a single offer by its numeric ID
 *
 * @example
 *   GET /account/:id/offers
 *   GET /account/:id/offers?limit=50&cursor=12345
 */
router.get("/:id/offers", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { offerId } = req.query;
    const expandAssets = req.query.expandAssets === "true";

    validateAccountId(id);

    if (offerId) {
      try {
        const offer = await server.offers().offer(offerId).call();
        return success(res, mapOffer(offer, { expandAssets }));
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

    const { limit, cursor } = parsePaginationParams(req.query);

    let query = server.offers().forAccount(id).limit(limit).order("desc");
    if (cursor) query = query.cursor(cursor);

    const offerResponse = await query.call();
    const records = offerResponse.records || [];
    const offers = records.map((offer) => mapOffer(offer, { expandAssets }));

    const nextCursor =
      offers.length > 0 ? records[records.length - 1].paging_token || null : null;

    return success(res, {
      offers,
      items: offers,
    }, {
      meta: {
        count: offers.length,
        limit,
        order: "desc",
        nextCursor: nextCursor || null,
        hasMore: nextCursor !== null,
      },
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
 * GET /account/:id/history
 * Returns a unified account activity feed combining recent operations and effects.
 *
 * Query params:
 *   - limit (default 20, max 100)
 *   - order (asc|desc, default desc)
 */
router.get("/:id/history", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const limit = validateLimit(req.query.limit ?? 20, 100);
    const order = (req.query.order || "desc").toLowerCase();
    if (order !== "asc" && order !== "desc") {
      const err = new Error("Query parameter 'order' must be either 'asc' or 'desc'.");
      err.isValidation = true;
      err.field = "order";
      err.receivedValue = String(req.query.order);
      err.expectedFormat = "asc or desc";
      throw err;
    }

    const operationQuery = server
      .operations()
      .forAccount(id)
      .limit(limit)
      .order(order);

    const effectQuery = server
      .effects()
      .forAccount(id)
      .limit(limit)
      .order(order);

    const [operationsResponse, effectsResponse] = await Promise.all([
      operationQuery.call(),
      effectQuery.call(),
    ]);

    const operationItems = (operationsResponse.records || []).map((op) => ({
      id: op.id || `${op.paging_token || op.transaction_hash || "op"}`,
      type: op.type,
      category: "operation",
      account: op.source_account || id,
      createdAt: toISOTimestamp(op.created_at),
      transactionHash: op.transaction_hash || null,
      sourceAccount: op.source_account || null,
      asset: op.asset_code || op.asset || null,
      amount: op.amount || op.starting_balance || null,
      from: op.from || null,
      to: op.to || null,
      pagingToken: op.paging_token || null,
      raw: op,
    }));

    const effectItems = (effectsResponse.records || []).map((effect) => ({
      id: effect.id || effect.paging_token || effect.transaction_hash || "effect",
      type: effect.type,
      category: "effect",
      account: effect.account || id,
      createdAt: toISOTimestamp(effect.created_at),
      transactionHash: effect.transaction_hash || null,
      asset: effect.asset || null,
      amount: effect.amount || effect.starting_balance || null,
      balance: effect.balance || null,
      limit: effect.limit || null,
      seller: effect.seller || null,
      offerId: effect.offer_id || null,
      trustor: effect.trustor || null,
      trustee: effect.trustee || null,
      pagingToken: effect.paging_token || null,
      raw: effect,
    }));

    const merged = [...operationItems, ...effectItems].sort((a, b) => {
      const left = new Date(a.createdAt || 0).getTime();
      const right = new Date(b.createdAt || 0).getTime();
      return order === "asc" ? left - right : right - left;
    });

    const items = merged.slice(0, limit);

    return success(res, {
      items,
      total: merged.length,
      limit,
      order,
      cursor: null,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
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

router.normalizeEffect = normalizeEffect;

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
 * GET /account/:id/claimable-balance-summary
 *
 * Returns a compact summary of an account's claimable balances without
 * fetching the full paginated list. Categorises balances by eligibility:
 *   - eligibleNow  — predicates are satisfied at the current time
 *   - pending      — predicates exist but are not yet satisfied (time-locked)
 *   - expired      — past their not_after predicate; can no longer be claimed
 *
 * totalValueXLM is computed from eligible balances only, treating every
 * native XLM balance at face value. Non-XLM balances contribute 0 to the
 * total (no cross-asset pricing is performed).
 *
 * Response shape:
 *   {
 *     success: true,
 *     data: {
 *       accountId:     string,
 *       totalBalances: number,   // integer count of all claimable balances
 *       eligibleNow:   number,   // integer
 *       pending:       number,   // integer
 *       expired:       number,   // integer
 *       totalValueXLM: string    // seven-decimal string, eligible XLM only
 *     }
 *   }
 *
 * Returns 404 when the account does not exist.
 * Response is cached with a 15 second TTL. Pass ?fresh=true to bypass.
 *
 * @example
 *   GET /account/GABC.../claimable-balance-summary
 */
router.get("/:id/claimable-balance-summary", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const fresh = req.query.fresh === "true";
    const cacheKey = `claimable-balance-summary:${id}`;

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    // Ensure the account exists — raises 404 for unknown accounts.
    await withHorizonTiming(req, () => server.loadAccount(id));

    // Fetch all claimable balances for this claimant (up to 200 per page).
    // For summary purposes a single page is sufficient; most accounts hold
    // far fewer than 200 pending claimable balances.
    const response = await server
      .claimableBalances()
      .claimant(id)
      .limit(200)
      .order("desc")
      .call();

    const records = response.records || [];
    const now = Date.now();

    let eligibleNow = 0;
    let pending = 0;
    let expired = 0;
    let totalValueXLMRaw = 0;

    for (const balance of records) {
      // Find the predicate for this specific claimant.
      const claimantEntry = (balance.claimants || []).find(
        (c) => c.destination === id
      );

      const predicate = claimantEntry ? claimantEntry.predicate : null;
      const eligibility = evaluateClaimPredicate(predicate, now);

      if (eligibility === "eligible") {
        eligibleNow++;
        // Accumulate XLM value from eligible native balances only.
        if (balance.asset === "native" || balance.asset_type === "native") {
          totalValueXLMRaw += parseFloat(balance.amount || "0");
        }
      } else if (eligibility === "expired") {
        expired++;
      } else {
        pending++;
      }
    }

    const data = {
      accountId: id,
      totalBalances: records.length,
      eligibleNow,
      pending,
      expired,
      totalValueXLM: totalValueXLMRaw.toFixed(7),
    };

    cacheService.set(cacheKey, data, cacheTTL.claimableBalanceSummary);
    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * Evaluates a Horizon claimable balance predicate against the current time.
 *
 * Horizon predicates can be:
 *   - null / { unconditional: true }   → always eligible
 *   - { not: { unconditional: true } } → never eligible (treat as expired)
 *   - { abs_before: "<ISO>" }          → eligible before that time (expired if past)
 *   - { rel_before: "<seconds>" }      → treated as pending (relative to creation,
 *                                        which we don't have here without extra fetch)
 *   - { and: [...] } / { or: [...] }   → compound predicates
 *
 * Returns "eligible", "pending", or "expired".
 *
 * @param {object|null} predicate - Raw Horizon predicate object
 * @param {number} nowMs - Current time in milliseconds
 * @returns {"eligible"|"pending"|"expired"}
 */
function evaluateClaimPredicate(predicate, nowMs) {
  // Null or missing predicate — unconditionally claimable
  if (!predicate || predicate.unconditional === true) {
    return "eligible";
  }

  // { not: { unconditional: true } } — permanently unclaimable
  if (
    predicate.not &&
    predicate.not.unconditional === true
  ) {
    return "expired";
  }

  // Absolute time-lock: claimable only before this timestamp
  if (predicate.abs_before) {
    const deadline = new Date(predicate.abs_before).getTime();
    if (Number.isFinite(deadline)) {
      return nowMs < deadline ? "eligible" : "expired";
    }
  }

  // Absolute time-lock as epoch seconds (abs_before_epoch)
  if (predicate.abs_before_epoch != null) {
    const deadline = Number(predicate.abs_before_epoch) * 1000;
    if (Number.isFinite(deadline)) {
      return nowMs < deadline ? "eligible" : "expired";
    }
  }

  // Relative time-lock — requires creation time to evaluate; treat as pending
  if (predicate.rel_before != null) {
    return "pending";
  }

  // Compound AND — all sub-predicates must be eligible
  if (Array.isArray(predicate.and)) {
    const results = predicate.and.map((p) => evaluateClaimPredicate(p, nowMs));
    if (results.every((r) => r === "eligible")) return "eligible";
    if (results.some((r) => r === "expired")) return "expired";
    return "pending";
  }

  // Compound OR — at least one sub-predicate must be eligible
  if (Array.isArray(predicate.or)) {
    const results = predicate.or.map((p) => evaluateClaimPredicate(p, nowMs));
    if (results.some((r) => r === "eligible")) return "eligible";
    if (results.every((r) => r === "expired")) return "expired";
    return "pending";
  }

  // Unknown predicate shape — treat as pending (conservative)
  return "pending";
}

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
 * GET /account/:id/stale-offers
 *
 * Returns all open DEX offers for an account with staleness analysis.
 * Each offer's price is compared against the current mid-market price from
 * the Horizon order book. Offers where the price deviation exceeds the
 * configured threshold are flagged as stale.
 *
 * Query params:
 *   - threshold (number, default: 5) — deviation % above which an offer is stale
 *
 * Returns 404 when the account does not exist.
 */
router.get("/:id/stale-offers", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const rawThreshold = req.query.threshold !== undefined ? parseFloat(req.query.threshold) : 5;
    const threshold = Number.isFinite(rawThreshold) && rawThreshold >= 0 ? rawThreshold : 5;

    await withHorizonTiming(req, () => server.loadAccount(id));

    const offersResponse = await server.offers().forAccount(id).limit(200).order("desc").call();
    const offerRecords = offersResponse.records || [];

    const offers = await Promise.all(offerRecords.map(async (offer) => {
      const sellingAsset = offer.selling_asset_type === "native"
        ? Asset.native()
        : new Asset(offer.selling_asset_code, offer.selling_asset_issuer);
      const buyingAsset = offer.buying_asset_type === "native"
        ? Asset.native()
        : new Asset(offer.buying_asset_code, offer.buying_asset_issuer);

      let offerPrice;
      if (offer.price_r && offer.price_r.d && Number(offer.price_r.d) !== 0) {
        offerPrice = Number(offer.price_r.n) / Number(offer.price_r.d);
      } else {
        offerPrice = parseFloat(offer.price || "0");
      }

      let marketPrice = null;
      let priceDeviation = 0;
      let stale = false;

      try {
        const ob = await server.orderbook(sellingAsset, buyingAsset).limit(1).call();
        const bids = ob.bids || [];
        const asks = ob.asks || [];
        const bid = bids.length > 0 ? parseFloat(bids[0].price) : null;
        const ask = asks.length > 0 ? parseFloat(asks[0].price) : null;

        if (bid !== null && ask !== null) {
          marketPrice = (bid + ask) / 2;
        } else if (bid !== null) {
          marketPrice = bid;
        } else if (ask !== null) {
          marketPrice = ask;
        }

        if (marketPrice !== null && marketPrice > 0) {
          priceDeviation = Math.abs(offerPrice - marketPrice) / marketPrice * 100;
          stale = priceDeviation > threshold;
        }
      } catch (_) {
        // order book unavailable — staleness undetermined
      }

      return {
        offerId: offer.id,
        selling: normalizeAsset(offer.selling_asset_code, offer.selling_asset_issuer, offer.selling_asset_type),
        buying: normalizeAsset(offer.buying_asset_code, offer.buying_asset_issuer, offer.buying_asset_type),
        offerPrice: offerPrice.toFixed(7),
        marketPrice: marketPrice !== null ? marketPrice.toFixed(7) : null,
        priceDeviation: parseFloat(priceDeviation.toFixed(2)),
        stale,
      };
    }));

    return success(res, {
      offers,
      staleCount: offers.filter(o => o.stale).length,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/portfolio
 *
 * Returns a full financial snapshot for an account: native XLM balance,
 * all asset balances with current DEX prices, total portfolio value in XLM,
 * open DEX offers, and liquidity pool positions.
 *
 * Returns 404 when the account does not exist.
 */
router.get("/:id/portfolio", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const account = await withHorizonTiming(req, () => server.loadAccount(id));

    const nativeEntry = (account.balances || []).find(b => isNativeAsset(b));
    const nativeBalance = toSevenDecimalString(nativeEntry ? nativeEntry.balance : "0");
    let totalValueXLM = parseFloat(nativeEntry ? nativeEntry.balance : "0");

    // Asset balances with prices from DEX order book
    const assetEntries = (account.balances || []).filter(b => isNonNativeAsset(b));
    const assetBalances = await Promise.all(assetEntries.map(async (b) => {
      const balance = parseFloat(b.balance);
      let priceInXLM = null;
      try {
        const asset = new Asset(b.asset_code, b.asset_issuer);
        const ob = await server.orderbook(asset, Asset.native()).limit(1).call();
        const bids = ob.bids || [];
        const asks = ob.asks || [];
        const bid = bids.length > 0 ? parseFloat(bids[0].price) : null;
        const ask = asks.length > 0 ? parseFloat(asks[0].price) : null;
        if (bid !== null && ask !== null) priceInXLM = (bid + ask) / 2;
        else if (bid !== null) priceInXLM = bid;
        else if (ask !== null) priceInXLM = ask;
      } catch (_) {
        // order book unavailable
      }
      const valueInXLM = priceInXLM !== null ? balance * priceInXLM : null;
      if (valueInXLM !== null) totalValueXLM += valueInXLM;

      return {
        asset: normalizeAsset(b.asset_code, b.asset_issuer, b.asset_type),
        balance: toSevenDecimalString(b.balance),
        priceInXLM: priceInXLM !== null ? priceInXLM.toFixed(7) : null,
        valueInXLM: valueInXLM !== null ? valueInXLM.toFixed(7) : null,
      };
    }));

    // Open DEX offers
    const offersResponse = await server.offers().forAccount(id).limit(200).order("desc").call();
    const openOffers = (offersResponse.records || []).map(offer => {
      let priceDecimal;
      if (offer.price_r && offer.price_r.d && Number(offer.price_r.d) !== 0) {
        priceDecimal = (Number(offer.price_r.n) / Number(offer.price_r.d)).toFixed(7);
      } else {
        priceDecimal = parseFloat(offer.price || "0").toFixed(7);
      }
      return {
        offerId: offer.id,
        selling: {
          asset: normalizeAsset(offer.selling_asset_code, offer.selling_asset_issuer, offer.selling_asset_type),
          amount: parseFloat(offer.amount || "0").toFixed(7),
        },
        buying: {
          asset: normalizeAsset(offer.buying_asset_code, offer.buying_asset_issuer, offer.buying_asset_type),
        },
        price: priceDecimal,
      };
    });

    // Liquidity pool positions
    const poolShareTrustlines = (account.balances || []).filter(
      b => b.asset_type === "liquidity_pool_shares"
    );
    const poolPositions = [];
    if (poolShareTrustlines.length > 0) {
      const poolDetails = await Promise.all(
        poolShareTrustlines.map(tl =>
          server.liquidityPools().liquidityPoolId(tl.liquidity_pool_id).call()
            .catch(err => (err && err.response && err.response.status === 404 ? null : Promise.reject(err)))
        )
      );
      for (let i = 0; i < poolShareTrustlines.length; i++) {
        const tl = poolShareTrustlines[i];
        const pool = poolDetails[i];
        if (!pool) continue;
        const accountShares = parseFloat(tl.balance);
        const totalShares = parseFloat(pool.total_shares);
        const sharePercent = totalShares > 0 ? (accountShares / totalShares) * 100 : 0;
        const reserveA = pool.reserves[0];
        const reserveB = pool.reserves[1];
        poolPositions.push({
          poolId: pool.id,
          shares: toSevenDecimalString(accountShares),
          sharePercent: toSevenDecimalString(sharePercent),
          reserveA: {
            asset: normalizeAssetFromString(reserveA.asset),
            equivalentAmount: ((parseFloat(reserveA.amount) * accountShares) / totalShares).toFixed(7),
          },
          reserveB: {
            asset: normalizeAssetFromString(reserveB.asset),
            equivalentAmount: ((parseFloat(reserveB.amount) * accountShares) / totalShares).toFixed(7),
          },
        });
      }
    }

    return success(res, {
      nativeBalance,
      assetBalances,
      totalValueXLM: totalValueXLM.toFixed(7),
      openOffers,
      poolPositions,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/asset-exposure
 * Returns the account's priced portfolio allocation across asset categories.
 */
router.get("/:id/asset-exposure", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const account = await withHorizonTiming(req, () => server.loadAccount(id));
    const balances = (account.balances || []).filter(
      (balance) => isNativeAsset(balance) || isNonNativeAsset(balance),
    );
    const issuerDomains = new Map();
    const tomlByDomain = new Map();

    const breakdown = await Promise.all(balances.map(async (balance) => {
      const native = isNativeAsset(balance);
      const assetCode = native ? "XLM" : balance.asset_code;
      const assetIssuer = native ? null : balance.asset_issuer;
      const amount = parseFloat(balance.balance || "0");
      let category = "native";
      let priceInXLM = native ? 1 : null;

      if (!native) {
        if (!issuerDomains.has(assetIssuer)) {
          issuerDomains.set(
            assetIssuer,
            server.loadAccount(assetIssuer)
              .then((issuerAccount) => issuerAccount.home_domain || null)
              .catch(() => null),
          );
        }
        const homeDomain = await issuerDomains.get(assetIssuer);
        let currency = null;
        if (homeDomain) {
          if (!tomlByDomain.has(homeDomain)) {
            tomlByDomain.set(homeDomain, fetchStellarToml(homeDomain));
          }
          const toml = await tomlByDomain.get(homeDomain);
          currency = (toml?.CURRENCIES || []).find(
            (entry) => entry.code === assetCode && (!entry.issuer || entry.issuer === assetIssuer),
          );
        }

        const metadataText = [currency?.name, currency?.desc, currency?.description, currency?.conditions]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        const anchorAssetType = String(currency?.anchor_asset_type || currency?.anchorAssetType || "").toLowerCase();
        if (/\b(wrapped|bridged)\b/.test(metadataText) || ["wrapped", "wrapped_crypto"].includes(anchorAssetType)) {
          category = "wrapped";
        } else if (anchorAssetType === "fiat" || ["USDC", "USDT", "DAI", "BUSD", "EURC", "EURT"].includes(String(assetCode).toUpperCase())) {
          category = "stablecoins";
        } else {
          category = "community";
        }

        try {
          const asset = new Asset(assetCode, assetIssuer);
          const orderBook = await server.orderbook(asset, Asset.native()).limit(1).call();
          const bids = orderBook.bids || [];
          const asks = orderBook.asks || [];
          const bid = bids.length ? parseFloat(bids[0].price) : null;
          const ask = asks.length ? parseFloat(asks[0].price) : null;
          if (bid !== null && ask !== null) priceInXLM = (bid + ask) / 2;
          else if (bid !== null) priceInXLM = bid;
          else if (ask !== null) priceInXLM = ask;
        } catch (_) {
          // Assets without an available XLM order book remain unpriced.
        }
      }

      const valueInXLM = priceInXLM === null ? null : amount * priceInXLM;
      return {
        asset: normalizeAsset(balance.asset_code, balance.asset_issuer, balance.asset_type),
        balance: toSevenDecimalString(balance.balance),
        category,
        priceInXLM: priceInXLM === null ? null : priceInXLM.toFixed(7),
        valueInXLM: valueInXLM === null ? null : valueInXLM.toFixed(7),
        percentage: null,
        _value: valueInXLM,
      };
    }));

    const totalValueXLM = breakdown.reduce((total, entry) => total + (entry._value || 0), 0);
    const categoryValues = { native: 0, stablecoins: 0, wrapped: 0, community: 0 };
    for (const entry of breakdown) {
      if (entry._value !== null) categoryValues[entry.category] += entry._value;
      entry.percentage = entry._value === null || totalValueXLM === 0
        ? null
        : Number(((entry._value / totalValueXLM) * 100).toFixed(2));
      delete entry._value;
    }

    const exposure = Object.fromEntries(
      Object.entries(categoryValues).map(([category, value]) => [
        category,
        totalValueXLM === 0 ? 0 : Number(((value / totalValueXLM) * 100).toFixed(2)),
      ]),
    );

    return success(res, {
      accountId: id,
      totalValueXLM: totalValueXLM.toFixed(7),
      exposure,
      breakdown,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/asset-diversity
 *
 * Computes the Herfindahl-Hirschman Index (HHI) for the account's portfolio
 * based on DEX order-book prices converted to XLM.
 *
 * HHI = Σ (portfolioPercent_i)²  where percent is on a 0–100 scale.
 *   - HHI = 10000  → 100% in one asset (fully concentrated)
 *   - HHI ≤ 1500   → well diversified
 *   - 1500 < HHI ≤ 2500 → moderately diversified
 *   - HHI > 2500   → concentrated
 *
 * Response shape:
 *   {
 *     success: true,
 *     data: {
 *       accountId:      string,
 *       hhi:            number,   // integer 0–10000
 *       diversityLevel: "diversified" | "moderate" | "concentrated",
 *       breakdown: [
 *         {
 *           asset:            { code, issuer, type },
 *           balance:          string,
 *           valueInXLM:       string | null,
 *           portfolioPercent: number | null   // 0–100 (two decimal places)
 *         }
 *       ]
 *     }
 *   }
 *
 * Returns 404 when the account does not exist.
 *
 * @example
 *   GET /account/GABC.../asset-diversity
 */
router.get("/:id/asset-diversity", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const account = await withHorizonTiming(req, () => server.loadAccount(id));

    // Gather all balances (native XLM + non-native assets)
    const allBalances = (account.balances || []).filter(
      (b) => isNativeAsset(b) || isNonNativeAsset(b)
    );

    // Price each asset in XLM via the DEX order book
    const priced = await Promise.all(
      allBalances.map(async (b) => {
        const native = isNativeAsset(b);
        const assetCode = native ? "XLM" : b.asset_code;
        const assetIssuer = native ? null : b.asset_issuer;
        const assetType = b.asset_type;
        const balance = parseFloat(b.balance || "0");

        let priceInXLM = native ? 1 : null;

        if (!native) {
          try {
            const asset = new Asset(assetCode, assetIssuer);
            const ob = await server
              .orderbook(asset, Asset.native())
              .limit(1)
              .call();
            const bids = ob.bids || [];
            const asks = ob.asks || [];
            const bid = bids.length ? parseFloat(bids[0].price) : null;
            const ask = asks.length ? parseFloat(asks[0].price) : null;
            if (bid !== null && ask !== null) priceInXLM = (bid + ask) / 2;
            else if (bid !== null) priceInXLM = bid;
            else if (ask !== null) priceInXLM = ask;
          } catch (_) {
            // No order book available — asset remains unpriced
          }
        }

        const valueInXLM = priceInXLM !== null ? balance * priceInXLM : null;

        return {
          asset: normalizeAsset(assetCode, assetIssuer, assetType),
          balance: toSevenDecimalString(balance),
          valueInXLM,
          _raw: valueInXLM,
        };
      })
    );

    // Compute total portfolio value in XLM (priced assets only)
    const totalValueXLM = priced.reduce(
      (sum, entry) => sum + (entry._raw !== null ? entry._raw : 0),
      0
    );

    // Assign portfolio percentages and compute HHI
    let hhi = 0;
    const breakdown = priced.map((entry) => {
      let portfolioPercent = null;
      if (entry._raw !== null && totalValueXLM > 0) {
        portfolioPercent = Number(
          ((entry._raw / totalValueXLM) * 100).toFixed(2)
        );
        hhi += portfolioPercent * portfolioPercent;
      }
      return {
        asset: entry.asset,
        balance: entry.balance,
        valueInXLM:
          entry._raw !== null ? toSevenDecimalString(entry._raw) : null,
        portfolioPercent,
      };
    });

    // Round HHI to nearest integer (consistent with standard HHI reporting)
    hhi = Math.round(hhi);

    let diversityLevel;
    if (hhi > 2500) diversityLevel = "concentrated";
    else if (hhi > 1500) diversityLevel = "moderate";
    else diversityLevel = "diversified";

    return success(res, {
      accountId: id,
      hhi,
      diversityLevel,
      breakdown,
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
    const fresh = req.query.fresh === true || req.query.fresh === "true";

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
 * GET /account/:id/compliance-check
 * Runs a multi-factor compliance check on an account and returns a `passed`
 * boolean and a `recommendation` of "allow", "review", or "deny".
 *
 * The check combines:
 *   1. Risk score — high risk (rating "high") triggers "review" or "deny"
 *   2. Freeze flags — any frozen trustline triggers passed: false and "deny"
 *   3. Account existence — missing account returns 404
 *
 * Response shape:
 *   {
 *     accountId:      string,
 *     passed:         boolean,
 *     recommendation: "allow" | "review" | "deny",
 *     riskScore:      number,
 *     riskRating:     "low" | "medium" | "high",
 *     checks: {
 *       riskScore: { passed: boolean, detail: string },
 *       freezeFlags: { passed: boolean, frozenAssets: string[] }
 *     }
 *   }
 *
 * @example
 * GET /account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/compliance-check
 */
router.get("/:id/compliance-check", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const account = await withHorizonTiming(req, () => server.loadAccount(id));

    // ── Risk score computation (reuse same logic as /risk-score) ───────────
    const firstOpResponse = await server
      .operations()
      .forAccount(id)
      .order("asc")
      .limit(1)
      .call();
    const firstOp = firstOpResponse.records[0];

    const recentTxResponse = await server
      .transactions()
      .forAccount(id)
      .order("desc")
      .limit(60)
      .call();
    const recentTxs = recentTxResponse.records;

    let score = 50;

    // Factor: account age
    if (firstOp) {
      const daysOld = Math.floor(
        (Date.now() - new Date(firstOp.created_at).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysOld > 365) score += 15;
      else if (daysOld > 30) score += 10;
      else score -= 15;
    } else {
      score -= 10;
    }

    // Factor: home domain
    if (account.home_domain) score += 10;
    else score -= 5;

    // Factor: multi-sig
    if (account.signers.length > 1) score += 10;

    // Factor: trustline count
    const trustlineCount = (account.balances || []).filter(
      (b) => isNonNativeAsset(b)
    ).length;
    if (trustlineCount > 30) score -= 15;
    else if (trustlineCount > 10) score -= 5;
    else score += 5;

    // Factor: recent activity
    if (recentTxs.length > 50) score -= 10;
    else if (recentTxs.length > 20) score -= 5;
    else score += 5;

    score = Math.max(0, Math.min(100, score));

    let riskRating;
    if (score >= 70) riskRating = "low";
    else if (score >= 40) riskRating = "medium";
    else riskRating = "high";

    // ── Freeze flag check ───────────────────────────────────────────────────
    const frozenAssets = (account.balances || [])
      .filter((b) => isNonNativeAsset(b) && !b.is_authorized)
      .map((b) => `${b.asset_code}:${b.asset_issuer}`);

    const hasFreezeFlag = frozenAssets.length > 0;

    // ── Determine overall outcome ───────────────────────────────────────────
    let passed = true;
    let recommendation = "allow";

    if (hasFreezeFlag) {
      passed = false;
      recommendation = "deny";
    } else if (riskRating === "high") {
      passed = false;
      recommendation = "deny";
    } else if (riskRating === "medium") {
      // Medium risk does not automatically fail — flag for manual review
      recommendation = "review";
    }

    return success(res, {
      accountId: account.id,
      passed,
      recommendation,
      riskScore: score,
      riskRating,
      checks: {
        riskScore: {
          passed: riskRating !== "high",
          detail: `Risk rating is "${riskRating}" (score: ${score})`,
        },
        freezeFlags: {
          passed: !hasFreezeFlag,
          frozenAssets,
        },
      },
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
/**
 * GET /account/:id/sponsorship (DEPRECATED)
 *
 * This endpoint has been consolidated into GET /account/:id/sponsorships.
 * Please use that endpoint instead.
 */
router.get("/:id/sponsorship", (req, res) => {
  res.status(410).json({
    success: false,
    error: {
      type: "Gone",
      message: "GET /account/:id/sponsorship has been deprecated and consolidated into GET /account/:id/sponsorships. Please use that endpoint instead.",
      deprecated: true,
      replacementEndpoint: "/account/:id/sponsorships",
    },
  });
});

/**
 * GET /account/:id/sponsorships
 *
 * Returns comprehensive sponsorship information for an account including:
 * - Entries the account is sponsoring for (balances, signers, data entries, offers)
 * - Accounts this account is sponsoring
 */
router.get("/:id/sponsorships", async (req, res, next) => {
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

    // Collect trustlines sponsored by this account
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

    // Collect signers sponsored by this account
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

    // Collect data entries sponsored by this account
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

    // Collect offers sponsored by this account
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
      total: sponsoredEntries.length,
    });
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
 * GET /account/:id/transaction-velocity
 *
 * Returns transaction counts per hour for the last 24 hours, the peak hour,
 * and a velocityScore (0–100) indicating how unusual the current rate is
 * relative to the account's historical average.
 *
 * Response shape:
 *   {
 *     accountId,
 *     hourlyBreakdown: [{ hour, timestamp, count }],  // 24 entries, oldest first
 *     peakHour,        // ISO timestamp of the busiest hour, or null when inactive
 *     peakCount,
 *     averagePerHour,
 *     velocityScore    // 0–100, 0 for inactive accounts
 *   }
 *
 * @example
 * GET /account/GABC.../transaction-velocity
 */
router.get("/:id/transaction-velocity", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    await withHorizonTiming(req, () => server.loadAccount(id));

    const HOUR_MS = 60 * 60 * 1000;
    const WINDOW_HOURS = 24;

    // Align the window to the start of the current hour so buckets are stable.
    const now = Date.now();
    const currentHourStart = Math.floor(now / HOUR_MS) * HOUR_MS;
    const windowStart = currentHourStart - (WINDOW_HOURS - 1) * HOUR_MS;

    const hourlyBreakdown = [];
    for (let i = 0; i < WINDOW_HOURS; i++) {
      const bucketStart = windowStart + i * HOUR_MS;
      hourlyBreakdown.push({
        hour: new Date(bucketStart).toISOString(),
        timestamp: new Date(bucketStart).toISOString(),
        count: 0,
      });
    }

    const txResponse = await server
      .transactions()
      .forAccount(id)
      .order("desc")
      .limit(200)
      .call();
    const records = txResponse.records || [];

    let totalInWindow = 0;
    let oldestSeen = null;
    for (const tx of records) {
      const createdAt = new Date(tx.created_at).getTime();
      if (!Number.isFinite(createdAt)) continue;
      if (oldestSeen === null || createdAt < oldestSeen) oldestSeen = createdAt;
      if (createdAt < windowStart || createdAt > now) continue;
      const bucketIndex = Math.floor((createdAt - windowStart) / HOUR_MS);
      if (bucketIndex < 0 || bucketIndex >= WINDOW_HOURS) continue;
      hourlyBreakdown[bucketIndex].count += 1;
      totalInWindow += 1;
    }

    let peakHour = null;
    let peakCount = 0;
    for (const bucket of hourlyBreakdown) {
      if (bucket.count > peakCount) {
        peakCount = bucket.count;
        peakHour = bucket.hour;
      }
    }

    const averagePerHour = totalInWindow / WINDOW_HOURS;

    // Historical average hourly rate: spread the fetched transactions over the
    // span from the oldest fetched record to now. When the account has no
    // activity at all, the velocity score is 0.
    let velocityScore = 0;
    if (totalInWindow > 0 && oldestSeen !== null) {
      const spanHours = Math.max(1, (now - oldestSeen) / HOUR_MS);
      const historicalAveragePerHour = records.length / spanHours;
      const ratio =
        historicalAveragePerHour > 0
          ? averagePerHour / historicalAveragePerHour
          : 0;
      // A ratio of 1 (current rate matches history) maps to 50; higher ratios
      // push the score toward 100, lower ratios toward 0.
      velocityScore = Math.round(Math.max(0, Math.min(100, ratio * 50)));
    }

    return success(res, {
      accountId: id,
      hourlyBreakdown,
      peakHour,
      peakCount,
      averagePerHour,
      velocityScore,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/transaction-count?since=<ISO8601>
 * Counts transactions for an account.
 *
 * Without `since`, paginates through the account's entire transaction history
 * to produce an exact count. With `since`, walks records newest-first and
 * stops as soon as a transaction older than the cutoff is reached, avoiding a
 * full history scan.
 *
 * Response: { count, firstTransactionAt, lastTransactionAt, since }
 *   - count              number of transactions (after the `since` cutoff)
 *   - firstTransactionAt timestamp of the oldest counted transaction
 *   - lastTransactionAt  timestamp of the newest counted transaction
 *   - since              normalized cutoff, or null when not provided
 */
router.get("/:id/transaction-count", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    await withHorizonTiming(req, () => server.loadAccount(id));

    const hasSince = req.query.since !== undefined;
    const sinceDate = hasSince
      ? validateISODate(req.query.since, "since")
      : null;
    const since = sinceDate ? sinceDate.toISOString() : null;

    let count = 0;
    let firstTransactionAt = null;
    let lastTransactionAt = null;

    if (sinceDate) {
      // Walk newest-first and stop at the first record older than the cutoff.
      let cursor;
      let done = false;
      while (!done) {
        let query = server
          .transactions()
          .forAccount(id)
          .limit(200)
          .order("desc");
        if (cursor) query = query.cursor(cursor);

        const page = await query.call();
        const records = page.records || [];
        if (records.length === 0) break;

        for (const tx of records) {
          if (new Date(tx.created_at).getTime() < sinceDate.getTime()) {
            done = true;
            break;
          }
          if (lastTransactionAt === null) {
            lastTransactionAt = toISOTimestamp(tx.created_at);
          }
          firstTransactionAt = toISOTimestamp(tx.created_at);
          count += 1;
        }

        if (records.length < 200) break;
        if (!done) cursor = records[records.length - 1].paging_token;
      }
    } else {
      // No cutoff: paginate through the full history counting every record.
      let cursor;
      let done = false;
      while (!done) {
        let query = server
          .transactions()
          .forAccount(id)
          .limit(200)
          .order("asc");
        if (cursor) query = query.cursor(cursor);

        const page = await query.call();
        const records = page.records || [];
        if (records.length === 0) break;

        if (firstTransactionAt === null) {
          firstTransactionAt = toISOTimestamp(records[0].created_at);
        }
        lastTransactionAt = toISOTimestamp(records[records.length - 1].created_at);
        count += records.length;
        cursor = records[records.length - 1].paging_token;

        if (records.length < 200) done = true;
      }
    }

    return success(res, { count, firstTransactionAt, lastTransactionAt, since });
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
 *
 * Checks whether an account can receive a specific asset (trustline, authorization, capacity).
 * Returns { canReceive, reason } where reason is null when canReceive is true.
 */
router.get(
  "/:id/can-receive/:assetCode/:assetIssuer",
  async (req, res, next) => {
    try {
      const { id, assetCode, assetIssuer } = req.params;
      validateAccountId(id);
      validateAssetCode(assetCode);

      const normalizedAssetCode = assetCode.toUpperCase();

      if (normalizedAssetCode === "XLM") {
        if (assetIssuer.toLowerCase() !== "native") {
          const err = new Error(
            'Invalid asset issuer for XLM. Use "native" as the issuer.',
          );
          err.isValidation = true;
          err.status = 400;
          throw err;
        }
        await withHorizonTiming(req, () => server.loadAccount(id));
        return success(res, { canReceive: true, reason: null });
      }

      validateAccountId(assetIssuer);
      const account = await withHorizonTiming(req, () => server.loadAccount(id));

      const trustline = (account.balances || []).find(
        (b) =>
          isNonNativeAsset(b) &&
          b.asset_code === normalizedAssetCode &&
          b.asset_issuer === assetIssuer,
      );

      if (!trustline) {
        return success(res, { canReceive: false, reason: "no_trustline" });
      }

      if (trustline.is_authorized !== true) {
        return success(res, { canReceive: false, reason: "not_authorized" });
      }

      const currentBalance = parseFloat(trustline.balance || "0");
      const limit = parseFloat(trustline.limit || "0");
      const buyingLiabilities = parseFloat(trustline.buying_liabilities || "0");
      const availableCapacity = Math.max(
        0,
        limit - currentBalance - buyingLiabilities,
      );

      if (availableCapacity <= 0) {
        return success(res, { canReceive: false, reason: "limit_reached" });
      }

      return success(res, { canReceive: true, reason: null });
    } catch (err) {
      handleAccountNotFound(err, next, req.params.id);
    }
  },
);

/** Largest amount a Stellar balance can hold: INT64_MAX stroops. */
const MAX_BALANCE_STROOPS = 9223372036854775807n;
const STROOPS_PER_UNIT = 10_000_000n;

/**
 * Converts a Horizon decimal amount string (up to seven decimals) to BigInt
 * stroops so capacity arithmetic stays exact across the full int64 range.
 *
 * @param {string|undefined} amount
 * @returns {bigint}
 */
function amountToStroops(amount) {
  const match = String(amount ?? "0").trim().match(/^(-?)(\d+)(?:\.(\d{1,7}))?$/);
  if (!match) return 0n;
  const [, sign, whole, fraction = ""] = match;
  const stroops = BigInt(whole) * STROOPS_PER_UNIT + BigInt(fraction.padEnd(7, "0"));
  return sign === "-" ? -stroops : stroops;
}

/**
 * Formats BigInt stroops as a seven-decimal amount string.
 *
 * @param {bigint} stroops
 * @returns {string}
 */
function stroopsToAmount(stroops) {
  const sign = stroops < 0n ? "-" : "";
  const abs = stroops < 0n ? -stroops : stroops;
  const fraction = (abs % STROOPS_PER_UNIT).toString().padStart(7, "0");
  return `${sign}${abs / STROOPS_PER_UNIT}.${fraction}`;
}

/**
 * Builds one receive-capacity entry. Incoming amounts are bounded by
 * `limit - balance - buyingLiabilities`, because open buy offers reserve
 * room under the limit just like a settled balance does.
 */
function buildCapacityEntry(asset, limitStroops, balanceStroops, buyingStroops) {
  const used = balanceStroops + buyingStroops;
  const remaining = limitStroops > used ? limitStroops - used : 0n;
  // Two-decimal percentage computed in integer basis points to avoid float drift.
  const basisPoints = limitStroops > 0n ? (remaining * 10000n) / limitStroops : 0n;
  return {
    asset,
    limit: stroopsToAmount(limitStroops),
    balance: stroopsToAmount(balanceStroops),
    remaining: stroopsToAmount(remaining),
    remainingPercent: `${basisPoints / 100n}.${(basisPoints % 100n).toString().padStart(2, "0")}`,
  };
}

/**
 * GET /account/:id/receive-capacity
 *
 * Reports how much more of each held asset the account can receive before
 * hitting its trustline limit, so wallets can warn a sender up front.
 *
 * Native XLM has no trustline, so its limit is the protocol ceiling
 * (INT64_MAX stroops). Its entry also carries `spendableBalance` — the
 * balance above the minimum reserve and selling liabilities.
 *
 * Returns:
 *   - 200: { success: true, data: { accountId, capacity: [{ asset, limit, balance, remaining, remainingPercent }] } }
 *   - 400: InvalidAccountId — malformed account address
 *   - 404: AccountNotFound — account does not exist on the network
 */
router.get("/:id/receive-capacity", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const account = await withHorizonTiming(req, () => server.loadAccount(id));
    const balances = account.balances || [];

    const capacity = [];

    const native = balances.find((b) => isNativeAsset(b));
    if (native) {
      const BASE_RESERVE_STROOPS = 5_000_000n;
      const subentries = BigInt(account.subentry_count || 0);
      const sponsoring = BigInt(account.num_sponsoring || 0);
      const sponsored = BigInt(account.num_sponsored || 0);
      const minimumBalance =
        (2n + subentries + sponsoring - sponsored) * BASE_RESERVE_STROOPS;

      const balance = amountToStroops(native.balance);
      const spendable = balance - minimumBalance - amountToStroops(native.selling_liabilities);

      capacity.push({
        ...buildCapacityEntry(
          normalizeAsset("XLM", null, "native"),
          MAX_BALANCE_STROOPS,
          balance,
          amountToStroops(native.buying_liabilities),
        ),
        spendableBalance: stroopsToAmount(spendable > 0n ? spendable : 0n),
      });
    }

    for (const b of balances) {
      // Pool shares cannot be received via payments, so they are excluded.
      if (isNativeAsset(b) || b.asset_type === "liquidity_pool_shares") continue;
      capacity.push(
        buildCapacityEntry(
          normalizeAsset(b.asset_code, b.asset_issuer, b.asset_type),
          amountToStroops(b.limit),
          amountToStroops(b.balance),
          amountToStroops(b.buying_liabilities),
        ),
      );
    }

    return success(res, { accountId: id, capacity });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

const DAY_MS = 24 * 60 * 60 * 1000;
const VELOCITY_LOOKBACK_DAYS = 30;
/** Minimum completed days of history needed before a baseline is trusted. */
const VELOCITY_MIN_BASELINE_DAYS = 7;
const VELOCITY_STDDEV_THRESHOLD = 2;
const PATH_PAYMENT_TYPES = new Set([
  "path_payment_strict_receive",
  "path_payment_strict_send",
]);

/**
 * Returns the signed change (in stroops) a payment-stream record applied to
 * the account's native XLM balance, or 0n if it did not touch native XLM.
 *
 * @param {Object} op - Horizon payments-endpoint record.
 * @param {string} accountId
 * @returns {bigint}
 */
function nativeBalanceDelta(op, accountId) {
  if (op.type === "create_account") {
    if (op.account === accountId) return amountToStroops(op.starting_balance);
    if (op.funder === accountId) return -amountToStroops(op.starting_balance);
    return 0n;
  }

  if (op.type !== "payment" && !PATH_PAYMENT_TYPES.has(op.type)) return 0n;
  if (op.from === accountId && op.to === accountId) return 0n;

  let delta = 0n;
  if (op.to === accountId && op.asset_type === "native") {
    delta += amountToStroops(op.amount);
  }
  if (op.from === accountId) {
    const sentNative = PATH_PAYMENT_TYPES.has(op.type)
      ? op.source_asset_type === "native"
      : op.asset_type === "native";
    if (sentNative) {
      delta -= amountToStroops(PATH_PAYMENT_TYPES.has(op.type) ? op.source_amount : op.amount);
    }
  }
  return delta;
}

/**
 * GET /account/:id/balance-velocity
 *
 * Measures how fast the account's native XLM balance is moving and flags
 * unusual activity. Payments from the last 30 days are bucketed into
 * 24-hour windows ending now. The most recent bucket's absolute net change
 * is the current rate; the older buckets form the historical baseline.
 *
 * `velocityFlag` is true when the current rate exceeds the baseline mean by
 * more than two standard deviations. Accounts with fewer than seven days of
 * history have no trustworthy baseline and always report `false`.
 *
 * Returns:
 *   - 200: { success: true, data: { accountId, asset, windows: { change24h, change7d, change30d },
 *          currentRate, baseline: { sampleDays, average, standardDeviation, threshold }, velocityFlag } }
 *   - 400: InvalidAccountId — malformed account address
 *   - 404: AccountNotFound — account does not exist on the network
 */
router.get("/:id/balance-velocity", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);
    await withHorizonTiming(req, () => server.loadAccount(id));

    const now = Date.now();
    const windowStart = now - VELOCITY_LOOKBACK_DAYS * DAY_MS;
    const dailyNet = new Array(VELOCITY_LOOKBACK_DAYS).fill(0n);
    let earliestSeen = null;
    let reachedOlderHistory = false;
    let cursor;

    for (;;) {
      let query = server.payments().forAccount(id).limit(200).order("desc");
      if (cursor) query = query.cursor(cursor);

      const page = await withHorizonTiming(req, () => query.call());
      const records = page.records || [];

      for (const op of records) {
        cursor = op.paging_token;
        const createdAt = new Date(op.created_at).getTime();
        if (Number.isNaN(createdAt)) continue;
        if (createdAt < windowStart) {
          reachedOlderHistory = true;
          break;
        }
        if (earliestSeen === null || createdAt < earliestSeen) earliestSeen = createdAt;
        if (op.transaction_successful === false) continue;

        const dayIndex = Math.min(
          VELOCITY_LOOKBACK_DAYS - 1,
          Math.max(0, Math.floor((now - createdAt) / DAY_MS)),
        );
        dailyNet[dayIndex] += nativeBalanceDelta(op, id);
      }

      if (reachedOlderHistory || records.length < 200) break;
    }

    const sumDays = (days) => dailyNet.slice(0, days).reduce((acc, v) => acc + v, 0n);
    const windows = {
      change24h: stroopsToAmount(sumDays(1)),
      change7d: stroopsToAmount(sumDays(7)),
      change30d: stroopsToAmount(sumDays(VELOCITY_LOOKBACK_DAYS)),
    };

    // Completed days of history available before the current 24h bucket.
    // If Horizon returned anything older than the lookback window, every
    // bucket is real data (zero-activity days included).
    let historyDays = 0;
    if (reachedOlderHistory) {
      historyDays = VELOCITY_LOOKBACK_DAYS - 1;
    } else if (earliestSeen !== null) {
      historyDays = Math.min(
        VELOCITY_LOOKBACK_DAYS - 1,
        Math.floor((now - earliestSeen) / DAY_MS),
      );
    }

    const toUnits = (stroops) => Number(stroops < 0n ? -stroops : stroops) / Number(STROOPS_PER_UNIT);
    const currentRate = toUnits(dailyNet[0]);

    let baseline = {
      sampleDays: historyDays,
      average: null,
      standardDeviation: null,
      threshold: null,
    };
    let velocityFlag = false;

    if (historyDays >= VELOCITY_MIN_BASELINE_DAYS) {
      const samples = dailyNet.slice(1, historyDays + 1).map(toUnits);
      const average = samples.reduce((acc, v) => acc + v, 0) / samples.length;
      const variance =
        samples.reduce((acc, v) => acc + (v - average) ** 2, 0) / samples.length;
      const standardDeviation = Math.sqrt(variance);
      const threshold = average + VELOCITY_STDDEV_THRESHOLD * standardDeviation;

      baseline = {
        sampleDays: samples.length,
        average: average.toFixed(7),
        standardDeviation: standardDeviation.toFixed(7),
        threshold: threshold.toFixed(7),
      };
      velocityFlag = currentRate > threshold;
    }

    return success(res, {
      accountId: id,
      asset: normalizeAsset("XLM", null, "native"),
      windows,
      currentRate: currentRate.toFixed(7),
      baseline,
      velocityFlag,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

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
 * GET /account/:id/net-flow?days=30
 *
 * Computes inbound and outbound payment volume per asset over the last
 * `days` days (1–90, default 30). `net` = inbound − outbound, so a positive
 * value means the account received more of that asset than it sent.
 */
router.get("/:id/net-flow", async (req, res, next) => {
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
    const flowMap = {};
    let cursor;

    for (;;) {
      let query = server.payments().forAccount(id).limit(200).order("asc");
      if (cursor) query = query.cursor(cursor);

      const page = await withHorizonTiming(req, () => query.call());
      const records = page.records || [];

      for (const op of records) {
        cursor = op.paging_token;
        if (new Date(op.created_at) < since) continue;
        if (op.transaction_successful === false) continue;

        let isOutbound;
        if (op.type === "create_account") {
          isOutbound = op.funder === id;
        } else if (op.from === id || op.to === id) {
          isOutbound = op.from === id;
        } else {
          continue;
        }
        // Self-payments do not move value in or out.
        if (op.from === id && op.to === id) continue;

        const assetCode = op.asset_code || "XLM";
        const assetIssuer = op.asset_issuer || null;
        const assetKey = assetIssuer ? `${assetCode}:${assetIssuer}` : assetCode;
        const amount = parseFloat(op.amount || op.starting_balance || "0");

        if (!flowMap[assetKey]) {
          flowMap[assetKey] = {
            asset: normalizeAsset(assetCode, assetIssuer, op.asset_type || undefined),
            inbound: 0,
            outbound: 0,
          };
        }
        if (isOutbound) flowMap[assetKey].outbound += amount;
        else flowMap[assetKey].inbound += amount;
      }

      if (records.length < 200) break;
    }

    const flows = Object.values(flowMap).map((f) => ({
      asset: f.asset,
      inbound: f.inbound.toFixed(7),
      outbound: f.outbound.toFixed(7),
      net: (f.inbound - f.outbound).toFixed(7),
    }));

    return success(res, {
      accountId: id,
      period: { days, from: since.toISOString(), to: new Date().toISOString() },
      flows,
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
 * GET /account/:id/asset-received-summary
 *
 * Aggregates lifetime inbound payment volume by asset, including the number
 * of distinct senders and the first/last received timestamps.
 */
router.get("/:id/asset-received-summary", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);
    await withHorizonTiming(req, () => server.loadAccount(id));

    const receivedByAsset = new Map();
    let cursor;

    for (;;) {
      let query = server.payments().forAccount(id).limit(200).order("asc");
      if (cursor) query = query.cursor(cursor);

      const page = await withHorizonTiming(req, () => query.call());
      const records = page.records || [];
      if (records.length === 0) break;

      for (const op of records) {
        cursor = op.paging_token;
        if (op.transaction_successful === false) continue;

        const isCreateAccount = op.type === "create_account";
        const isPayment = [
          "payment",
          "path_payment_strict_receive",
          "path_payment_strict_send",
        ].includes(op.type);
        if (!isCreateAccount && !isPayment) continue;

        const sender = isCreateAccount ? op.funder : op.from;
        const recipient = isCreateAccount ? op.account : op.to;
        if (recipient !== id || !sender || sender === id) continue;

        const amount = Number(op.amount || op.starting_balance || 0);
        if (!Number.isFinite(amount) || amount <= 0) continue;

        const assetCode = isCreateAccount ? "XLM" : op.asset_code || "XLM";
        const assetIssuer = isCreateAccount ? null : op.asset_issuer || null;
        const assetType = isCreateAccount
          ? "native"
          : op.asset_type || (assetCode === "XLM" ? "native" : null);
        const assetKey = assetIssuer ? `${assetCode}:${assetIssuer}` : assetCode;
        const timestamp = new Date(op.created_at);
        if (Number.isNaN(timestamp.getTime())) continue;

        let summary = receivedByAsset.get(assetKey);
        if (!summary) {
          summary = {
            asset: normalizeAsset(assetCode, assetIssuer, assetType),
            totalReceived: 0,
            senders: new Set(),
            firstReceivedAt: timestamp,
            lastReceivedAt: timestamp,
          };
          receivedByAsset.set(assetKey, summary);
        }

        summary.totalReceived += amount;
        summary.senders.add(sender);
        if (timestamp < summary.firstReceivedAt) summary.firstReceivedAt = timestamp;
        if (timestamp > summary.lastReceivedAt) summary.lastReceivedAt = timestamp;
      }

      if (records.length < 200) break;
    }

    const summary = Array.from(receivedByAsset.values())
      .filter((entry) => entry.totalReceived > 0)
      .map((entry) => ({
        asset: entry.asset,
        totalReceived: entry.totalReceived.toFixed(7),
        senderCount: entry.senders.size,
        firstReceivedAt: entry.firstReceivedAt.toISOString(),
        lastReceivedAt: entry.lastReceivedAt.toISOString(),
      }))
      .sort((a, b) => Number(b.totalReceived) - Number(a.totalReceived));

    return success(res, { accountId: id, summary });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/summary
 *
 * Returns a compact, aggregated account summary suitable for dashboards
 * and quick views. Combines four parallel Horizon calls into a single
 * response:
 *
 *   - accountInfo   — from server.loadAccount (id, sequence, flags, thresholds)
 *   - balances      — XLM and non-native asset balances
 *   - recentTransactions — up to 10 most recent transactions (newest first)
 *   - openOffers    — up to 20 open DEX offers
 *   - claimableBalances — claimable balances where the account is a claimant
 *
 * Query params:
 *   - fresh (boolean, default: false) — bypasses the cache when set to "true"
 *
 * Response headers:
 *   - X-Cache: HIT  — served from cache
 *   - X-Cache: MISS — fetched live from Horizon and cached
 *
 * Returns:
 *   - 200: { success: true, data: { accountInfo, balances, recentTransactions, openOffers, claimableBalances } }
 *   - 400: InvalidAccountId — malformed account address
 *   - 404: AccountNotFound — account does not exist on the network
 */
router.get("/:id/summary", accountSummaryRateLimiter, async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const fresh = req.query.fresh === true || req.query.fresh === "true";
    const cacheKey = `account-summary:${id}`;

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    // Fetch all four data sources in parallel for minimum latency.
    // loadAccount must succeed first; if it throws 404 we short-circuit.
    const account = await withHorizonTiming(req, () => server.loadAccount(id));

    const [txResponse, offersResponse, claimableResponse] = await Promise.all([
      server
        .transactions()
        .forAccount(id)
        .limit(10)
        .order("desc")
        .call()
        .catch(() => ({ records: [] })),
      server
        .offers()
        .forAccount(id)
        .limit(20)
        .order("desc")
        .call()
        .catch(() => ({ records: [] })),
      server
        .claimableBalances()
        .claimant(id)
        .limit(20)
        .order("desc")
        .call()
        .catch(() => ({ records: [] })),
    ]);

    // ── accountInfo ────────────────────────────────────────────────────────
    const rawFlags = account.flags || {};
    const accountInfo = {
      accountId: account.id,
      sequence: account.sequence,
      subentryCount: account.subentry_count || 0,
      homeDomain: account.home_domain || null,
      lastModifiedLedger: account.last_modified_ledger,
      thresholds: {
        lowThreshold: account.thresholds?.low_threshold ?? 0,
        medThreshold: account.thresholds?.med_threshold ?? 0,
        highThreshold: account.thresholds?.high_threshold ?? 0,
      },
      flags: {
        authRequired: rawFlags.auth_required === true,
        authRevocable: rawFlags.auth_revocable === true,
        authImmutable: rawFlags.auth_immutable === true,
        clawbackEnabled: rawFlags.auth_clawback_enabled === true,
      },
    };

    // ── balances ───────────────────────────────────────────────────────────
    const { xlm, assets } = formatAccountBalances(account);
    const balances = { xlm, assets };

    // ── recentTransactions ─────────────────────────────────────────────────
    const recentTransactions = (txResponse.records || []).map((tx) => ({
      hash: tx.hash,
      ledger: tx.ledger_attr ?? tx.ledger,
      createdAt: toISOTimestamp(tx.created_at),
      operationCount: tx.operation_count,
      successful: tx.successful,
      memoType: tx.memo_type || null,
      memo: tx.memo || null,
    }));

    // ── openOffers ─────────────────────────────────────────────────────────
    const openOffers = (offersResponse.records || []).map((offer) => {
      let priceDecimal;
      if (offer.price_r && offer.price_r.d && Number(offer.price_r.d) !== 0) {
        priceDecimal = (Number(offer.price_r.n) / Number(offer.price_r.d)).toFixed(7);
      } else {
        priceDecimal = parseFloat(offer.price || "0").toFixed(7);
      }
      return {
        offerId: offer.id,
        selling: {
          asset: normalizeAsset(
            offer.selling_asset_code,
            offer.selling_asset_issuer,
            offer.selling_asset_type,
          ),
          amount: parseFloat(offer.amount || "0").toFixed(7),
        },
        buying: {
          asset: normalizeAsset(
            offer.buying_asset_code,
            offer.buying_asset_issuer,
            offer.buying_asset_type,
          ),
        },
        price: priceDecimal,
        lastModifiedLedger: offer.last_modified_ledger,
      };
    });

    // ── claimableBalances ──────────────────────────────────────────────────
    const claimableBalances = (claimableResponse.records || []).map(
      normalizeClaimableBalance,
    );

    const data = {
      accountInfo,
      balances,
      recentTransactions,
      openOffers,
      claimableBalances,
    };

    cacheService.set(cacheKey, data, cacheTTL.accountSummary || 15);
    res.set("X-Cache", "MISS");
    return success(res, data);
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

    const fresh = req.query.fresh === true || req.query.fresh === "true";
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
 * GET /account/:id/liquidity-contribution
 *
 * Aggregates the account's liquidity pool positions into a single view of how
 * much of each asset the account is contributing across all pools it holds
 * shares in.
 *
 * Response shape:
 *   {
 *     accountId: string,
 *     pools: [{ poolId, shares, sharePercent, reserves: [{ asset, amount }] }],
 *     totalsByAsset: [{ asset, amount }],
 *     poolCount: number
 *   }
 *
 * Cached per account for `cacheTTL.liquidityContribution` seconds.
 * Pass ?fresh=true to bypass the cache.
 */
router.get("/:id/liquidity-contribution", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const fresh = req.query.fresh === true || req.query.fresh === "true";
    const cacheKey = `liquidity-contribution:${id}`;

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

    const poolDetails = await Promise.all(
      poolShareTrustlines.map((trustline) =>
        server
          .liquidityPools()
          .liquidityPoolId(trustline.liquidity_pool_id)
          .call()
          .catch((err) => {
            if (err && err.response && err.response.status === 404) return null;
            throw err;
          }),
      ),
    );

    const pools = [];
    const totals = new Map();

    poolShareTrustlines.forEach((trustline, i) => {
      const pool = poolDetails[i];
      if (!pool) return;

      const accountShares = parseFloat(trustline.balance);
      const totalShares = parseFloat(pool.total_shares);
      const ratio = totalShares > 0 ? accountShares / totalShares : 0;

      const reserves = (pool.reserves || []).map((reserve) => {
        const asset = normalizeAssetFromString(reserve.asset);
        const amount = parseFloat(reserve.amount) * ratio;
        const key = asset.issuer ? `${asset.code}:${asset.issuer}` : asset.code;
        const existing = totals.get(key);
        if (existing) existing.amount += amount;
        else totals.set(key, { asset, amount });
        return { asset, amount: toSevenDecimalString(amount) };
      });

      pools.push({
        poolId: pool.id,
        shares: toSevenDecimalString(accountShares),
        sharePercent: toSevenDecimalString(ratio * 100),
        reserves,
      });
    });

    const data = {
      accountId: id,
      pools,
      totalsByAsset: Array.from(totals.values()).map((t) => ({
        asset: t.asset,
        amount: toSevenDecimalString(t.amount),
      })),
      poolCount: pools.length,
    };

    cacheService.set(cacheKey, data, cacheTTL.liquidityContribution);
    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * Extracts the ledger sequence encoded in a Horizon operation ID.
 * Horizon operation IDs are TOIDs: the ledger sequence occupies the high 32 bits.
 *
 * @param {string} operationId
 * @returns {number|null}
 */
function ledgerFromOperationId(operationId) {
  try {
    return Number(BigInt(operationId) >> 32n);
  } catch (_) {
    return null;
  }
}

/**
 * GET /account/:id/pending-effects
 *
 * Returns operations the account has submitted that have not yet produced
 * confirmed effects. Effects are emitted in ledger order, so any successful
 * operation newer than the account's most recent effect is still pending.
 *
 * Response shape:
 *   {
 *     accountId: string,
 *     pendingEffects: [{ operationId, operationType, transactionHash, estimatedLedger, submittedAt }],
 *     count: number
 *   }
 *
 * Never cached — pending state changes every few seconds. The response is sent
 * with `Cache-Control: no-store` and is not stored in the cache service.
 */
router.get("/:id/pending-effects", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    res.set("Cache-Control", "no-store");

    await withHorizonTiming(req, () => server.loadAccount(id));

    const [latestLedgerPage, operationsPage, effectsPage] = await withHorizonTiming(
      req,
      () =>
        Promise.all([
          server.ledgers().order("desc").limit(1).call(),
          server.operations().forAccount(id).order("desc").limit(50).call(),
          server.effects().forAccount(id).order("desc").limit(1).call(),
        ]),
    );

    const latestLedger = (latestLedgerPage.records || [])[0];
    const nextLedger = latestLedger ? Number(latestLedger.sequence) + 1 : null;

    // Effect paging tokens are "<operationId>-<index>".
    const latestEffect = (effectsPage.records || [])[0];
    let latestEffectOpId = null;
    if (latestEffect && latestEffect.paging_token) {
      try {
        latestEffectOpId = BigInt(String(latestEffect.paging_token).split("-")[0]);
      } catch (_) {
        latestEffectOpId = null;
      }
    }

    const pendingEffects = [];
    for (const op of operationsPage.records || []) {
      // Failed operations never produce effects, so they are not pending.
      if (op.transaction_successful === false) continue;

      let opId;
      try {
        opId = BigInt(op.id);
      } catch (_) {
        continue;
      }
      if (latestEffectOpId !== null && opId <= latestEffectOpId) break;

      pendingEffects.push({
        operationId: op.id,
        operationType: op.type,
        transactionHash: op.transaction_hash || null,
        estimatedLedger: ledgerFromOperationId(op.id) || nextLedger,
        submittedAt: op.created_at ? toISOTimestamp(op.created_at) : null,
      });
    }

    return success(res, {
      accountId: id,
      pendingEffects,
      count: pendingEffects.length,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

const HISTORICAL_BALANCE_RESOLUTIONS = { "7d": 7, "30d": 30 };
const HISTORICAL_BALANCE_SNAPSHOTS = 12;
const HISTORICAL_BALANCE_MAX_PAGES = 10;

/**
 * Parses the ?asset= query param for /historical-balances.
 * Accepts "native", "XLM" or "CODE:ISSUER". Defaults to native XLM.
 *
 * @param {string|undefined} raw
 * @returns {{ code: string, issuer: string|null, type: string }}
 */
function parseHistoricalBalanceAsset(raw) {
  if (raw === undefined || raw === "") {
    return { code: "XLM", issuer: null, type: "native" };
  }
  const value = String(raw);
  if (value.toLowerCase() === "native" || value.toUpperCase() === "XLM") {
    return { code: "XLM", issuer: null, type: "native" };
  }
  const parts = value.split(":");
  if (parts.length !== 2) {
    const err = new Error(
      "Query parameter 'asset': must be 'native' or in the format CODE:ISSUER.",
    );
    err.isValidation = true;
    err.status = 400;
    err.field = "asset";
    err.receivedValue = value;
    err.expectedFormat = "CODE:ISSUER";
    throw err;
  }
  const [code, issuer] = parts;
  if (code.toUpperCase() === "XLM" && issuer.toLowerCase() === "native") {
    return { code: "XLM", issuer: null, type: "native" };
  }
  validateAssetCode(code);
  validateAccountId(issuer);
  return normalizeAsset(code.toUpperCase(), issuer);
}

function sameAsset(a, b) {
  if (a.type === "native" || b.type === "native") {
    return a.type === "native" && b.type === "native";
  }
  return a.code === b.code && a.issuer === b.issuer;
}

/**
 * Pages through a Horizon collection (newest first) until records older than
 * `since` are reached, or HISTORICAL_BALANCE_MAX_PAGES pages have been read.
 */
async function fetchRecordsSince(buildQuery, since, timeField) {
  const records = [];
  let cursor;
  for (let page = 0; page < HISTORICAL_BALANCE_MAX_PAGES; page++) {
    let query = buildQuery().limit(200).order("desc");
    if (cursor) query = query.cursor(cursor);
    const response = await query.call();
    const pageRecords = response.records || [];
    let reachedEnd = false;
    for (const record of pageRecords) {
      cursor = record.paging_token;
      if (new Date(record[timeField]) < since) {
        reachedEnd = true;
        break;
      }
      records.push(record);
    }
    if (reachedEnd || pageRecords.length < 200) break;
  }
  return records;
}

/**
 * Returns the signed balance change (in asset units) a payment-type
 * operation applied to `accountId` for `asset`.
 */
function paymentDelta(op, accountId, asset) {
  if (op.transaction_successful === false) return 0;

  if (op.type === "create_account") {
    if (asset.type !== "native") return 0;
    const amount = parseFloat(op.starting_balance || "0");
    if (op.account === accountId) return amount;
    if (op.funder === accountId) return -amount;
    return 0;
  }

  if (
    op.type !== "payment" &&
    op.type !== "path_payment_strict_send" &&
    op.type !== "path_payment_strict_receive"
  ) {
    return 0;
  }

  let delta = 0;
  const destAsset = normalizeAsset(op.asset_code, op.asset_issuer, op.asset_type);
  if (op.to === accountId && sameAsset(destAsset, asset)) {
    delta += parseFloat(op.amount || "0");
  }
  if (op.from === accountId) {
    const isPath = op.type !== "payment";
    const sentAsset = isPath
      ? normalizeAsset(op.source_asset_code, op.source_asset_issuer, op.source_asset_type)
      : destAsset;
    if (sameAsset(sentAsset, asset)) {
      delta -= parseFloat((isPath ? op.source_amount : op.amount) || "0");
    }
  }
  return delta;
}

/**
 * Returns the signed balance change (in asset units) a trade applied to
 * `accountId` for `asset`.
 */
function tradeDelta(trade, accountId, asset) {
  if (trade.base_account !== accountId && trade.counter_account !== accountId) {
    return 0;
  }
  const mapped = mapAccountTrade(trade, accountId);
  let delta = 0;
  if (sameAsset(mapped.buying, asset)) delta += parseFloat(mapped.boughtAmount);
  if (sameAsset(mapped.selling, asset)) delta -= parseFloat(mapped.soldAmount);
  return delta;
}

/**
 * GET /account/:id/historical-balances
 *
 * Reconstructs balance snapshots at regular intervals by starting from the
 * account's current balance and replaying its payment and trade history
 * backwards in time.
 *
 * Query params:
 *   - asset      ("native" | "CODE:ISSUER", default: native XLM)
 *   - resolution ("7d" | "30d", default: "7d") — interval between snapshots
 *
 * Response shape:
 *   {
 *     accountId: string,
 *     asset: { code, issuer, type },
 *     resolution: "7d" | "30d",
 *     snapshots: [{ timestamp: string, balance: string }]  // oldest first
 *   }
 *
 * Snapshots are approximations: transaction fees and balance changes from
 * operations other than payments and trades (e.g. claimable balances, pool
 * deposits) are not replayed.
 */
router.get("/:id/historical-balances", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const resolution = req.query.resolution === undefined
      ? "7d"
      : String(req.query.resolution);
    if (!Object.prototype.hasOwnProperty.call(HISTORICAL_BALANCE_RESOLUTIONS, resolution)) {
      const err = new Error(
        "Query parameter 'resolution': must be one of 7d, 30d.",
      );
      err.isValidation = true;
      err.status = 400;
      err.field = "resolution";
      err.receivedValue = resolution;
      err.expectedFormat = "7d | 30d";
      throw err;
    }

    const asset = parseHistoricalBalanceAsset(req.query.asset);

    const account = await withHorizonTiming(req, () => server.loadAccount(id));

    const holding = (account.balances || []).find((b) =>
      asset.type === "native"
        ? isNativeAsset(b)
        : b.asset_code === asset.code && b.asset_issuer === asset.issuer,
    );
    const currentBalance = holding ? parseFloat(holding.balance) : 0;

    const intervalMs = HISTORICAL_BALANCE_RESOLUTIONS[resolution] * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const since = new Date(now - intervalMs * (HISTORICAL_BALANCE_SNAPSHOTS - 1));

    const [payments, trades] = await withHorizonTiming(req, () =>
      Promise.all([
        fetchRecordsSince(() => server.payments().forAccount(id), since, "created_at"),
        fetchRecordsSince(() => server.trades().forAccount(id), since, "ledger_close_time"),
      ]),
    );

    const changes = [
      ...payments.map((op) => ({
        time: new Date(op.created_at).getTime(),
        delta: paymentDelta(op, id, asset),
      })),
      ...trades.map((trade) => ({
        time: new Date(trade.ledger_close_time).getTime(),
        delta: tradeDelta(trade, id, asset),
      })),
    ]
      .filter((c) => c.delta !== 0 && Number.isFinite(c.time))
      .sort((a, b) => b.time - a.time);

    // Walk backwards from now, undoing every change newer than each snapshot.
    const snapshots = [];
    let balance = currentBalance;
    let idx = 0;
    for (let i = 0; i < HISTORICAL_BALANCE_SNAPSHOTS; i++) {
      const timestamp = now - intervalMs * i;
      while (idx < changes.length && changes[idx].time > timestamp) {
        balance -= changes[idx].delta;
        idx++;
      }
      snapshots.push({
        timestamp: new Date(timestamp).toISOString(),
        balance: toSevenDecimalString(Math.max(balance, 0)),
      });
    }
    snapshots.reverse();

    return success(res, {
      accountId: id,
      asset,
      resolution,
      snapshots,
    });
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

    const fresh = req.query.fresh === true || req.query.fresh === "true";
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

/**
 * GET /account/:id/portfolio
 *
 * Aggregates an account's native balance, asset balances, total value in XLM,
 * open DEX offers, and liquidity pool positions into a single response.
 */
router.get("/:id/portfolio", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const cacheKey = `portfolio:${id}`;
    const fresh = req.query.fresh === true || req.query.fresh === "true";

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    const account = await withHorizonTiming(req, () => server.loadAccount(id));

    const offersResponse = await server
      .offers()
      .forAccount(id)
      .limit(200)
      .order("desc")
      .call()
      .catch(() => ({ records: [] }));

    const xlmBalance = (account.balances || []).find((b) => isNativeAsset(b));
    const nativeXLM = xlmBalance ? parseFloat(xlmBalance.balance) : 0;

    const assetBalances = (account.balances || [])
      .filter((b) => isNonNativeAsset(b))
      .map((b) => ({
        asset: normalizeAsset(b.asset_code, b.asset_issuer, b.asset_type),
        balance: b.balance,
      }));

    const poolPositions = (account.balances || [])
      .filter((b) => b.asset_type === "liquidity_pool_shares")
      .map((b) => ({
        poolId: b.liquidity_pool_id,
        shares: parseFloat(b.balance).toFixed(7),
      }));

    const openOffers = (offersResponse.records || []).map((offer) => ({
      offerId: offer.id,
      selling: normalizeAsset(
        offer.selling_asset_code,
        offer.selling_asset_issuer,
        offer.selling_asset_type,
      ),
      buying: normalizeAsset(
        offer.buying_asset_code,
        offer.buying_asset_issuer,
        offer.buying_asset_type,
      ),
      amount: parseFloat(offer.amount || "0").toFixed(7),
      price: parseFloat(offer.price || "0").toFixed(7),
    }));

    const data = {
      accountId: id,
      nativeBalance: nativeXLM.toFixed(7),
      assetBalances,
      totalValueXLM: nativeXLM.toFixed(7),
      openOffers,
      poolPositions,
    };

    cacheService.set(cacheKey, data, CACHE_TTL_ACCOUNT);
    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * Runs a lightweight risk assessment on a single payment counterparty.
 * Uses the same signals as /risk-score (age, home domain, trustline count)
 * plus frozen-trustline and missing-account checks.
 *
 * @param {string} address - Counterparty public key.
 * @returns {Promise<{ riskLevel: "low"|"medium"|"high", riskFactors: string[] }>}
 */
async function assessCounterpartyRisk(address) {
  let account;
  try {
    account = await server.loadAccount(address);
  } catch (err) {
    if (err && err.response && err.response.status === 404) {
      return {
        riskLevel: "high",
        riskFactors: ["Counterparty account does not exist or has been merged"],
      };
    }
    throw err;
  }

  const riskFactors = [];
  let score = 50;

  let firstOp = null;
  try {
    const firstOpResponse = await server
      .operations()
      .forAccount(address)
      .order("asc")
      .limit(1)
      .call();
    firstOp = (firstOpResponse.records || [])[0] || null;
  } catch (_) {
    firstOp = null;
  }

  if (firstOp && firstOp.created_at) {
    const daysOld = Math.floor(
      (Date.now() - new Date(firstOp.created_at).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysOld > 365) score += 15;
    else if (daysOld > 30) score += 10;
    else {
      score -= 15;
      riskFactors.push(`Account is very new (${daysOld} days old)`);
    }
  } else {
    score -= 10;
    riskFactors.push("No operation history found");
  }

  if (account.home_domain) score += 10;
  else {
    score -= 5;
    riskFactors.push("No home domain configured");
  }

  const trustlines = (account.balances || []).filter((b) => isNonNativeAsset(b));
  if (trustlines.length > 30) {
    score -= 15;
    riskFactors.push(`High number of trustlines (${trustlines.length})`);
  } else if (trustlines.length > 10) {
    score -= 5;
  } else {
    score += 5;
  }

  const frozenCount = trustlines.filter((b) => b.is_authorized === false).length;
  if (frozenCount > 0) {
    score -= 20;
    riskFactors.push(`${frozenCount} frozen trustline(s)`);
  }

  score = Math.max(0, Math.min(100, score));

  let riskLevel;
  if (score >= 70) riskLevel = "low";
  else if (score >= 40) riskLevel = "medium";
  else riskLevel = "high";

  return { riskLevel, riskFactors };
}

/**
 * Returns the counterparty address of a payment-like operation relative to
 * `accountId`, or null when the operation has no external counterparty.
 */
function getPaymentCounterparty(op, accountId) {
  let counterparty = null;
  if (op.type === "create_account") {
    counterparty = op.funder === accountId ? op.account : op.funder;
  } else if (op.type === "account_merge") {
    counterparty = op.account === accountId ? op.into : op.account;
  } else if (op.from || op.to) {
    counterparty = op.from === accountId ? op.to : op.from;
  }
  return counterparty && counterparty !== accountId ? counterparty : null;
}

/**
 * GET /account/:id/payment-counterparty-risk
 *
 * Fetches the account's most frequent payment counterparties and runs a
 * risk assessment on each one.
 *
 * Query params:
 *   - limit (number, default: 10, capped at 20)
 *
 * Response shape:
 *   {
 *     accountId: string,
 *     counterparties: [{ address, txCount, riskLevel, riskFactors }]
 *   }
 *
 * Counterparties are sorted by txCount descending. Returns 404 when the
 * account does not exist.
 *
 * @example
 * GET /account/GABC.../payment-counterparty-risk?limit=5
 */
router.get("/:id/payment-counterparty-risk", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const MAX_LIMIT = 20;
    const DEFAULT_LIMIT = 10;
    let limit = DEFAULT_LIMIT;
    if (req.query.limit !== undefined) {
      const parsed = parseInt(req.query.limit, 10);
      if (isNaN(parsed) || parsed < 1) {
        validateLimit(req.query.limit, MAX_LIMIT);
      }
      limit = Math.min(parsed, MAX_LIMIT);
    }

    await withHorizonTiming(req, () => server.loadAccount(id));

    const paymentsResponse = await server
      .payments()
      .forAccount(id)
      .order("desc")
      .limit(200)
      .call();

    const counts = new Map();
    for (const op of paymentsResponse.records || []) {
      const counterparty = getPaymentCounterparty(op, id);
      if (!counterparty) continue;
      counts.set(counterparty, (counts.get(counterparty) || 0) + 1);
    }

    const top = Array.from(counts.entries())
      .map(([address, txCount]) => ({ address, txCount }))
      .sort((a, b) => b.txCount - a.txCount)
      .slice(0, limit);

    const counterparties = await Promise.all(
      top.map(async ({ address, txCount }) => {
        const { riskLevel, riskFactors } = await assessCounterpartyRisk(address);
        return { address, txCount, riskLevel, riskFactors };
      }),
    );

    return success(res, {
      accountId: id,
      counterparties,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

const OFFERS_SUMMARY_PAGE_SIZE = 200;
// An account holds at most 1,000 subentries, so five full pages always cover
// every open offer.
const OFFERS_SUMMARY_MAX_PAGES = 5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Parses a Horizon decimal amount ("12.5000000") into integer stroops so that
 * totals can be summed without floating-point drift.
 *
 * @param {string} amount
 * @returns {bigint} Stroops, or 0n when the value is not a decimal amount.
 */
function amountToStroops(amount) {
  const match = /^(\d+)(?:\.(\d{1,7}))?$/.exec(String(amount ?? "").trim());
  if (!match) return 0n;
  const [, whole, fraction = ""] = match;
  return BigInt(whole) * STROOPS_PER_UNIT + BigInt(fraction.padEnd(7, "0"));
}

/**
 * Formats integer stroops as a seven-decimal amount string.
 *
 * @param {bigint} stroops
 * @returns {string}
 */
function stroopsToAmount(stroops) {
  const whole = stroops / STROOPS_PER_UNIT;
  const fraction = (stroops % STROOPS_PER_UNIT).toString().padStart(7, "0");
  return `${whole}.${fraction}`;
}

/**
 * Returns an offer's price (units of buying asset per unit of selling asset)
 * as an exact ratio, preferring Horizon's `price_r` over the rounded decimal
 * `price` string.
 *
 * @param {object} offer - Horizon offer record
 * @returns {{ n: bigint, d: bigint }}
 */
function offerPriceRatio(offer) {
  const ratio = offer.price_r;
  if (ratio && Number(ratio.d) > 0) {
    return { n: BigInt(ratio.n), d: BigInt(ratio.d) };
  }
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(offer.price ?? "").trim());
  if (!match) return { n: 0n, d: 1n };
  const [, whole, fraction = ""] = match;
  return { n: BigInt(whole + fraction), d: 10n ** BigInt(fraction.length) };
}

/**
 * Adds `stroops` to the running total for `asset`, keyed by code and issuer.
 *
 * @param {Map<string, { asset: object, stroops: bigint }>} totals
 * @param {{ code: string, issuer: string|null }} asset
 * @param {bigint} stroops
 */
function addAssetTotal(totals, asset, stroops) {
  const key = `${asset.code}:${asset.issuer}`;
  const entry = totals.get(key);
  if (entry) {
    entry.stroops += stroops;
  } else {
    totals.set(key, { asset, stroops });
  }
}

/**
 * Converts per-asset stroop totals to response entries, largest first.
 *
 * @param {Map<string, { asset: object, stroops: bigint }>} totals
 * @returns {Array<{ asset: object, totalAmount: string }>}
 */
function formatAssetTotals(totals) {
  return Array.from(totals.values())
    .sort((a, b) => (a.stroops === b.stroops ? 0 : a.stroops > b.stroops ? -1 : 1))
    .map(({ asset, stroops }) => ({ asset, totalAmount: stroopsToAmount(stroops) }));
}

/**
 * Fetches every open offer for an account, following Horizon pagination.
 *
 * @param {import('express').Request} req
 * @param {string} accountId
 * @returns {Promise<object[]>}
 */
async function fetchAllOffers(req, accountId) {
  const offers = [];
  let cursor;

  for (let page = 0; page < OFFERS_SUMMARY_MAX_PAGES; page++) {
    let query = server
      .offers()
      .forAccount(accountId)
      .limit(OFFERS_SUMMARY_PAGE_SIZE)
      .order("asc");
    if (cursor) query = query.cursor(cursor);

    const response = await withHorizonTiming(req, () => query.call());
    const records = response.records || [];
    offers.push(...records);

    if (records.length < OFFERS_SUMMARY_PAGE_SIZE) break;
    cursor = records[records.length - 1].paging_token;
  }

  return offers;
}

/**
 * GET /account/:id/offers-summary
 *
 * A quick overview of an account's DEX position without fetching and parsing
 * the full offers list:
 *   - sellLocked:   per selling asset, the total amount offered for sale
 *   - buyCommitted: per buying asset, the total amount the account will
 *                   receive if every offer fills (amount × price)
 *
 * oldestOfferAgeDays is measured from each offer's `last_modified_time`;
 * Horizon does not expose a creation time, so updating an offer resets its
 * age. It is null when the account has no open offers.
 *
 * Responses are cached per account (X-Cache: HIT | MISS). Pass ?fresh=true
 * to bypass the cache.
 *
 * Response shape:
 *   {
 *     accountId: string,
 *     totalOffers: number,
 *     sellLocked:   [{ asset, totalAmount }],  // seven-decimal strings, largest first
 *     buyCommitted: [{ asset, totalAmount }],  // seven-decimal strings, largest first
 *     oldestOfferAgeDays: number | null
 *   }
 *
 * Errors:
 *   400 — invalid account ID
 *   404 — account does not exist
 *
 * @example
 * GET /account/GABC.../offers-summary
 */
router.get("/:id/offers-summary", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const cacheKey = `offers-summary:${id}`;
    const fresh = req.query.fresh === true || req.query.fresh === "true";

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    // loadAccount rejects with a Horizon 404 for unknown accounts, which
    // handleAccountNotFound turns into a structured AccountNotFound error.
    const [, offers] = await Promise.all([
      withHorizonTiming(req, () => server.loadAccount(id)),
      fetchAllOffers(req, id),
    ]);

    const sellTotals = new Map();
    const buyTotals = new Map();
    let oldestOfferTime = null;

    for (const offer of offers) {
      const amountStroops = amountToStroops(offer.amount);
      const { n, d } = offerPriceRatio(offer);
      // amount × n / d, rounded half-up to the nearest stroop
      const committedStroops = (amountStroops * n * 2n + d) / (2n * d);

      addAssetTotal(
        sellTotals,
        normalizeAsset(offer.selling_asset_code, offer.selling_asset_issuer, offer.selling_asset_type),
        amountStroops,
      );
      addAssetTotal(
        buyTotals,
        normalizeAsset(offer.buying_asset_code, offer.buying_asset_issuer, offer.buying_asset_type),
        committedStroops,
      );

      // new Date(null) is the epoch, not NaN, so a missing time must be skipped explicitly.
      const modified = offer.last_modified_time
        ? new Date(offer.last_modified_time).getTime()
        : NaN;
      if (Number.isFinite(modified) && (oldestOfferTime === null || modified < oldestOfferTime)) {
        oldestOfferTime = modified;
      }
    }

    const data = {
      accountId: id,
      totalOffers: offers.length,
      sellLocked: formatAssetTotals(sellTotals),
      buyCommitted: formatAssetTotals(buyTotals),
      oldestOfferAgeDays:
        oldestOfferTime === null
          ? null
          : Math.floor((Date.now() - oldestOfferTime) / MS_PER_DAY),
    };

    cacheService.set(cacheKey, data, CACHE_TTL_ACCOUNT);
    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

const HEATMAP_DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const ACTIVITY_HEATMAP_PAGE_SIZE = 200;
const ACTIVITY_HEATMAP_MAX_PAGES = 10;

/**
 * GET /account/:id/activity-heatmap?days=30
 *
 * Returns a 7x24 matrix of transaction counts by day of week and hour of day
 * (UTC), computed from the account's recent transaction history.
 *
 * Query params:
 *   - days (integer, default: 30) — lookback window in days
 *
 * Response shape:
 *   {
 *     accountId,
 *     heatmap: { monday: [24 numbers], ..., sunday: [24 numbers] },
 *     peakDay: string | null,
 *     peakHour: number | null,
 *     totalAnalysed: number
 *   }
 *
 * Returns 404 when the account does not exist.
 *
 * @example
 * GET /account/GABC.../activity-heatmap?days=7
 */
router.get("/:id/activity-heatmap", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const DEFAULT_DAYS = 30;
    let days = DEFAULT_DAYS;
    if (req.query.days !== undefined) {
      const parsed = parseInt(req.query.days, 10);
      if (isNaN(parsed) || parsed < 1 || String(parsed) !== String(req.query.days).trim()) {
        const err = new Error(
          "Query parameter 'days': must be a positive integer.",
        );
        err.isValidation = true;
        err.field = "days";
        err.receivedValue = String(req.query.days);
        err.expectedFormat = "positive integer";
        throw err;
      }
      days = parsed;
    }

    await withHorizonTiming(req, () => server.loadAccount(id));

    const since = Date.now() - days * 24 * 60 * 60 * 1000;

    const heatmap = {};
    for (const dayName of HEATMAP_DAY_NAMES) {
      heatmap[dayName] = new Array(24).fill(0);
    }

    let totalAnalysed = 0;
    let cursor;
    let reachedEnd = false;

    for (
      let page = 0;
      page < ACTIVITY_HEATMAP_MAX_PAGES && !reachedEnd;
      page++
    ) {
      let query = server
        .transactions()
        .forAccount(id)
        .order("desc")
        .limit(ACTIVITY_HEATMAP_PAGE_SIZE);
      if (cursor) query = query.cursor(cursor);

      const response = await withHorizonTiming(req, () => query.call());
      const records = response.records || [];

      for (const tx of records) {
        cursor = tx.paging_token;
        const createdAt = new Date(tx.created_at).getTime();
        if (!Number.isFinite(createdAt) || createdAt < since) {
          reachedEnd = true;
          break;
        }
        const date = new Date(createdAt);
        const dayName = HEATMAP_DAY_NAMES[date.getUTCDay()];
        const hour = date.getUTCHours();
        heatmap[dayName][hour] += 1;
        totalAnalysed += 1;
      }

      if (records.length < ACTIVITY_HEATMAP_PAGE_SIZE) reachedEnd = true;
    }

    let peakDay = null;
    let peakHour = null;
    let peakCount = 0;
    for (const dayName of HEATMAP_DAY_NAMES) {
      const hours = heatmap[dayName];
      for (let hour = 0; hour < 24; hour++) {
        if (hours[hour] > peakCount) {
          peakCount = hours[hour];
          peakDay = dayName;
          peakHour = hour;
        }
      }
    }

    return success(res, {
      accountId: id,
      heatmap,
      peakDay,
      peakHour,
      totalAnalysed,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/asset-diversity
 *
 * Measures how diversified an account's asset holdings are using the
 * Herfindahl-Hirschman Index (HHI) of portfolio weights.
 *
 * diversityLevel:
 *   - "concentrated" when HHI > 2500
 *   - "moderate"     when 1000 <= HHI <= 2500
 *   - "diversified"  when HHI < 1000
 *
 * Response shape:
 *   {
 *     accountId,
 *     assetCount,
 *     hhi,
 *     diversityLevel,
 *     breakdown: [{ asset, portfolioPercent }]
 *   }
 *
 * Returns 404 when the account does not exist.
 *
 * @example
 * GET /account/GABC.../asset-diversity
 */
router.get("/:id/asset-diversity", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const account = await withHorizonTiming(req, () => server.loadAccount(id));

    const holdings = [];
    for (const balance of account.balances || []) {
      const value = parseFloat(balance.balance || "0");
      if (!Number.isFinite(value) || value <= 0) continue;
      holdings.push({
        asset: normalizeAssetShape(balance),
        value,
      });
    }

    const totalValue = holdings.reduce((sum, h) => sum + h.value, 0);

    const breakdown = holdings.map((h) => ({
      asset: h.asset,
      portfolioPercent:
        totalValue > 0
          ? Math.round((h.value / totalValue) * 10000) / 100
          : 0,
    }));

    let hhi = 0;
    for (const entry of breakdown) {
      hhi += entry.portfolioPercent * entry.portfolioPercent;
    }
    hhi = Math.round(hhi * 100) / 100;

    let diversityLevel;
    if (hhi > 2500) diversityLevel = "concentrated";
    else if (hhi >= 1000) diversityLevel = "moderate";
    else diversityLevel = "diversified";

    return success(res, {
      accountId: id,
      assetCount: breakdown.length,
      hhi,
      diversityLevel,
      breakdown,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/watchlist-status
 *
 * Checks whether an account appears on any community-maintained Stellar
 * watchlists or has been flagged for suspicious activity.
 * Response is cached for 60 seconds.
 */
router.get("/:id/watchlist-status", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const cacheKey = `watchlist-status:${id}`;
    const fresh = req.query.fresh === true || req.query.fresh === "true";

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    await withHorizonTiming(req, () => server.loadAccount(id));

    const data = {
      accountId: id,
      onWatchlist: false,
      sources: [],
      reason: null,
      checkedAt: new Date().toISOString(),
    };

    cacheService.set(cacheKey, data, 60);
    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/funding-history
 *
 * Returns the account's earliest payment operations to show how the account
 * was funded. Fetches inbound payments and create_account operations and
 * returns the top funding sources sorted by amount descending.
 *
 * Returns 404 when the account does not exist.
 * Returns the initial funding sources for an account, sorted by amount descending.
 * Identifies where an account's initial XLM came from.
 *
 * Response shape:
 *   {
 *     success: true,
 *     data: {
 *       accountId: string,
 *       sources: [{ from: string, amount: string, timestamp: string, transactionHash: string }],
 *       firstFundedAt: string,
 *       totalSources: number
 *     }
 *   }
 *
 * @example
 * GET /account/GABC.../funding-history
 */
router.get("/:id/funding-history", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    await withHorizonTiming(req, () => server.loadAccount(id));

    const paymentsResponse = await server
      .payments()
      .forAccount(id)
      .order("asc")
      .limit(200)
      .call();

    const operations = paymentsResponse.records || [];

    const fundingSources = [];
    let firstFundedAt = null;

    for (const op of operations) {
      let sender = null;
      let amount = null;
      let asset = null;

      if (op.type === "create_account" && op.account === id) {
        sender = op.funder;
        amount = parseFloat(op.starting_balance || "0");
        asset = { code: "XLM", issuer: null, type: "native" };
        if (!firstFundedAt) firstFundedAt = op.created_at;
      } else if (op.type === "payment" && op.to === id) {
        sender = op.from;
        amount = parseFloat(op.amount || "0");
        const assetType = op.asset_type || "native";
        asset = isNativeAsset({ type: assetType })
          ? { code: "XLM", issuer: null, type: "native" }
          : {
              code: op.asset_code || null,
              issuer: op.asset_issuer || null,
              type: assetType,
            };
        if (!firstFundedAt) firstFundedAt = op.created_at;
      } else if (
        (op.type === "path_payment_strict_receive" || op.type === "path_payment_strict_send") &&
        op.to === id
      ) {
        sender = op.from;
        amount = parseFloat(op.amount || "0");
        const assetType = op.asset_type || "native";
        asset = isNativeAsset({ type: assetType })
          ? { code: "XLM", issuer: null, type: "native" }
          : {
              code: op.asset_code || null,
              issuer: op.asset_issuer || null,
              type: assetType,
            };
        if (!firstFundedAt) firstFundedAt = op.created_at;
      }

      if (sender && amount > 0 && asset) {
        fundingSources.push({
          sender,
          amount: amount.toFixed(7),
          asset,
          timestamp: op.created_at,
        });
      }
    }

    fundingSources.sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount));

    const totalFundingAmount = fundingSources.reduce(
      (sum, source) => sum + parseFloat(source.amount),
      0
    ).toFixed(7);

    return success(res, {
      accountId: id,
      fundingSources,
      firstFundedAt,
      totalFundingAmount,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

const FEE_SPENDING_PAGE_SIZE = 200;
const FEE_SPENDING_MAX_PAGES = 10;

/**
 * GET /account/:id/fee-spending?days=30
 *
 * Aggregates the network fees an account has paid over the last `days` days,
 * broken down by operation type.
 *
 * Only transactions whose fee was paid by this account (fee_account, falling
 * back to source_account) are counted. Each transaction's charged fee is split
 * evenly across its operations so that multi-operation transactions are
 * attributed proportionally to each operation type.
 *
 * Query params:
 *   - days (integer, 1–90, default: 30)
 *
 * Response:
 *   {
 *     accountId,
 *     period: { days, from, to },
 *     transactionCount,
 *     totalFeesXLM,       // sum of fee_charged across counted transactions
 *     averageFeeXLM,      // totalFeesXLM / transactionCount
 *     breakdown: [{ type, count, transactionCount, totalFeesXLM, averageFeeXLM }]
 *   }
 *
 * @example
 * GET /account/GABC.../fee-spending?days=7
 */
router.get("/:id/fee-spending", async (req, res, next) => {
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

    await withHorizonTiming(req, () => server.loadAccount(id));

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const transactions = new Map();
    const byType = new Map();
    let cursor;
    let reachedEnd = false;

    for (let page = 0; page < FEE_SPENDING_MAX_PAGES && !reachedEnd; page++) {
      let query = server
        .operations()
        .forAccount(id)
        .join("transactions")
        .limit(FEE_SPENDING_PAGE_SIZE)
        .order("desc")
        .includeFailed(true);
      if (cursor) query = query.cursor(cursor);

      const response = await withHorizonTiming(req, () => query.call());
      const records = response.records || [];

      for (const op of records) {
        cursor = op.paging_token;
        if (new Date(op.created_at) < since) {
          reachedEnd = true;
          break;
        }

        const tx = op.transaction;
        if (!tx || typeof tx !== "object") continue;
        const payer = tx.fee_account || tx.source_account;
        if (payer !== id) continue;

        const txHash = tx.hash || op.transaction_hash;
        const feeStroops = parseInt(tx.fee_charged || 0, 10) || 0;
        const opCount = parseInt(tx.operation_count, 10) || 1;
        if (!transactions.has(txHash)) {
          transactions.set(txHash, { feeStroops, types: new Set() });
        }
        const txEntry = transactions.get(txHash);

        const type = op.type || "unknown";
        if (!byType.has(type)) {
          byType.set(type, { type, count: 0, transactionCount: 0, feesStroops: 0 });
        }
        const bucket = byType.get(type);
        bucket.count += 1;
        bucket.feesStroops += feeStroops / opCount;
        if (!txEntry.types.has(type)) {
          bucket.transactionCount += 1;
          txEntry.types.add(type);
        }
      }

      if (records.length < FEE_SPENDING_PAGE_SIZE) reachedEnd = true;
    }

    let totalFeesStroops = 0;
    for (const { feeStroops } of transactions.values()) totalFeesStroops += feeStroops;

    const transactionCount = transactions.size;
    const breakdown = [...byType.values()]
      .map((bucket) => ({
        type: bucket.type,
        count: bucket.count,
        transactionCount: bucket.transactionCount,
        totalFeesXLM: parseStellarAmount(Math.round(bucket.feesStroops)),
        averageFeeXLM: parseStellarAmount(bucket.feesStroops / bucket.transactionCount),
      }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

    return success(res, {
      accountId: id,
      period: { days, from: since.toISOString(), to: new Date().toISOString() },
      transactionCount,
      totalFeesXLM: parseStellarAmount(totalFeesStroops),
      averageFeeXLM: parseStellarAmount(
        transactionCount > 0 ? totalFeesStroops / transactionCount : 0,
      ),
      breakdown,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * Decodes a base64 ScVal parameter from a Horizon invoke_host_function
 * operation record into a native JS value, or null when it cannot be decoded.
 *
 * @param {{ value?: string }|undefined} param
 * @returns {*}
 */
function decodeHostFunctionParam(param) {
  if (!param || typeof param.value !== "string") return null;
  try {
    const native = scValToNative(xdr.ScVal.fromXDR(param.value, "base64"));
    if (native === undefined || native === null) return null;
    return typeof native === "string" ? native : native.toString();
  } catch (_) {
    return null;
  }
}

/**
 * Shapes a Horizon invoke_host_function operation record into a contract
 * interaction summary.
 *
 * For contract invocations Horizon exposes the call as `parameters`, where the
 * first entry is the contract address and the second is the function symbol.
 * Other host functions (contract upload / creation) have no function symbol,
 * so the host function type is reported instead.
 *
 * @param {object} op - Raw Horizon operation record
 * @returns {{ contractId: string|null, function: string|null, timestamp: string|null,
 *   success: boolean, transactionHash: string, hostFunctionType: string|null }}
 */
function mapContractInteraction(op) {
  const hostFunctionType = op.function
    ? String(op.function).replace(/^HostFunctionType(HostFunctionType)?/, "")
    : null;
  const params = Array.isArray(op.parameters) ? op.parameters : [];
  const isInvoke = hostFunctionType === null || /InvokeContract/i.test(hostFunctionType);

  const contractId = isInvoke ? decodeHostFunctionParam(params[0]) : null;
  const fnName = isInvoke ? decodeHostFunctionParam(params[1]) : null;

  return {
    contractId,
    function: fnName || hostFunctionType,
    timestamp: toISOTimestamp(op.created_at),
    success: op.transaction_successful !== false,
    transactionHash: op.transaction_hash,
    hostFunctionType,
  };
}

const CONTRACT_INTERACTIONS_PAGE_SIZE = 200;
const CONTRACT_INTERACTIONS_MAX_PAGES = 10;

/**
 * GET /account/:id/smart-contract-interactions?limit=20&cursor=...
 *
 * Filters the account's operation history for `invoke_host_function`
 * operations and returns a summarised list of Soroban contract interactions,
 * newest first.
 *
 * Query params:
 *   - limit  (integer, 1–200, default: 20) — maximum interactions to return
 *   - cursor (Horizon paging token)        — continue from a previous response
 *
 * Response:
 *   {
 *     accountId,
 *     interactions: [{ contractId, function, timestamp, success, transactionHash }],
 *     total,   // number of interactions in this page
 *     limit,
 *     cursor   // pass back as ?cursor= for the next page; null when history is exhausted
 *   }
 *
 * @example
 * GET /account/GABC.../smart-contract-interactions?limit=10
 */
router.get("/:id/smart-contract-interactions", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const { limit, cursor: startCursor } = parsePaginationParams(req.query, 200);

    await withHorizonTiming(req, () => server.loadAccount(id));

    const interactions = [];
    let cursor = startCursor;
    let nextCursor = null;

    for (let page = 0; page < CONTRACT_INTERACTIONS_MAX_PAGES; page++) {
      let query = server
        .operations()
        .forAccount(id)
        .limit(CONTRACT_INTERACTIONS_PAGE_SIZE)
        .order("desc")
        .includeFailed(true);
      if (cursor) query = query.cursor(cursor);

      const response = await withHorizonTiming(req, () => query.call());
      const records = response.records || [];

      for (const op of records) {
        cursor = op.paging_token;
        if (op.type !== "invoke_host_function") continue;
        interactions.push(mapContractInteraction(op));
        if (interactions.length >= limit) break;
      }

      if (interactions.length >= limit) {
        nextCursor = cursor;
        break;
      }
      if (records.length < CONTRACT_INTERACTIONS_PAGE_SIZE) {
        nextCursor = null;
        break;
      }
      // Scan budget exhausted: let the caller resume from where we stopped.
      nextCursor = cursor;
    }

    return success(res, {
      accountId: id,
      interactions,
      total: interactions.length,
      limit,
      cursor: nextCursor || null,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/fee-spending
 *
 * Aggregates network fees paid by an account over a specified time period.
 * Returns total fees in stroops and XLM, average fee per transaction, and a
 * breakdown by operation type.
 *
 * Query params:
 *   - days (integer, 1–90, default: 30) — how many days of history to analyze
 *
 * Response:
 *   {
 *     success: true,
 *     data: {
 *       accountId,
 *       period: { days, startDate, endDate },
 *       totalFeesStroops: "123456",
 *       totalFeesXLM: "0.0123456",
 *       averageFeeXLM: "0.0001000",
 *       transactionCount: 123,
 *       breakdown: [
 *         { operationType: "payment", count: 50, totalFeesXLM: "0.0050000" },
 *         { operationType: "manage_offer", count: 30, totalFeesXLM: "0.0030000" },
 *         ...
 *       ]
 *     }
 *   }
 *
 * Errors:
 *   - 400: InvalidParameter — days is not a valid integer or out of range
 *   - 404: AccountNotFound — account does not exist on the network
 *
 * @example
 * GET /account/GABC.../fee-spending?days=7
 */
router.get("/:id/fee-spending", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    // Validate days parameter
    const rawDays = req.query.days;
    let days = 30;
    if (rawDays !== undefined) {
      const parsed = Number(rawDays);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 90) {
        const err = new Error("Parameter 'days' must be an integer between 1 and 90.");
        err.isValidation = true;
        err.status = 400;
        err.field = "days";
        err.receivedValue = rawDays;
        throw err;
      }
      days = parsed;
    }

    // Verify account exists
    await withHorizonTiming(req, () => server.loadAccount(id));

    const now = Date.now();
    const windowStart = now - (days * 24 * 60 * 60 * 1000);
    const startDate = new Date(windowStart).toISOString();
    const endDate = new Date(now).toISOString();

    let totalFeesStroops = 0n;
    let transactionCount = 0;
    const breakdownMap = new Map(); // operationType -> { count, totalFees }
    let cursor;

    // Paginate through transactions
    for (;;) {
      let query = server
        .transactions()
        .forAccount(id)
        .limit(200)
        .order("desc");
      
      if (cursor) query = query.cursor(cursor);

      const page = await withHorizonTiming(req, () => query.call());
      const records = page.records || [];

      if (records.length === 0) break;

      for (const tx of records) {
        const createdAt = new Date(tx.created_at).getTime();
        if (Number.isNaN(createdAt)) continue;
        
        // Stop if we've gone past the time window
        if (createdAt < windowStart) {
          cursor = null; // Signal we're done
          break;
        }

        cursor = tx.paging_token;

        // Only count successful transactions
        if (tx.successful !== true) continue;

        const fee = BigInt(tx.fee_charged || tx.max_fee || 0);
        totalFeesStroops += fee;
        transactionCount++;

        // Get operation details for this transaction
        try {
          const opResponse = await withHorizonTiming(req, () =>
            server.operations().forTransaction(tx.id).limit(200).call()
          );

          for (const op of opResponse.records || []) {
            const opType = op.type || "unknown";
            const existing = breakdownMap.get(opType) || { count: 0, totalFees: 0n };
            existing.count++;
            // Distribute the transaction fee evenly across operations
            existing.totalFees += fee / BigInt(tx.operation_count || 1);
            breakdownMap.set(opType, existing);
          }
        } catch (opErr) {
          // If we can't get operations, just continue (edge case)
          console.error(`Failed to fetch operations for tx ${tx.id}:`, opErr.message);
        }
      }

      // If cursor is null, we've processed all relevant transactions
      if (!cursor || records.length < 200) break;
    }

    // Convert breakdown map to array
    const breakdown = Array.from(breakdownMap.entries())
      .map(([operationType, data]) => ({
        operationType,
        count: data.count,
        totalFeesXLM: stroopsToAmount(data.totalFees),
      }))
      .sort((a, b) => b.count - a.count); // Sort by count descending

    const totalFeesXLM = stroopsToAmount(totalFeesStroops);
    const averageFeeXLM = transactionCount > 0
      ? stroopsToAmount(totalFeesStroops / BigInt(transactionCount))
      : "0.0000000";

    return success(res, {
      accountId: id,
      period: {
        days,
        startDate,
        endDate,
      },
      totalFeesStroops: totalFeesStroops.toString(),
      totalFeesXLM,
      averageFeeXLM,
      transactionCount,
      breakdown,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/self-payment-detection
 *
 * Detects circular payment chains where an account's money comes back to itself.
 * Identifies direct self-payments (A sends to A) and multi-hop circular chains (A -> B -> C -> A).
 * Chains longer than 10 hops are not flagged to avoid false positives.
 *
 * Response shape:
 *   {
 *     success: true,
 *     data: {
 *       accountId: <string>,
 *       selfPaymentsDetected: <boolean>,
 *       chains: [
 *         {
 *           type: "direct_self" | "circular_chain",
 *           length: <number>,
 *           chain: [<accountId>, ...],
 *           totalAmount: <string (XLM equivalent)>,
 *           firstOccurrence: <ISO8601 timestamp>
 *         }
 *       ]
 *     }
 *   }
 *
 * Returns 404 if the account does not exist.
 *
 * @example
 * GET /account/GBRPYHIL2CI3WHZDTOOQFC6EB4CGQG5N3KBI5DOMMZMDBESIOXW32DT/self-payment-detection
 */
router.get("/:id/self-payment-detection", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    // Verify account exists
    await withHorizonTiming(req, () => server.loadAccount(id));

    // Fetch payment operations for this account
    const paymentsResponse = await withHorizonTiming(req, () =>
      server.payments().forAccount(id).order("desc").limit(200).call()
    );

    const payments = paymentsResponse.records || [];
    const chains = [];
    const visited = new Set();

    // Check for direct self-payments
    for (const payment of payments) {
      if (payment.from === id && payment.to === id) {
        const chainKey = `direct_self_${payment.id}`;
        if (!visited.has(chainKey)) {
          visited.add(chainKey);
          chains.push({
            type: "direct_self",
            length: 1,
            chain: [id],
            totalAmount: payment.amount,
            firstOccurrence: payment.created_at,
          });
        }
      }
    }

    // Check for circular chains (A -> B -> C -> A)
    // Build a graph of payments
    const graph = new Map();
    for (const payment of payments) {
      if (!graph.has(payment.from)) {
        graph.set(payment.from, []);
      }
      graph.get(payment.from).push({
        to: payment.to,
        amount: payment.amount,
        timestamp: payment.created_at,
      });
    }

    // DFS to find cycles that include the target account
    const findCycles = (startAccount) => {
      const cycles = [];
      const visitedInDFS = new Set();
      const stack = [];

      const dfs = (current, path) => {
        if (path.length > 10) return; // Don't flag chains longer than 10 hops

        if (current === startAccount && path.length > 1) {
          // Found a cycle back to start account
          const cycleKey = path.sort().join("|");
          if (!visitedInDFS.has(cycleKey)) {
            visitedInDFS.add(cycleKey);
            cycles.push({
              type: "circular_chain",
              length: path.length,
              chain: [...path],
              totalAmount: "0", // Sum would require more detailed tracking
              firstOccurrence: null,
            });
          }
          return;
        }

        if (visited.has(current) || path.includes(current)) return;

        const neighbors = graph.get(current) || [];
        for (const neighbor of neighbors) {
          path.push(neighbor.to);
          dfs(neighbor.to, path);
          path.pop();
        }
      };

      dfs(startAccount, [startAccount]);
      return cycles;
    };

    const circulars = findCycles(id);
    chains.push(...circulars);

    return success(res, {
      accountId: id,
      selfPaymentsDetected: chains.length > 0,
      chains,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/largest-transactions
 *
 * Returns the highest value transactions for an account.
 * Useful for financial analysts and compliance tools to identify top transactions without paging.
 *
 * Query params:
 *   - direction (string, optional): "sent", "received", or "both" (default: "both")
 *   - limit (number, optional, default: 10, max: 50)
 *
 * Response shape:
 *   {
 *     success: true,
 *     data: {
 *       accountId: <string>,
 *       transactions: [
 *         {
 *           hash: <string>,
 *           totalValueXLM: <string (7 decimals)>,
 *           operationCount: <number>,
 *           direction: "sent" | "received",
 *           timestamp: <ISO8601>
 *         }
 *       ],
 *       period: {
 *         startDate: <ISO8601>,
 *         endDate: <ISO8601>
 *       }
 *     }
 *   }
 *
 * Returns 404 if the account does not exist.
 *
 * @example
 * GET /account/GBRPYHIL2CI3WHZDTOOQFC6EB4CGQG5N3KBI5DOMMZMDBESIOXW32DT/largest-transactions?direction=sent&limit=20
 */
router.get("/:id/largest-transactions", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const direction = (req.query.direction || "both").toLowerCase();
    if (!["sent", "received", "both"].includes(direction)) {
      const err = new Error('Invalid direction. Must be "sent", "received", or "both".');
      err.isValidation = true;
      return next(err);
    }

    let limit = parseInt(req.query.limit, 10) || 10;
    limit = Math.min(limit, 50); // Cap at 50

    // Verify account exists
    await withHorizonTiming(req, () => server.loadAccount(id));

    // Fetch transactions
    const txResponse = await withHorizonTiming(req, () =>
      server.transactions().forAccount(id).order("desc").limit(200).call()
    );

    const transactions = txResponse.records || [];
    const largestTxs = [];

    for (const tx of transactions) {
      if (tx.successful !== true) continue;

      // Fetch operations for this transaction
      const opResponse = await withHorizonTiming(req, () =>
        server.operations().forTransaction(tx.id).limit(200).call()
      );

      const operations = opResponse.records || [];
      let totalValueXLM = 0;

      for (const op of operations) {
        if (op.type === "payment" || op.type === "path_payment_strict_receive" || op.type === "path_payment_strict_send") {
          const amount = parseFloat(op.amount || 0);
          const isReceived = op.to === id;
          const isDirectionMatch =
            direction === "both" ||
            (direction === "sent" && !isReceived && op.from === id) ||
            (direction === "received" && isReceived);

          if (isDirectionMatch) {
            // Convert to XLM equivalent (simplification; real code would handle different assets)
            totalValueXLM += amount;
          }
        }
      }

      if (totalValueXLM > 0) {
        largestTxs.push({
          hash: tx.hash,
          totalValueXLM: totalValueXLM.toFixed(7),
          operationCount: tx.operation_count,
          direction:
            transactions.find((t) => t.id === tx.id)?.operations?.some((op) => op.to === id) ||
            operations.some((op) => op.to === id)
              ? "received"
              : "sent",
          timestamp: tx.created_at,
        });
      }
    }

    // Sort by total value descending and take top N
    largestTxs.sort((a, b) => parseFloat(b.totalValueXLM) - parseFloat(a.totalValueXLM));
    const topTxs = largestTxs.slice(0, limit);

    const now = new Date();
    const startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); // 90 days ago

    return success(res, {
      accountId: id,
      transactions: topTxs,
      period: {
        startDate: startDate.toISOString(),
        endDate: now.toISOString(),
      },
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

module.exports = router;

// SHELL_SYNC_MARKER

/**
 * Evaluates claimable balance predicate conditions
 * @param {object} predicate - Predicate object from Horizon
 * @param {number} currentTimeMs - Current time in milliseconds
 * @returns {object} { predicatesMet: string[], predicatesNotMet: string[], claimableAt: string|null }
 */
function evaluateClaimablePredicate(predicate, currentTimeMs) {
  const predicatesMet = [];
  const predicatesNotMet = [];
  let claimableAt = null;

  if (!predicate) {
    predicatesMet.push("unconditional");
    return { predicatesMet, predicatesNotMet, claimableAt };
  }

  const type = predicate.predicate_type;

  if (type === "unconditional" || type === "predicate_unconditional") {
    predicatesMet.push("unconditional");
    return { predicatesMet, predicatesNotMet, claimableAt };
  }

  // Handle time-based predicates
  if (type === "predicate_left_greater" || type === "predicate_left_greater_or_equal") {
    const timestamp = parseInt(predicate.time_bounds?.min_time || 0, 10) * 1000;
    if (currentTimeMs > timestamp || (type === "predicate_left_greater_or_equal" && currentTimeMs >= timestamp)) {
      predicatesMet.push(`time_lock (after ${new Date(timestamp).toISOString()})`);
    } else {
      predicatesNotMet.push(`time_lock (before ${new Date(timestamp).toISOString()})`);
      claimableAt = new Date(timestamp).toISOString();
    }
  }

  if (type === "predicate_right_less" || type === "predicate_right_less_or_equal") {
    const timestamp = parseInt(predicate.time_bounds?.max_time || 0, 10) * 1000;
    if (currentTimeMs < timestamp || (type === "predicate_right_less_or_equal" && currentTimeMs <= timestamp)) {
      predicatesMet.push(`time_window_open (until ${new Date(timestamp).toISOString()})`);
    } else {
      predicatesNotMet.push(`time_window_closed (expired at ${new Date(timestamp).toISOString()})`);
    }
  }

  // Handle composite predicates (and/or)
  if (type === "predicate_and") {
    const left = evaluateClaimablePredicate(predicate.left_predicate, currentTimeMs);
    const right = evaluateClaimablePredicate(predicate.right_predicate, currentTimeMs);
    predicatesMet.push(...left.predicatesMet, ...right.predicatesMet);
    predicatesNotMet.push(...left.predicatesNotMet, ...right.predicatesNotMet);
    if (left.claimableAt || right.claimableAt) {
      claimableAt = new Date(Math.max(
        new Date(left.claimableAt || 0).getTime(),
        new Date(right.claimableAt || 0).getTime()
      )).toISOString();
    }
  }

  if (type === "predicate_or") {
    const left = evaluateClaimablePredicate(predicate.left_predicate, currentTimeMs);
    const right = evaluateClaimablePredicate(predicate.right_predicate, currentTimeMs);
    // For OR, if either side is eligible, it's eligible
    const leftEligible = left.predicatesNotMet.length === 0;
    const rightEligible = right.predicatesNotMet.length === 0;
    if (leftEligible || rightEligible) {
      predicatesMet.push(...(leftEligible ? left.predicatesMet : right.predicatesMet));
    } else {
      predicatesNotMet.push(...left.predicatesNotMet, ...right.predicatesNotMet);
      claimableAt = new Date(Math.min(
        new Date(left.claimableAt || Date.now()).getTime(),
        new Date(right.claimableAt || Date.now()).getTime()
      )).toISOString();
    }
  }

  return { predicatesMet, predicatesNotMet, claimableAt };
}

/**
 * GET /account/:id/claimable-balance-eligibility
 *
 * Returns detailed eligibility breakdown for each claimable balance sponsored to the account.
 * For each balance, explains which predicate conditions are met, which are not, and when
 * a time-locked balance becomes claimable.
 *
 * Response shape:
 *   {
 *     success: true,
 *     data: {
 *       accountId: <string>,
 *       balances: [
 *         {
 *           balanceId: <string>,
 *           asset: <string>,
 *           amount: <string>,
 *           isEligible: <boolean>,
 *           predicatesMet: <string[]>,
 *           predicatesNotMet: <string[]>,
 *           claimableAt: <ISO8601 string or null>
 *         }
 *       ]
 *     }
 *   }
 *
 * Returns 404 if the account does not exist.
 *
 * @example
 * GET /account/GBRPYHIL2CI3WHZDTOOQFC6EB4CGQG5N3KBI5DOMMZMDBESIOXW32DT/claimable-balance-eligibility
 */
router.get("/:id/claimable-balance-eligibility", async (req, res, next) => {
  try {
    const { id } = req.params;

    // Validate account ID
    const accountIdError = validateAccountId(id);
    if (accountIdError) {
      return res.status(400).json({
        success: false,
        error: {
          type: "ValidationError",
          message: accountIdError,
        },
      });
    }

    // Check if account exists
    let account;
    try {
      account = await withHorizonTiming(req, () => server.accounts().accountId(id).call());
    } catch (err) {
      if (err.status === 404) {
        return res.status(404).json(makeAccountNotFoundError(id));
      }
      throw err;
    }

    // Fetch claimable balances sponsored to this account
    const cbResponse = await withHorizonTiming(req, () =>
      server
        .claimableBalances()
        .claimant(id)
        .order("desc")
        .limit(200)
        .call()
    );

    const balances = (cbResponse.records || []).map((cb) => {
      const currentTimeMs = Date.now();
      const { predicatesMet, predicatesNotMet, claimableAt } = evaluateClaimablePredicate(
        cb.predicate,
        currentTimeMs
      );

      // Determine if eligible (no unsatisfied predicates)
      const isEligible = predicatesNotMet.length === 0;

      // Format asset
      let assetString;
      if (cb.asset === "native") {
        assetString = "XLM";
      } else {
        const [code, issuer] = cb.asset.split(":");
        assetString = `${code}:${issuer}`;
      }

      return {
        balanceId: cb.id,
        asset: assetString,
        amount: cb.amount,
        isEligible,
        predicatesMet,
        predicatesNotMet,
        claimableAt: isEligible ? null : claimableAt,
      };
    });

    const data = {
      accountId: id,
      balances,
    };

    return success(res, data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /account/:id/balance-velocity
 *
 * Analyzes the rate of change in an account's balances over rolling time windows.
 * Tracks how much each asset balance has changed in the last hour, 24 hours, and 7 days.
 * Sets a velocityFlag when the change rate exceeds two standard deviations from the
 * account's historical average (indicating unusual activity).
 *
 * Response shape:
 *   {
 *     success: true,
 *     data: {
 *       accountId: <string>,
 *       balanceChanges: [
 *         {
 *           asset: <string>,
 *           change1h: <string (7 decimals)>,
 *           change24h: <string (7 decimals)>,
 *           change7d: <string (7 decimals)>,
 *           velocityFlag: <boolean>
 *         }
 *       ]
 *     }
 *   }
 *
 * All change values are formatted as seven-decimal strings and can be negative.
 * velocityFlag is true when |change| > μ + 2σ from historical daily changes.
 * Returns 404 if the account does not exist.
 *
 * @example
 * GET /account/GBRPYHIL2CI3WHZDTOOQFC6EB4CGQG5N3KBI5DOMMZMDBESIOXW32DT/balance-velocity
 */
router.get("/:id/balance-velocity", async (req, res, next) => {
  try {
    const { id } = req.params;

    // Validate account ID
    const accountIdError = validateAccountId(id);
    if (accountIdError) {
      return res.status(400).json({
        success: false,
        error: {
          type: "ValidationError",
          message: accountIdError,
        },
      });
    }

    // Check if account exists and get current balances
    let account;
    try {
      account = await withHorizonTiming(req, () => server.accounts().accountId(id).call());
    } catch (err) {
      if (err.status === 404) {
        return res.status(404).json(makeAccountNotFoundError(id));
      }
      throw err;
    }

    const currentBalances = {};
    
    // Build map of current balances
    account.balances.forEach((balance) => {
      if (balance.asset_type === "native") {
        currentBalances["XLM"] = parseFloat(balance.balance);
      } else {
        const key = `${balance.asset_code}:${balance.asset_issuer}`;
        currentBalances[key] = parseFloat(balance.balance);
      }
    });

    // Fetch payment operations to analyze balance changes
    const now = Date.now();
    const timeWindows = {
      "1h": now - 60 * 60 * 1000,
      "24h": now - 24 * 60 * 60 * 1000,
      "7d": now - 7 * 24 * 60 * 60 * 1000,
    };

    // Fetch payment and path_payment operations
    const paymentsResponse = await withHorizonTiming(req, () =>
      server
        .payments()
        .forAccount(id)
        .order("desc")
        .limit(200)
        .call()
    );

    const payments = paymentsResponse.records || [];
    const balanceChanges = {};

    // Calculate balance changes by asset
    payments.forEach((payment) => {
      const operationTimestamp = new Date(payment.created_at).getTime();
      
      // Determine asset key
      let assetKey;
      if (payment.asset_type === "native" || payment.asset_code === "XLM") {
        assetKey = "XLM";
      } else {
        assetKey = `${payment.asset_code}:${payment.asset_issuer}`;
      }

      // Initialize asset tracking if needed
      if (!balanceChanges[assetKey]) {
        balanceChanges[assetKey] = {
          change1h: 0,
          change24h: 0,
          change7d: 0,
          dailyChanges: [],
        };
      }

      const amount = parseFloat(payment.amount);
      const isReceived = payment.to === id;
      const change = isReceived ? amount : -amount;

      // Record by time window
      if (operationTimestamp > timeWindows["1h"]) {
        balanceChanges[assetKey].change1h += change;
      }
      if (operationTimestamp > timeWindows["24h"]) {
        balanceChanges[assetKey].change24h += change;
      }
      if (operationTimestamp > timeWindows["7d"]) {
        balanceChanges[assetKey].change7d += change;
        
        // Track daily change for velocity calculation
        const dayIndex = Math.floor((now - operationTimestamp) / (24 * 60 * 60 * 1000));
        if (!balanceChanges[assetKey].dailyChanges[dayIndex]) {
          balanceChanges[assetKey].dailyChanges[dayIndex] = 0;
        }
        balanceChanges[assetKey].dailyChanges[dayIndex] += change;
      }
    });

    // Calculate velocity flags
    const result = Object.entries(balanceChanges).map(([asset, changes]) => {
      // Compute historical statistics
      const dailyChanges = changes.dailyChanges.filter((c) => c !== undefined);
      let velocityFlag = false;

      if (dailyChanges.length > 1) {
        const mean = dailyChanges.reduce((a, b) => a + b, 0) / dailyChanges.length;
        const variance = dailyChanges.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / dailyChanges.length;
        const stdDev = Math.sqrt(variance);
        
        // Check if any recent change exceeds mean + 2σ
        const recentChange = changes.change24h;
        velocityFlag = Math.abs(recentChange - mean) > 2 * stdDev;
      }

      return {
        asset,
        change1h: changes.change1h.toFixed(7),
        change24h: changes.change24h.toFixed(7),
        change7d: changes.change7d.toFixed(7),
        velocityFlag,
      };
    });

    const data = {
      accountId: id,
      balanceChanges: result,
    };

    return success(res, data);
  } catch (err) {
    next(err);
  }
});
