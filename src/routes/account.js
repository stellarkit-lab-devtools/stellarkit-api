const express = require("express");
const router = express.Router();
const registerParamValidation = require("../middleware/validateRouteParams");
registerParamValidation(router);

const { server, fetchAccountCreation, NETWORK } = require("../config/stellar");
const { success, toISOTimestamp } = require("../utils/response");
const { makeAccountNotFoundError, makeClaimableBalanceNotFoundError } = require("../utils/errors");

const {
  validateAccountId,
  validateAssetCode,
} = require("../utils/validators");

const { parsePaginationParams } = require("../utils/pagination");
const { buildAccountAgeResponse } = require("../utils/accountAge");


const axios = require("axios");
const { Asset } = require("@stellar/stellar-sdk");

const { getAssetMetadataFromToml } = require("../utils/tomlResolver");
const { formatBalance } = require("../utils/formatBalance");

function validateLimit(limit, max = 100) {
  const n = Number(limit);
  if (!Number.isInteger(n) || n <= 0 || n > max) {
    const err = new Error(`limit must be between 1 and ${max}`);
    err.status = 400;
    err.field = "limit";
    err.receivedValue = String(limit);
    throw err;
  }
  return n;
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
  const xlmBalance = (account.balances || []).find((b) => b.asset_type === "native");
  const assets = (account.balances || [])
    .filter((b) => b.asset_type !== "native")
    .map((b) => ({
      assetCode: b.asset_code,
      assetIssuer: b.asset_issuer,
      assetType: b.asset_type,
      balance: b.balance,
      limit: b.limit,
      buyingLiabilities: b.buying_liabilities,
      sellingLiabilities: b.selling_liabilities,
      isAuthorized: b.is_authorized,
      isClawbackEnabled: b.is_clawback_enabled,
    }));

  return {
    xlm: {
      balance: xlmBalance ? formatBalance(xlmBalance.balance) : formatBalance("0.0000000"),
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

async function resolveTrustlineToml(balance, issuerCache, tomlCache) {
  const assetIssuer = balance.asset_issuer;
  const assetCode = balance.asset_code;

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
    isAuthorizedToMaintainLiabilities: balance.is_authorized_to_maintain_liabilities,
    toml,
  };
}

/**
 * GET /account/:id/trustlines
 */
router.get("/:id/trustlines", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const account = await server.loadAccount(id);

    const issuerCache = new Map();
    const tomlCache = new Map();

    const trustlineBalances = (account.balances || []).filter(
      (b) => b.asset_type !== "native",
    );

    let trustlines = await Promise.all(
      trustlineBalances.map((b) =>
        resolveTrustlineToml(b, issuerCache, tomlCache),
      ),
    );

    const { assetCode } = req.query;
    if (assetCode) {
      const filterLower = assetCode.toLowerCase();
      trustlines = trustlines.filter(
        (t) => t.asset.code.toLowerCase() === filterLower,
      );
    }

    return success(res, {
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
 */
router.get("/:id/balances", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const account = await server.loadAccount(id);
    const formatted = formatAccountBalances(account);

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

    const account = await server.loadAccount(id);
    const xlmBalance = (account.balances || []).find((b) => b.asset_type === "native");

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
 * GET /account/:id/sequence
 */
router.get("/:id/sequence", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const account = await server.loadAccount(id);

    return success(res, {
      accountId: account.id,
      sequence: account.sequence,
      lastModifiedLedger: account.last_modified_ledger,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/payments
 * Returns payment and create_account operations with full asset detail (including TOML metadata).
 */
router.get("/:id/payments", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const { limit, order, cursor } = parsePaginationParams(req.query);

    // Optional asset filters — both are independently optional:
    //   ?assetCode=USDC              → match any issuer of USDC
    //   ?assetCode=USDC&assetIssuer=GA... → exact asset match
    const filterCode = req.query.assetCode
      ? req.query.assetCode.toUpperCase()
      : null;
    const filterIssuer = req.query.assetIssuer || null;

    let query = server.operations().forAccount(id).limit(limit).order(order);
    if (cursor) query = query.cursor(cursor);

    const opResponse = await query.call();
    const rawRecords = opResponse.records || [];

    const issuerCache = new Map();
    const tomlCache = new Map();

    const paymentOps = [];
    for (const op of rawRecords) {
      if (op.type === "payment" || op.type === "create_account") {
        const isPayment = op.type === "payment";
        const assetCode = isPayment ? op.asset_code || "XLM" : "XLM";
        const assetIssuer = isPayment ? op.asset_issuer || null : null;

        // Apply assetCode filter (case-insensitive, already uppercased above)
        if (filterCode && assetCode.toUpperCase() !== filterCode) return;

        // Apply assetIssuer filter only when both params are provided
        if (filterCode && filterIssuer && assetIssuer !== filterIssuer) return;
        const assetType = isPayment ? op.asset_type || "native" : "native";

        let assetDetail = {
          code: assetCode,
          issuer: assetIssuer,
          type: assetType,
        };

        if (assetType !== "native" && assetIssuer) {
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

          if (homeDomain) {
            if (!tomlCache.has(homeDomain)) {
              tomlCache.set(homeDomain, homeDomain);
            }
            try {
              const toml = await getAssetMetadataFromToml(homeDomain, assetCode);
              if (toml) {
                assetDetail = { ...assetDetail, toml };
              }
            } catch (_) {
              // TOML resolution failed, keep basic asset detail
            }
          }
        }

        paymentOps.push({
          type: op.type,
          amount: isPayment ? op.amount : op.starting_balance,
          asset: {
            code: assetCode,
            issuer: assetIssuer,
            type: isPayment ? op.asset_type || "native" : "native",
          },
          asset: assetDetail,
          sender: isPayment ? op.from : op.funder,
          receiver: isPayment ? op.to : op.account,
          createdAt: toISOTimestamp(op.created_at),
        });
      }
    }

    const lastIdx = rawRecords.length ? rawRecords.length - 1 : -1;
    const nextCursor =
      rawRecords[lastIdx] && rawRecords[lastIdx].paging_token
        ? rawRecords[lastIdx].paging_token
        : null;

    return success(res, {
      items: paymentOps,
      total: paymentOps.length,
      limit,
      cursor: paymentOps.length ? nextCursor : null,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/offers
 */
router.get("/:id/offers", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const limit = validateLimit(req.query.limit ?? 20);
    const cursor = req.query.cursor || undefined;

    let query = server.offers().forAccount(id).limit(limit);
    if (cursor) query = query.cursor(cursor);

    const offerResponse = await query.call();
    const offers = (offerResponse.records || []).map((offer) => {
      // Normalise asset fields to a consistent camelCase shape.
      const buildAsset = (assetType, assetCode, assetIssuer) => {
        if (assetType === "native") {
          return { assetType: "native", assetCode: "XLM", assetIssuer: null };
        }
        return { assetType, assetCode, assetIssuer };
      };

      // Derive a single decimal price string from price_r (n/d fraction) when
      // available, falling back to the pre-computed price string from Horizon.
      // Always format to 7 decimal places for consistency with other amounts.
      let priceDecimal;
      if (offer.price_r && offer.price_r.d && Number(offer.price_r.d) !== 0) {
        priceDecimal = (Number(offer.price_r.n) / Number(offer.price_r.d)).toFixed(7);
      } else {
        priceDecimal = parseFloat(offer.price || "0").toFixed(7);
      }

      return {
        id: offer.id,
        seller: offer.seller,
        selling: {
          ...buildAsset(
            offer.selling_asset_type,
            offer.selling_asset_code,
            offer.selling_asset_issuer,
          ),
          // Format to 7 decimal places (Stellar precision standard)
          amount: parseFloat(offer.amount || "0").toFixed(7),
        },
        buying: buildAsset(
          offer.buying_asset_type,
          offer.buying_asset_code,
          offer.buying_asset_issuer,
        ),
        // price is a 7-decimal string derived from the price_r fraction
        price: priceDecimal,
        // camelCase rename of last_modified_ledger
        lastModifiedLedger: offer.last_modified_ledger,
      };
    });

    const hasMore = (offerResponse.records || []).length === limit;
    const nextCursor = hasMore
      ? (offerResponse.records[offerResponse.records.length - 1] || {}).paging_token
      : null;

    return success(res, {
      items: offers,
      total: offers.length,
      limit,
      cursor: nextCursor,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/claimable-balances
 * Returns claimable balances for an account, categorized by claimability.
 */
router.get("/:id/claimable-balances", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const limit = validateLimit(req.query.limit || 200, 200);
    const cursor = req.query.cursor || undefined;

    let query = server.claimableBalances().forClaimant(id).limit(limit);
    if (cursor) query = query.cursor(cursor);

    const response = await query.call();
    const records = response.records || [];

    const nowSeconds = Math.floor(Date.now() / 1000);

    function evaluatePredicate(predicate) {
      if (predicate.unconditional) {
        return { canClaim: true, reason: "The balance is claimable unconditionally." };
      }

      if (predicate.not) {
        const res = evaluatePredicate(predicate.not);
        return { canClaim: !res.canClaim, reason: `NOT (${res.reason})` };
      }

      if (predicate.and) {
        const results = predicate.and.map(p => evaluatePredicate(p));
        const canClaim = results.every(r => r.canClaim);
        return {
          canClaim,
          reason: canClaim ? `All conditions met` : `Some conditions failed`,
        };
      }

      if (predicate.or) {
        const results = predicate.or.map(p => evaluatePredicate(p));
        const canClaim = results.some(r => r.canClaim);
        return { canClaim, reason: canClaim ? `At least one condition met` : `No conditions met` };
      }

      if (predicate.abs_before) {
        const deadline = Math.floor(new Date(predicate.abs_before).getTime() / 1000);
        const canClaim = nowSeconds < deadline;
        return {
          canClaim,
          reason: canClaim ? `Before deadline ${predicate.abs_before}` : `Deadline passed`,
        };
      }

      if (predicate.abs_after) {
        const startTime = Math.floor(new Date(predicate.abs_after).getTime() / 1000);
        const canClaim = nowSeconds >= startTime;
        return {
          canClaim,
          reason: canClaim ? `After start time ${predicate.abs_after}` : `Not yet started`,
        };
      }

      return { canClaim: false, reason: "Unknown predicate type" };
    }

    const claimable = [];
    const notYetClaimable = [];
    const expired = [];

    for (const balance of records) {
      const claimant = balance.claimants.find(c => c.destination === id);
      if (!claimant) continue;

      const evaluation = evaluatePredicate(claimant.predicate);

      const balanceEntry = {
        id: balance.id,
        asset: balance.asset,
        amount: balance.amount,
        sponsor: balance.sponsor || null,
        lastModifiedLedger: balance.last_modified_ledger,
        predicate: claimant.predicate,
        claimability: evaluation.reason,
      };

      if (evaluation.canClaim) {
        claimable.push(balanceEntry);
      } else if (evaluation.reason.includes("Not yet started")) {
        notYetClaimable.push(balanceEntry);
      } else if (evaluation.reason.includes("Deadline passed")) {
        expired.push(balanceEntry);
      } else {
        notYetClaimable.push(balanceEntry);
      }
    }

    const nextCursor = records.length === limit ? (records[records.length - 1]?.paging_token || null) : null;

    return success(res, {
      eligible: claimable,
      notYetClaimable,
      expired,
      total: records.length,
      limit,
      cursor: nextCursor,
    });
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

    const firstSeen =
      successfulTransactions[0] ? toISOTimestamp(successfulTransactions[0].created_at) : null;
    const lastSeen =
      successfulTransactions[successfulTransactions.length - 1]
        ? toISOTimestamp(
            successfulTransactions[successfulTransactions.length - 1].created_at,
          )
        : null;

    const activeDays = firstSeen && lastSeen
      ? Math.max(
          1,
          Math.ceil(
            (new Date(lastSeen).getTime() - new Date(firstSeen).getTime()) / 86400000,
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
 */
router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const account = await server.loadAccount(id);

    const baseReserve = 0.5;
    const STROOPS_PER_XLM = 10_000_000;
    const accountReserve = 2 * baseReserve;
    const subentryReserve = (account.subentry_count || 0) * baseReserve;
    const totalLocked = accountReserve + subentryReserve;

    const toXLM = (xlm) => xlm.toFixed(7);
    const toStroops = (xlm) => Math.round(xlm * STROOPS_PER_XLM);

    const xlmBalance = (account.balances || []).find((b) => b.asset_type === "native");
    const assets = (account.balances || [])
      .filter((b) => b.asset_type !== "native")
      .map((b) => ({
        assetCode: b.asset_code,
        assetIssuer: b.asset_issuer,
        assetType: b.asset_type,
        balance: b.balance,
        limit: b.limit,
        buyingLiabilities: b.buying_liabilities,
        sellingLiabilities: b.selling_liabilities,
        isAuthorized: b.is_authorized,
        isClawbackEnabled: b.is_clawback_enabled,
      }));

    return success(res, {
      accountId: account.id,
      sequence: account.sequence,
      subentryCount: account.subentry_count,
      xlm: {
        balance: xlmBalance ? formatBalance(xlmBalance.balance) : formatBalance("0.0000000"),
        buyingLiabilities: xlmBalance ? formatBalance(xlmBalance.buying_liabilities) : formatBalance("0"),
        sellingLiabilities: xlmBalance ? formatBalance(xlmBalance.selling_liabilities) : formatBalance("0"),
      },
      assets,
      assetCount: assets.length,
      signers: account.signers,
      thresholds: account.thresholds,
      flags: account.flags,
      homeDomain: account.home_domain || null,
      lastModifiedLedger: account.last_modified_ledger,
      reserveBreakdown: {
        baseReserve: { xlm: toXLM(baseReserve), stroops: toStroops(baseReserve) },
        accountReserve: { xlm: toXLM(accountReserve), stroops: toStroops(accountReserve) },
        subentryReserve: { xlm: toXLM(subentryReserve), stroops: toStroops(subentryReserve) },
        totalLocked: { xlm: toXLM(totalLocked), stroops: toStroops(totalLocked) },
        spendable: {
          xlm: toXLM(parseFloat(xlmBalance?.balance || "0") - totalLocked),
          stroops: toStroops(parseFloat(xlmBalance?.balance || "0") - totalLocked),
        },
      },
    });
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

    const account = await server.loadAccount(id);

    // Get first operation to calculate account age
    const firstOpResponse = await server.operations()
      .forAccount(id)
      .order("asc")
      .limit(1)
      .call();
    const firstOp = firstOpResponse.records[0];

    // Get recent transactions
    const recentTxResponse = await server.transactions()
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
          detail: "Account is over 1 year old, established reputation"
        });
      } else if (daysOld > 30) {
        score += 10;
        factors.push({
          name: "Account Age",
          value: `${daysOld} days`,
          impact: "positive",
          detail: "Account is over 1 month old"
        });
      } else {
        score -= 15;
        factors.push({
          name: "Account Age",
          value: `${daysOld} days`,
          impact: "negative",
          detail: "Account is very new (less than 1 month)"
        });
      }
    } else {
      score -= 10;
      factors.push({
        name: "Account Age",
        value: "No operations found",
        impact: "neutral",
        detail: "No operations history found for account"
      });
    }

    // Factor 2: Home domain
    if (account.home_domain) {
      score += 10;
      factors.push({
        name: "Home Domain",
        value: account.home_domain,
        impact: "positive",
        detail: "Account has a home domain set"
      });
    } else {
      score -= 5;
      factors.push({
        name: "Home Domain",
        value: "Not set",
        impact: "neutral",
        detail: "No home domain configured"
      });
    }

    // Factor 3: Multi-sig
    if (account.signers.length > 1) {
      score += 10;
      factors.push({
        name: "Multi-signature",
        value: `${account.signers.length} signers`,
        impact: "positive",
        detail: "Account uses multi-signature security"
      });
    } else {
      factors.push({
        name: "Multi-signature",
        value: "Single signer",
        impact: "neutral",
        detail: "Account uses single signature"
      });
    }

    // Factor 4: Number of trustlines
    const trustlineCount = (account.balances || []).filter(b => b.asset_type !== "native").length;
    if (trustlineCount > 30) {
      score -= 15;
      factors.push({
        name: "Trustline Count",
        value: `${trustlineCount} trustlines`,
        impact: "negative",
        detail: "High number of trustlines may indicate risky behavior"
      });
    } else if (trustlineCount > 10) {
      score -= 5;
      factors.push({
        name: "Trustline Count",
        value: `${trustlineCount} trustlines`,
        impact: "neutral",
        detail: "Moderate number of trustlines"
      });
    } else {
      score += 5;
      factors.push({
        name: "Trustline Count",
        value: `${trustlineCount} trustlines`,
        impact: "positive",
        detail: "Low number of trustlines"
      });
    }

    // Factor 5: Recent activity
    if (recentTxs.length > 50) {
      score -= 10;
      factors.push({
        name: "Recent Activity",
        value: `${recentTxs.length} transactions in last limit`,
        impact: "negative",
        detail: "Very high recent transaction activity"
      });
    } else if (recentTxs.length > 20) {
      score -= 5;
      factors.push({
        name: "Recent Activity",
        value: `${recentTxs.length} transactions in last limit`,
        impact: "neutral",
        detail: "Moderate recent transaction activity"
      });
    } else {
      score += 5;
      factors.push({
        name: "Recent Activity",
        value: `${recentTxs.length} transactions in last limit`,
        impact: "positive",
        detail: "Low recent transaction activity"
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
      factors
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/subentry-health
 */
router.get("/:id/subentry-health", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const account = await server.loadAccount(id);

    const MAX_SUBENTRIES = 1000;
    const totalSubentries = account.subentry_count;
    const remainingSlots = Math.max(0, MAX_SUBENTRIES - totalSubentries);
    const usagePercentRaw = (totalSubentries / MAX_SUBENTRIES) * 100;
    const usagePercent = Math.round(usagePercentRaw * 100) / 100;

    let warning = null;
    if (usagePercentRaw > 95) warning = "critical";
    else if (usagePercentRaw > 80) warning = "approaching_limit";

    const trustlines = (account.balances || []).filter((b) => b.asset_type !== "native").length;
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
 * GET /account/:id/sponsorship
 */
router.get("/:id/sponsorship", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const [account, sponsoringResponse] = await Promise.all([
      server.loadAccount(id),
      server.accounts().sponsor(id).call(),
    ]);

    const sponsoredEntries = [];

    (account.balances || []).forEach((b) => {
      if (b.sponsor) {
        sponsoredEntries.push({
          type: "trustline",
          asset: b.asset_type === "native" ? "XLM" : `${b.asset_code}:${b.asset_issuer}`,
          sponsor: b.sponsor,
        });
      }
    });

    (account.signers || []).forEach((s) => {
      if (s.sponsor) {
        sponsoredEntries.push({
          type: "signer",
          key: s.key,
          sponsor: s.sponsor,
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
          });
        }
      });
    }

    const accountsSponsoring = (sponsoringResponse.records || []).map((acc) => acc.id);

    return success(res, {
      accountId: account.id,
      sponsoredEntries,
      accountsSponsoring,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

/**
 * GET /account/:id/freeze-status/:assetCode/:assetIssuer
 */
router.get("/:id/freeze-status/:assetCode/:assetIssuer", async (req, res, next) => {
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

    const account = await server.loadAccount(id);

    const trustline =
      normalizedAssetCode === "XLM"
        ? (account.balances || []).find((b) => b.asset_type === "native")
        : (account.balances || []).find(
            (b) =>
              b.asset_type !== "native" &&
              b.asset_code === normalizedAssetCode &&
              b.asset_issuer === assetIssuer,
          );

    if (!trustline) {
      const notFoundErr = new Error(
        `Account does not hold asset ${normalizedAssetCode}:${assetIssuer}.`,
      );
      notFoundErr.status = 404;
      throw notFoundErr;
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

    return success(res, {
      accountId: account.id,
      asset: {
        assetCode: normalizedAssetCode,
        assetIssuer: normalizedAssetCode === "XLM" ? "native" : assetIssuer,
      },
      isFrozen,
      isPartiallyFrozen,
      canSend,
      canReceive,
      detail,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

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
router.get("/:id/can-receive/:assetCode/:assetIssuer", async (req, res, next) => {
  try {
    const { id, assetCode, assetIssuer } = req.params;
    validateAccountId(id);
    validateAssetCode(assetCode);

    const normalizedAssetCode = assetCode.toUpperCase();
    const normalizedAssetIssuer =
      normalizedAssetCode === "XLM" ? assetIssuer.toLowerCase() : assetIssuer;

    if (normalizedAssetCode === "XLM") {
      if (normalizedAssetIssuer !== "native") {
        const err = new Error('Invalid asset issuer for XLM. Use "native" as the issuer.');
        err.isValidation = true;
        err.status = 400;
        throw err;
      }
    } else {
      validateAccountId(assetIssuer);
    }

    const account = await server.loadAccount(id);

    if (normalizedAssetCode === "XLM") {
      return success(res, {
        accountId: account.id,
        asset: { assetCode: "XLM", assetIssuer: "native" },
        canReceive: true,
        reasons: [],
        trustlineExists: true,
        isAuthorized: true,
        availableCapacity: null,
        currentBalance: parseFloat(
          (account.balances || []).find((b) => b.asset_type === "native")?.balance || "0",
        ),
        limit: null,
      });
    }

    const trustline = (account.balances || []).find(
      (b) => b.asset_type !== "native" && b.asset_code === normalizedAssetCode && b.asset_issuer === assetIssuer,
    );

    if (!trustline) {
      return success(res, {
        accountId: account.id,
        asset: { assetCode: normalizedAssetCode, assetIssuer },
        canReceive: false,
        reasons: ["No trustline exists for this asset."],
        trustlineExists: false,
        isAuthorized: false,
        availableCapacity: 0,
        currentBalance: 0,
        limit: 0,
      });
    }

    const isAuthorized = trustline.is_authorized === true;
    const currentBalance = parseFloat(trustline.balance || "0");
    const limit = parseFloat(trustline.limit || "0");
    const buyingLiabilities = parseFloat(trustline.buying_liabilities || "0");
    const availableCapacity = Math.max(0, limit - currentBalance - buyingLiabilities);

    const canReceive = isAuthorized && availableCapacity > 0;

    const reasons = [];
    if (!isAuthorized) {
      reasons.push("Trustline is not authorized by the issuer.");
    }
    if (isAuthorized && availableCapacity <= 0) {
      reasons.push("No available capacity on trustline (limit reached or fully utilized).");
    }

    return success(res, {
      accountId: account.id,
      asset: { assetCode: normalizedAssetCode, assetIssuer },
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
      const err = new Error("Query parameter 'days': must be an integer between 1 and 90.");
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
      let query = server
        .payments()
        .forAccount(id)
        .limit(200)
        .order("asc");
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
        const assetKey = assetIssuer ? `${assetCode}:${assetIssuer}` : assetCode;
        const amount = parseFloat(op.amount || op.starting_balance || "0");

        if (!volumeMap[assetKey]) {
          volumeMap[assetKey] = {
            assetCode,
            assetIssuer,
            totalSent: 0,
            totalReceived: 0,
          };
        }

        const isSent = (op.type === "payment" && op.from === id) || (op.type === "create_account" && op.funder === id);
        if (isSent) volumeMap[assetKey].totalSent += amount;
        else volumeMap[assetKey].totalReceived += amount;

        totalTransactions++;
        cursor = op.paging_token;
      }

      if (records.length < 200) done = true;
    }

    const volumeByAsset = Object.values(volumeMap).map((v) => ({
      assetCode: v.assetCode,
      assetIssuer: v.assetIssuer,
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
      .filter((op) => ["manage_sell_offer", "manage_buy_offer", "create_passive_sell_offer"].includes(op.type))
      .map((op) => {
        let offerType = "updated";
        if (op.type === "create_passive_sell_offer") offerType = "created";
        else if (parseFloat(op.amount) === 0) offerType = "deleted";
        else offerType = op.offer_id === "0" ? "created" : "updated";

        const formatAsset = (type, code, issuer) => {
          if (type === "native") return "XLM";
          return `${code}:${issuer}`;
        };

        return {
          offerId: op.offer_id,
          type: offerType,
          sellingAsset: formatAsset(op.selling_asset_type, op.selling_asset_code, op.selling_asset_issuer),
          buyingAsset: formatAsset(op.buying_asset_type, op.buying_asset_code, op.buying_asset_issuer),
          amount: op.amount,
          price: op.price,
          timestamp: toISOTimestamp(op.created_at),
          transactionHash: op.transaction_hash,
        };
      });

    const nextCursor = records.length > 0 ? records[records.length - 1].paging_token : null;

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

    const account = await server.loadAccount(id);

    const poolShareTrustlines = (account.balances || []).filter(
      (balance) => balance.asset_type === "liquidity_pool_shares",
    );

    if (poolShareTrustlines.length === 0) {
      return success(res, {
        items: [],
        total: 0,
        limit: null,
        cursor: null,
      });
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

      const sharePercent = totalShares > 0 ? (accountShares / totalShares) * 100 : 0;

      const reserveA = pool.reserves[0];
      const reserveB = pool.reserves[1];

      const equivalentReserveA = (parseFloat(reserveA.amount) * accountShares) / totalShares;
      const equivalentReserveB = (parseFloat(reserveB.amount) * accountShares) / totalShares;

      positions.push({
        poolId: pool.id,
        shares: accountShares.toFixed(7),
        sharePercent: sharePercent.toFixed(4),
        totalPoolShares: totalShares.toFixed(7),
        reserveA: {
          asset: reserveA.asset,
          totalAmount: parseFloat(reserveA.amount).toFixed(7),
          equivalentAmount: equivalentReserveA.toFixed(7),
        },
        reserveB: {
          asset: reserveB.asset,
          totalAmount: parseFloat(reserveB.amount).toFixed(7),
          equivalentAmount: equivalentReserveB.toFixed(7),
        },
        feeBp: pool.fee_bp || 30,
        totalTrustlines: pool.total_trustlines,
        lastModifiedLedger: pool.last_modified_ledger,
      });
    }

    return success(res, {
      items: positions,
      total: positions.length,
      limit: null,
      cursor: null,
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
    const limit = limitRaw === undefined ? 200 : parseInt(limitRaw, 10);
    if (isNaN(limit) || limit < 1 || limit > 200) {
      const err = new Error("Query parameter 'limit': must be an integer between 1 and 200.");
      err.isValidation = true;
      err.field = "limit";
      err.receivedValue = String(limitRaw);
      err.expectedFormat = "1–200";
      throw err;
    }

    const txResponse = await server
      .transactions()
      .forAccount(id)
      .limit(limit)
      .order("desc")
      .includeFailed(true)
      .call();

    const records = txResponse.records || [];

    const STROOPS_PER_XLM = 10_000_000;

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
      const feeChargedXlm = (feeChargedStroops / STROOPS_PER_XLM).toFixed(7);

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
      bucket.totalFeeChargedXlm = (bucket.totalFeeChargedStroops / STROOPS_PER_XLM).toFixed(7);
    }

    const successfulCount = records.filter((t) => t.successful === true).length;
    const failedCount = records.length - successfulCount;

    return success(res, {
      accountId: id,
      limit,
      counts: { total: records.length, successful: successfulCount, failed: failedCount },
      firstSeenAt: records.length ? toISOTimestamp(records[records.length - 1].created_at) : null,
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
      const err = new Error("availableSigners must be an array of public keys.");
      err.status = 400;
      return next(err);
    }

    for (const signerKey of availableSigners) {
      validateAccountId(signerKey);
    }

    const account = await server.loadAccount(id);
    const thresholds = account.thresholds;

    const accountSigners = account.signers || [];
    const availableMatches = availableSigners
      .map((key) => accountSigners.find((s) => s.key === key))
      .filter(Boolean);

    const signerWeights = availableMatches.map((s) => ({ key: s.key, weight: s.weight, type: s.type }));

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
        .map((c) => c.map((s) => ({ key: s.key, weight: s.weight, type: s.type })));

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
      high: findMinimalCombinations(availableMatches, thresholds.high_threshold),
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
 * GET /account/:id/claimable-balances
 */
router.get("/:id/claimable-balances", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const limit = req.query.limit ? validateLimit(req.query.limit) : 200;
    const cursor = req.query.cursor || undefined;

    let query = server.claimableBalances().claimant(id).limit(limit);
    if (cursor) {
      query = query.cursor(cursor);
    }

    const response = await query.call();

    const claimableBalances = (response.records || []).map((balance) => ({
      id: balance.id,
      asset: balance.asset,
      amount: balance.amount,
      claimants: balance.claimants,
      predicate: balance.predicate,
      lastModifiedLedger: balance.last_modified_ledger,
      lastModifiedTime: balance.last_modified_time,
    }));

    return success(res, {
      items: claimableBalances,
      total: claimableBalances.length,
      cursor: response.next_cursor || null,
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

    const account = await server.loadAccount(id);

    const dataEntries = Object.entries(account.data || {}).map(([key, value]) => ({
      key,
      value,
    }));

    return success(res, {
      items: dataEntries,
      total: dataEntries.length,
    });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id);
  }
});

module.exports = router;

