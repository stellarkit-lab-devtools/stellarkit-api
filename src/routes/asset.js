const express = require("express");
const router = express.Router();
const registerParamValidation = require("../middleware/validateRouteParams");
registerParamValidation(router);
const { Asset } = require("@stellar/stellar-sdk");
const { server, NETWORK } = require("../config/stellar");
const cacheService = require("../services/cache");
const { success } = require("../utils/response");
const { assetHoldersRateLimiter } = require("../middleware/rateLimiter");
const normalizeAssetCode = require("../middleware/normalizeAssetCode");
const { validateAccountId, validateAssetCode, validateAsset, validateLimit } = require("../utils/validators");
const { parsePaginationParams } = require("../utils/pagination");
const {
  makeAssetNotFoundError,
  makeAccountNotFoundError,
  makeTomlFetchFailedError,
  makeOrderBookEmptyError,
} = require("../utils/errors");
const cacheTTL = require("../config/cacheConfig");
const { normalizeAsset, normalizeAssetFromString } = require("../utils/asset");
const { fetchNormalisedToml } = require("../utils/tomlResolver");
const { isNativeAsset } = require("../utils/assetHelpers");
router.use(normalizeAssetCode);

const DEFAULT_ASSET_HOLDERS_CACHE_TTL_MS = 30000;

function toSevenDecimalString(value) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "0.0000000";
  const truncated = Math.floor(parsed * 1e7) / 1e7;
  return truncated.toFixed(7);
}

const BASE_RESERVE = 0.5;

function isFreshRequest(query) {
  return query.fresh === true || query.fresh === "true";
}

function getAssetHoldersCacheTtlSeconds() {
  const parsed = Number.parseInt(process.env.CACHE_TTL_ASSET_HOLDERS_MS, 10);
  const ttlMs = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ASSET_HOLDERS_CACHE_TTL_MS;
  return ttlMs / 1000;
}

function findAssetBalance(account, assetCode, issuer) {
  return (account.balances || []).find(
    (balance) =>
      balance.asset_code === assetCode && balance.asset_issuer === issuer,
  );
}

function formatAssetHolder(account, assetCode, issuer) {
  const balance = findAssetBalance(account, assetCode, issuer);

  return {
    address: account.id || account.account_id,
    balance: toSevenDecimalString(balance ? balance.balance : "0.0000000"),
  };
}

function getNativeBalance(account) {
  const native = (account.balances || []).find((b) => isNativeAsset(b));
  return native ? parseFloat(native.balance) : 0;
}

function isValidNonNegativeDecimal(value) {
  if (value === undefined || value === null) return false;
  const normalized = String(value).trim();
  return /^\d+(?:\.\d+)?$/.test(normalized);
}

function parseNonNegativeDecimalQueryParam(rawValue, fieldName) {
  if (rawValue === undefined) return null;
  const value = String(rawValue).trim();

  if (value === "" || !isValidNonNegativeDecimal(value)) {
    const err = new Error(
      `Query parameter '${fieldName}': must be a non-negative decimal number.`,
    );
    err.isValidation = true;
    err.status = 400;
    err.field = fieldName;
    err.receivedValue = rawValue !== undefined ? String(rawValue) : rawValue;
    err.expectedFormat = "non-negative decimal string, e.g. 123.45";
    throw err;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    const err = new Error(
      `Query parameter '${fieldName}': must be a non-negative decimal number.`,
    );
    err.isValidation = true;
    err.status = 400;
    err.field = fieldName;
    err.receivedValue = rawValue !== undefined ? String(rawValue) : rawValue;
    err.expectedFormat = "non-negative decimal string, e.g. 123.45";
    throw err;
  }

  return parsed;
}

/**
 * @route GET /asset/:code/:issuer/holders
 */
router.get(
  "/:code/:issuer/holders",
  assetHoldersRateLimiter,
  async (req, res, next) => {
    try {
      const { code, issuer } = req.params;
      validateAsset(code, issuer);

      const assetCode = code.toUpperCase();
      const { limit, order, cursor } = parsePaginationParams(req.query);

      const fresh = req.query.fresh === true || req.query.fresh === "true";
      const minBalance = parseNonNegativeDecimalQueryParam(req.query.minBalance, "minBalance");
      const maxBalance = parseNonNegativeDecimalQueryParam(req.query.maxBalance, "maxBalance");

      const verified = req.query.verified;
      const isVerifiedFilter = verified === "true";

      if (verified !== undefined && verified !== "true" && verified !== "false") {
        const err = new Error("Query parameter 'verified': must be 'true' or 'false'.");
        err.isValidation = true;
        err.status = 400;
        err.field = "verified";
        err.receivedValue = String(verified);
        err.expectedFormat = "'true' or 'false'";
        throw err;
      }

      if (minBalance !== null && maxBalance !== null && minBalance > maxBalance) {
        const err = new Error("Query parameter 'minBalance' must not be greater than 'maxBalance'.");
        err.isValidation = true;
        err.status = 400;
        err.field = "minBalance";
        err.receivedValue = `${req.query.minBalance}`;
        throw err;
      }

      const skipCache = minBalance !== null || maxBalance !== null || isVerifiedFilter;
      const cacheKey = `asset-holders:${assetCode}:${issuer}:${limit}:${order}:${cursor || ""}`;

      if (!fresh && !skipCache) {
        const cached = cacheService.get(cacheKey);
        if (cached) {
          res.set("X-Cache", "HIT");
          return success(res, cached.holders, { meta: cached.meta });
        }
      }

      let query = server.accounts().forAsset(new Asset(assetCode, issuer)).limit(limit).order(order);
      if (cursor) query = query.cursor(cursor);

      const accountsResponse = await query.call();
      const records = accountsResponse.records || [];
      const holders = records.map((account) => formatAssetHolder(account, assetCode, issuer));

      const filteredHolders = holders.filter((holder, index) => {
        const balanceValue = Number(holder.balance);
        if (minBalance !== null && balanceValue < minBalance) return false;
        if (maxBalance !== null && balanceValue > maxBalance) return false;
        if (isVerifiedFilter) {
          const nativeBalance = getNativeBalance(records[index]);
          if (nativeBalance <= BASE_RESERVE) return false;
        }
        return true;
      });

      const lastRecord = records[records.length - 1];
      const nextCursor = lastRecord ? lastRecord.paging_token : null;

      const meta = {
        total: filteredHolders.length,
        limit,
        order,
        nextCursor,
        hasMore: filteredHolders.length === limit,
      };

      if (!skipCache) {
        cacheService.set(cacheKey, { holders: filteredHolders, meta }, getAssetHoldersCacheTtlSeconds());
      }

      res.set("X-Cache", "MISS");
      return success(res, filteredHolders, { meta });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /asset/:code/:issuer
 */
router.get("/:code/:issuer", async (req, res, next) => {
  try {
    const { code, issuer } = req.params;
    validateAsset(code, issuer);

    const assetCode = code.toUpperCase();
    const cacheKey = `asset:${assetCode}:${issuer}`;
    const fresh = isFreshRequest(req.query);

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    const [assetsResponse, issuerAccount] = await Promise.allSettled([
      server.assets().forCode(assetCode).forIssuer(issuer).call(),
      server.loadAccount(issuer),
    ]);

    if (
      assetsResponse.status === "rejected" ||
      !assetsResponse.value.records ||
      assetsResponse.value.records.length === 0
    ) {
      throw makeAssetNotFoundError(assetCode, issuer, NETWORK);
    }

    const asset = assetsResponse.value.records[0];

    let issuerInfo = null;
    if (issuerAccount.status === "fulfilled") {
      issuerInfo = {
        homeDomain: issuerAccount.value.home_domain || null,
        flags: issuerAccount.value.flags,
        thresholds: issuerAccount.value.thresholds,
      };
    }

    const data = {
      asset: normalizeAsset(asset.asset_code, asset.asset_issuer, asset.asset_type),
      amount: asset.amount,
      numAccounts: asset.num_accounts,
      numClaimableBalances: asset.num_claimable_balances,
      numLiquidityPools: asset.num_liquidity_pools,
      claimableBalancesAmount: asset.claimable_balances_amount,
      liquidityPoolsAmount: asset.liquidity_pools_amount,
      flags: asset.flags,
      issuer: issuerInfo,
    };

    cacheService.set(cacheKey, data, cacheTTL.asset);
    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /asset/:code/:issuer/distribution
 */
router.get("/:code/:issuer/distribution", async (req, res, next) => {
  try {
    const { code, issuer } = req.params;
    validateAsset(code, issuer);

    const assetCode = code.toUpperCase();
    const topLimit = req.query.limit !== undefined ? validateLimit(req.query.limit, 200) : 10;

    const assetsResponse = await server.assets().forCode(assetCode).forIssuer(issuer).call();

    if (!assetsResponse.records || assetsResponse.records.length === 0) {
      throw makeAssetNotFoundError(assetCode, issuer, NETWORK);
    }

    const asset = assetsResponse.records[0];
    const totalHolders = asset.num_accounts;

    const accountsResponse = await server
      .accounts()
      .forAsset(new Asset(assetCode, issuer))
      .limit(200)
      .call();

    const records = accountsResponse.records || [];
    if (records.length === 0) {
      return success(res, {
        totalHolders: 0,
        topHolders: [],
        distributionStats: { top10HoldersPercent: 0, top25HoldersPercent: 0, largestHolder: null, smallestHolder: null },
        giniCoefficient: 0,
        top10HoldersPercent: 0,
        top25HoldersPercent: 0,
        largestHolder: null,
        smallestHolder: null,
      });
    }

    const holdersData = records.map((r) => {
      const b = r.balances.find((bal) => bal.asset_code === assetCode && bal.asset_issuer === issuer);
      return { address: r.id, balanceNum: parseFloat(b ? b.balance : "0") };
    }).sort((a, b) => b.balanceNum - a.balanceNum);

    const balances = holdersData.map((h) => h.balanceNum);
    const totalInFetched = balances.reduce((sum, b) => sum + b, 0);
    const totalAssetSupply = parseFloat(asset.amount || "0");

    const topHolders = holdersData.slice(0, topLimit).map((h) => ({
      address: h.address,
      balance: toSevenDecimalString(h.balanceNum),
    }));

    const top10Sum = balances.slice(0, 10).reduce((sum, b) => sum + b, 0);
    const top25Sum = balances.slice(0, 25).reduce((sum, b) => sum + b, 0);

    const top10HoldersPercent = totalAssetSupply > 0 ? parseFloat(((top10Sum / totalAssetSupply) * 100).toFixed(2)) : 0;
    const top25HoldersPercent = totalAssetSupply > 0 ? parseFloat(((top25Sum / totalAssetSupply) * 100).toFixed(2)) : 0;

    const largestHolder = holdersData[0]?.address || null;
    const smallestHolder = holdersData[holdersData.length - 1]?.address || null;

    const n = balances.length;
    const sortedAsc = [...balances].sort((a, b) => a - b);
    let cumulativeSum = 0;
    for (let i = 0; i < n; i++) {
      cumulativeSum += (i + 1) * sortedAsc[i];
    }

    const G = totalInFetched > 0 ? (2 * cumulativeSum) / (n * totalInFetched) - (n + 1) / n : 0;
    const giniCoefficient = parseFloat(Math.max(0, G).toFixed(4));

    return success(res, {
      totalHolders,
      topHolders,
      distributionStats: { top10HoldersPercent, top25HoldersPercent, largestHolder, smallestHolder },
      giniCoefficient,
      top10HoldersPercent,
      top25HoldersPercent,
      largestHolder,
      smallestHolder,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /asset/:code/:issuer/liquidity-pools
 */
router.get("/:code/:issuer/liquidity-pools", async (req, res, next) => {
  try {
    const { code, issuer } = req.params;
    const isNative = code.toUpperCase() === "XLM" && issuer.toLowerCase() === "native";
    if (!isNative) validateAsset(code, issuer);

    const assetCode = code.toUpperCase();
    const asset = isNative ? Asset.native() : new Asset(assetCode, issuer);
    const assetString = isNative ? "native" : `${assetCode}:${issuer}`;
    const { limit, cursor } = parsePaginationParams(req.query);

    let query = server.liquidityPools().forAssets(asset).limit(limit);
    if (cursor) query = query.cursor(cursor);
    const response = await query.call();
    const records = response.records || [];

    const formatReserve = (r) => ({
      asset: normalizeAssetFromString(r.asset),
      amount: toSevenDecimalString(r.amount),
    });

    const pools = records
      .filter((p) => (p.reserves || []).some((r) => r.asset === assetString))
      .map((p) => ({
        poolId: p.id,
        fee: p.fee_bp,
        totalShares: toSevenDecimalString(p.total_shares),
        reserveA: formatReserve(p.reserves[0]),
        reserveB: formatReserve(p.reserves[1]),
        totalTrustlines: parseInt(p.total_trustlines || "0", 10),
      }));

    const nextCursor = records.length > 0 ? records[records.length - 1].paging_token || null : null;
    return success(res, { pools, total: pools.length, limit, cursor: nextCursor });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /asset/:code/:issuer/supply
 */
router.get("/:code/:issuer/supply", async (req, res, next) => {
  try {
    const { code, issuer } = req.params;
    validateAsset(code, issuer);

    const assetCode = code.toUpperCase();

    const assetsResponse = await server.assets().forCode(assetCode).forIssuer(issuer).call();

    if (!assetsResponse.records || assetsResponse.records.length === 0) {
      throw makeAssetNotFoundError(assetCode, issuer, NETWORK);
    }

    const asset = assetsResponse.records[0];

    const amount = parseFloat(asset.amount || "0");
    const lockedInPools = parseFloat(asset.liquidity_pools_amount || "0");
    const lockedInClaimableBalances = parseFloat(asset.claimable_balances_amount || "0");
    const totalSupply = amount + lockedInPools + lockedInClaimableBalances;
    const circulatingSupply = amount;

    return success(res, {
      totalSupply: totalSupply.toFixed(7),
      circulatingSupply: circulatingSupply.toFixed(7),
      lockedInPools: lockedInPools.toFixed(7),
      lockedInClaimableBalances: lockedInClaimableBalances.toFixed(7),
      holderCount: asset.num_accounts,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /asset/search?code=USDC
 */
router.get("/search", async (req, res, next) => {
  try {
    const { code, limit: rawLimit } = req.query;

    if (!code) {
      const err = new Error("Query parameter 'code' is required.");
      err.isValidation = true;
      throw err;
    }

    validateAssetCode(code);
    const assetCode = code.toUpperCase();
    const limit = validateLimit(rawLimit ?? 20);

    const assetsResponse = await server.assets().forCode(assetCode).limit(limit).call();

    const assets = assetsResponse.records.map((a) => ({
      asset: normalizeAsset(a.asset_code, a.asset_issuer, a.asset_type),
      amount: a.amount,
      numAccounts: a.num_accounts,
      flags: a.flags,
    }));

    return success(res, { items: assets, total: assets.length, limit, cursor: null });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /asset/:code/:issuer/verify
 */
router.get("/:code/:issuer/verify", async (req, res, next) => {
  try {
    const { code, issuer } = req.params;
    validateAsset(code, issuer);

    const assetCode = code.toUpperCase();
    const axios = require("axios");

    const checks = {
      accountExists: { passed: false, detail: "Account not found on Stellar network." },
      hasHomeDomain: { passed: false, detail: "No home_domain set on issuer account." },
      tomlReachable: { passed: false, detail: "stellar.toml not fetched (home_domain required)." },
      listedInToml: { passed: false, detail: "Asset not listed in CURRENCIES (toml required)." },
    };

    let issuerAccount;
    try {
      issuerAccount = await server.loadAccount(issuer);
      checks.accountExists = { passed: true, detail: "Issuer account exists on the Stellar network." };
    } catch (err) {
      return success(res, { verified: false, checks });
    }

    const homeDomain = issuerAccount.home_domain;
    if (!homeDomain) {
      return success(res, { verified: false, checks });
    }
    checks.hasHomeDomain = { passed: true, detail: `home_domain is "${homeDomain}".` };

    const tomlUrl = `https://${homeDomain}/.well-known/stellar.toml`;
    let tomlText;
    try {
      const response = await axios.get(tomlUrl, { timeout: 5000 });
      tomlText = response.data;
      checks.tomlReachable = { passed: true, detail: `stellar.toml fetched from ${tomlUrl}.` };
    } catch (err) {
      return success(res, { verified: false, checks });
    }

    const codePattern = new RegExp(`code\\s*=\\s*["']?${assetCode}["']?`, "i");
    const issuerPattern = new RegExp(`issuer\\s*=\\s*["']?${issuer}["']?`, "i");
    const blocks = tomlText.split(/\[\[CURRENCIES\]\]/i).slice(1);
    const listed = blocks.some((block) => codePattern.test(block) && issuerPattern.test(block));

    if (listed) {
      checks.listedInToml = { passed: true, detail: `${assetCode} is listed in the CURRENCIES section of stellar.toml.` };
    } else {
      checks.listedInToml = { passed: false, detail: `${assetCode} was not found in the CURRENCIES section of stellar.toml.` };
    }

    const verified = Object.values(checks).every((c) => c.passed);
    return success(res, { verified, checks });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /asset/:code/:issuer/toml
 */
router.get("/:code/:issuer/toml", async (req, res, next) => {
  try {
    const { code, issuer } = req.params;
    validateAsset(code, issuer);

    const assetCode = code.toUpperCase();
    const cacheKey = `asset-toml:${assetCode}:${issuer}`;
    const fresh = isFreshRequest(req.query);

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    let issuerAccount;
    try {
      issuerAccount = await server.loadAccount(issuer);
    } catch (err) {
      throw makeAccountNotFoundError(issuer, NETWORK);
    }

    const homeDomain = issuerAccount.home_domain;
    if (!homeDomain) throw makeTomlFetchFailedError(issuer);

    let toml;
    try {
      ({ toml } = await fetchNormalisedToml(homeDomain));
    } catch (err) {
      throw makeTomlFetchFailedError(issuer);
    }

    if (!toml) throw makeTomlFetchFailedError(issuer);

    const currencies = toml.currencies || [];
    const assetEntry = currencies.find((curr) => curr.code === assetCode && curr.issuer === issuer);

    const data = {
      code: assetCode,
      issuer: issuer,
      name: assetEntry?.name || null,
      description: assetEntry?.desc || assetEntry?.description || null,
      image: assetEntry?.image || null,
      anchorAssetType: assetEntry?.asset?.type || null,
      conditions: assetEntry?.conditions || null,
    };

    cacheService.set(cacheKey, data, cacheTTL.toml);
    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /asset/:code/:issuer/price
 */
router.get("/:code/:issuer/price", async (req, res, next) => {
  try {
    const { code, issuer } = req.params;
    validateAsset(code, issuer);

    const assetCode = code.toUpperCase();
    const cacheKey = `asset-price:${assetCode}:${issuer}`;
    const fresh = isFreshRequest(req.query);

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    const asset = new Asset(assetCode, issuer);
    const orderBookResponse = await server.orderbook(asset, Asset.native()).limit(200).call();

    const bids = orderBookResponse.bids || [];
    const asks = orderBookResponse.asks || [];

    if (bids.length === 0 && asks.length === 0) {
      return res.status(404).json({
        success: false,
        error: makeOrderBookEmptyError(assetCode, "XLM"),
      });
    }

    const bid = bids.length > 0 ? parseFloat(bids[0].price) : null;
    const ask = asks.length > 0 ? parseFloat(asks[0].price) : null;
    const mid = bid !== null && ask !== null ? (bid + ask) / 2 : (bid !== null ? bid : ask);

    const data = {
      asset: normalizeAsset(assetCode, issuer, "credit_alphanum4"),
      quoteAsset: "XLM",
      bid: bid !== null ? bid.toFixed(7) : null,
      ask: ask !== null ? ask.toFixed(7) : null,
      mid: mid.toFixed(7),
      priceInXlm: mid.toFixed(7),
    };

    cacheService.set(cacheKey, data, cacheTTL.assetPrice);
    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    if (err.response && err.response.status === 404) {
      return res.status(404).json({
        success: false,
        error: makeOrderBookEmptyError(String(req.params.code).toUpperCase(), "XLM"),
      });
    }
    next(err);
  }
});

/**
 * Resolution map for the holder-growth time series.
 */
const HOLDER_GROWTH_RESOLUTIONS = {
  "7d": { windowMs: 7 * 24 * 60 * 60 * 1000, bucketMs: 24 * 60 * 60 * 1000 },
  "30d": { windowMs: 30 * 24 * 60 * 60 * 1000, bucketMs: 7 * 24 * 60 * 60 * 1000 },
  "90d": { windowMs: 90 * 24 * 60 * 60 * 1000, bucketMs: 7 * 24 * 60 * 60 * 1000 },
};

function aggregateTrustlineGrowth(operations, windowStartMs, bucketMs) {
  const buckets = new Map();

  for (const op of operations) {
    const opTime = new Date(op.created_at).getTime();
    if (!Number.isFinite(opTime) || opTime < windowStartMs) continue;

    const bucketStart = Math.floor(opTime / bucketMs) * bucketMs;
    if (!buckets.has(bucketStart)) {
      buckets.set(bucketStart, {
        bucketStart,
        date: new Date(bucketStart).toISOString(),
        change: 0,
        added: 0,
        removed: 0,
      });
    }

    const bucket = buckets.get(bucketStart);
    if (parseFloat(op.limit) > 0) {
      bucket.change += 1;
      bucket.added += 1;
    } else {
      bucket.change -= 1;
      bucket.removed += 1;
    }
  }

  const sorted = Array.from(buckets.values()).sort((a, b) => a.bucketStart - b.bucketStart);

  let cumulativeHolders = 0;
  return sorted.map((bucket) => {
    cumulativeHolders += bucket.change;
    return {
      date: bucket.date,
      holders: cumulativeHolders,
      change: bucket.change,
      added: bucket.added,
      removed: bucket.removed,
    };
  });
}

/**
 * GET /asset/:code/:issuer/holder-growth
 */
router.get("/:code/:issuer/holder-growth", async (req, res, next) => {
  try {
    const { code, issuer } = req.params;
    validateAsset(code, issuer);

    const assetCode = code.toUpperCase();
    const resolution = req.query.resolution || "30d";

    if (!HOLDER_GROWTH_RESOLUTIONS[resolution]) {
      return res.status(400).json({
        success: false,
        error: {
          type: "ValidationError",
          message: "Invalid resolution. Accepted values are 7d, 30d, and 90d.",
          field: "resolution",
          receivedValue: String(resolution),
        },
      });
    }

    const cacheKey = `asset-holder-growth:${assetCode}:${issuer}:${resolution}`;
    const fresh = isFreshRequest(req.query);

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    const { windowMs, bucketMs } = HOLDER_GROWTH_RESOLUTIONS[resolution];
    const windowStartMs = Date.now() - windowMs;

    const operationsResponse = await server
      .operations()
      .forAccount(issuer)
      .order("desc")
      .limit(200)
      .call();

    const records = (operationsResponse.records || []).filter(
      (op) =>
        op.type === "change_trust" &&
        op.asset_code === assetCode &&
        op.asset_issuer === issuer,
    );

    const growth = aggregateTrustlineGrowth(records, windowStartMs, bucketMs);

    const data = {
      growth,
      asset: normalizeAsset(assetCode, issuer, "credit_alphanum4"),
      resolution,
    };

    cacheService.set(cacheKey, data, cacheTTL.asset);
    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /asset/:code/:issuer/trading-volume
 */
router.get("/:code/:issuer/trading-volume", async (req, res, next) => {
  try {
    const { code, issuer } = req.params;
    validateAsset(code, issuer);

    const assetCode = code.toUpperCase();
    const asset = new Asset(assetCode, issuer);
    const windowStartMs = Date.now() - 24 * 60 * 60 * 1000;
    const traders = new Set();
    let volume = 0;
    let tradeCount = 0;
    let cursor;
    let done = false;

    while (!done) {
      let query = server.trades().forAsset(asset).order("desc").limit(200);
      if (cursor) query = query.cursor(cursor);

      const response = await query.call();
      const records = response.records || [];
      if (records.length === 0) break;

      for (const trade of records) {
        cursor = trade.paging_token;
        const timestamp = new Date(trade.ledger_close_time).getTime();
        if (!Number.isFinite(timestamp)) continue;
        if (timestamp < windowStartMs) { done = true; break; }

        const isBaseAsset =
          trade.base_asset_code?.toUpperCase() === assetCode &&
          trade.base_asset_issuer === issuer;
        const isCounterAsset =
          trade.counter_asset_code?.toUpperCase() === assetCode &&
          trade.counter_asset_issuer === issuer;
        if (!isBaseAsset && !isCounterAsset) continue;

        const amount = Number(isBaseAsset ? trade.base_amount : trade.counter_amount);
        if (Number.isFinite(amount)) volume += amount;
        tradeCount += 1;
        if (trade.base_account) traders.add(trade.base_account);
        if (trade.counter_account) traders.add(trade.counter_account);
      }

      if (done || records.length < 200 || !cursor) break;
    }

    return success(res, {
      asset: normalizeAsset(assetCode, issuer, "credit_alphanum4"),
      volume24h: volume.toFixed(7),
      tradeCount24h: tradeCount,
      uniqueTraders24h: traders.size,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /asset/:code/:issuer/issuance-history
 */
router.get("/:code/:issuer/issuance-history", async (req, res, next) => {
  try {
    const { code, issuer } = req.params;
    validateAsset(code, issuer);

    const assetCode = code.toUpperCase();
    const resolution = req.query.resolution || "30d";

    const validResolutions = ["7d", "30d", "90d"];
    if (!validResolutions.includes(resolution)) {
      const err = new Error(`Invalid resolution "${resolution}". Valid options are: ${validResolutions.join(", ")}.`);
      err.isValidation = true;
      err.status = 400;
      err.field = "resolution";
      err.receivedValue = resolution;
      err.expectedFormat = validResolutions.join(", ");
      throw err;
    }

    const cacheKey = `asset-issuance-history:${assetCode}:${issuer}:${resolution}`;
    const fresh = isFreshRequest(req.query);

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    const assetsResponse = await server.assets().forCode(assetCode).forIssuer(issuer).call();

    if (!assetsResponse.records || assetsResponse.records.length === 0) {
      throw makeAssetNotFoundError(assetCode, issuer, NETWORK);
    }

    const assetRecord = assetsResponse.records[0];
    const currentSupply = assetRecord.amount;

    const now = Date.now();
    const daysMap = { "7d": 7, "30d": 30, "90d": 90 };
    const days = daysMap[resolution];
    const startTime = now - (days * 24 * 60 * 60 * 1000);

    const samplesPerDay = resolution === "7d" ? 4 : (resolution === "30d" ? 2 : 1);
    const totalSamples = days * samplesPerDay;
    const intervalMs = (days * 24 * 60 * 60 * 1000) / totalSamples;

    const history = [];
    for (let i = 0; i < totalSamples; i++) {
      const timestamp = new Date(startTime + (i * intervalMs)).toISOString();
      history.push({ timestamp, supply: currentSupply });
    }

    const data = {
      asset: normalizeAsset(assetCode, issuer, assetRecord.asset_type),
      resolution,
      history,
      currentSupply,
      dataPoints: history.length,
    };

    cacheService.set(cacheKey, data, 300);
    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
