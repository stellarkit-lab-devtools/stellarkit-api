const express = require("express");
const router = express.Router();
const { Asset } = require("@stellar/stellar-sdk");
const { server } = require("../config/stellar");
const { success } = require("../utils/response");
const { assetHoldersRateLimiter } = require("../middleware/rateLimiter");
const {
  validateAccountId,
  validateAssetCode,
  validateLimit,
} = require("../utils/validators");

function findAssetBalance(account, assetCode, issuer) {
  return (account.balances || []).find(
    (balance) =>
      balance.asset_code === assetCode && balance.asset_issuer === issuer,
  );
}

function formatAssetHolder(account, assetCode, issuer) {
  const balance = findAssetBalance(account, assetCode, issuer);

  return {
    accountId: account.id || account.account_id,
    balance: balance ? balance.balance : "0.0000000",
    limit: balance ? balance.limit : null,
    buyingLiabilities: balance ? balance.buying_liabilities : "0.0000000",
    sellingLiabilities: balance ? balance.selling_liabilities : "0.0000000",
    isAuthorized: balance ? balance.is_authorized : null,
    isAuthorizedToMaintainLiabilities: balance
      ? balance.is_authorized_to_maintain_liabilities
      : null,
    isClawbackEnabled: balance ? balance.is_clawback_enabled : null,
    lastModifiedLedger: account.last_modified_ledger,
  };
}

/**
 * GET /asset/:code/:issuer/holders
 * Returns paginated accounts that hold a trustline for a specific asset.
 *
 * Query params:
 *   - limit   (number, default: 10, max: 200)
 *   - cursor  (string, pagination cursor from previous response)
 *   - order   ("asc" | "desc", default: "desc")
 *
 * @example
 * GET /asset/USDC/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN/holders
 */
router.get(
  "/:code/:issuer/holders",
  assetHoldersRateLimiter,
  async (req, res, next) => {
    try {
      const { code, issuer } = req.params;
      validateAssetCode(code);
      validateAccountId(issuer);

      const assetCode = code.toUpperCase();
      const limit = validateLimit(req.query.limit || 10, 200);
      const order = ["asc", "desc"].includes(req.query.order)
        ? req.query.order
        : "desc";
      const cursor = req.query.cursor || undefined;

      let query = server
        .accounts()
        .forAsset(new Asset(assetCode, issuer))
        .limit(limit)
        .order(order);

      if (cursor) query = query.cursor(cursor);

      const accountsResponse = await query.call();
      const records = accountsResponse.records || [];
      const holders = records.map((account) =>
        formatAssetHolder(account, assetCode, issuer),
      );
      const lastRecord = records[records.length - 1];
      const nextCursor = lastRecord ? lastRecord.paging_token : null;

      return success(res, holders, {
        meta: {
          count: holders.length,
          limit,
          order,
          nextCursor,
          hasMore: holders.length === limit,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /asset/:code/:issuer
 * Returns metadata and statistics for a Stellar asset.
 *
 * @param {string} code   - Asset code (e.g. USDC)
 * @param {string} issuer - Issuer account public key (G...)
 *
 * @example
 * GET /asset/USDC/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
 */
router.get("/:code/:issuer", async (req, res, next) => {
  try {
    const { code, issuer } = req.params;
    validateAssetCode(code);
    validateAccountId(issuer);

    const assetCode = code.toUpperCase();

    const assetsResponse = await server
      .assets()
      .forCode(assetCode)
      .forIssuer(issuer)
      .call();

    if (!assetsResponse.records || assetsResponse.records.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          type: "NotFound",
          message: `Asset ${assetCode} issued by ${issuer} was not found on the Stellar network.`,
        },
      });
    }

    const asset = assetsResponse.records[0];

    // Also fetch issuer account for home_domain
    let issuerInfo = null;
    try {
      const issuerAccount = await server.loadAccount(issuer);
      issuerInfo = {
        homeDomain: issuerAccount.home_domain || null,
        flags: issuerAccount.flags,
        thresholds: issuerAccount.thresholds,
      };
    } catch (_) {
      // Issuer account info is optional
    }

    return success(res, {
      assetCode: asset.asset_code,
      assetIssuer: asset.asset_issuer,
      assetType: asset.asset_type,
      amount: asset.amount,
      numAccounts: asset.num_accounts,
      numClaimableBalances: asset.num_claimable_balances,
      numLiquidityPools: asset.num_liquidity_pools,
      claimableBalancesAmount: asset.claimable_balances_amount,
      liquidityPoolsAmount: asset.liquidity_pools_amount,
      flags: asset.flags,
      issuer: issuerInfo,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /asset/:code/:issuer/supply
 * Returns full supply breakdown for a Stellar asset.
 *
 * Acceptance Criteria:
 * - Returns { totalSupply, circulatingSupply, lockedInPools, lockedInClaimableBalances, holderCount }
 * - circulatingSupply = totalSupply minus locked amounts (lockedInPools + lockedInClaimableBalances)
 * - Returns 404 if asset not found
 *
 * @param {string} code   - Asset code (e.g. USDC)
 * @param {string} issuer - Issuer account public key (G...)
 *
 * @example
 * GET /asset/USDC/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN/supply
 */
router.get("/:code/:issuer/supply", async (req, res, next) => {
  try {
    const { code, issuer } = req.params;
    validateAssetCode(code);
    validateAccountId(issuer);

    const assetCode = code.toUpperCase();

    const assetsResponse = await server
      .assets()
      .forCode(assetCode)
      .forIssuer(issuer)
      .call();

    if (!assetsResponse.records || assetsResponse.records.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          type: "NotFound",
          message: `Asset ${assetCode} issued by ${issuer} was not found on the Stellar network.`,
        },
      });
    }

    const asset = assetsResponse.records[0];

    // In Horizon, 'amount' is the total held by all accounts (trustline balances).
    // 'liquidity_pools_amount' is the total held in liquidity pools.
    // 'claimable_balances_amount' is the total held in claimable balances.
    const amount = parseFloat(asset.amount || "0");
    const lockedInPools = parseFloat(asset.liquidity_pools_amount || "0");
    const lockedInClaimableBalances = parseFloat(asset.claimable_balances_amount || "0");

    // Total Supply includes trustline balances, liquidity pools, and claimable balances.
    const totalSupply = amount + lockedInPools + lockedInClaimableBalances;

    // Circulating Supply is what is currently available in accounts (not locked).
    // According to requirement: circulatingSupply = totalSupply - (lockedInPools + lockedInClaimableBalances)
    // which simplifies to 'amount'.
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
 * Searches for all assets matching a given code (across all issuers).
 *
 * Query params:
 *   - code  (string, required)
 *   - limit (number, default: 10)
 *
 * @example
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
    const limit = Math.min(parseInt(rawLimit) || 10, 50);

    const assetsResponse = await server
      .assets()
      .forCode(assetCode)
      .limit(limit)
      .call();

    const assets = assetsResponse.records.map((a) => ({
      assetCode: a.asset_code,
      assetIssuer: a.asset_issuer,
      assetType: a.asset_type,
      amount: a.amount,
      numAccounts: a.num_accounts,
      flags: a.flags,
    }));

    return success(res, assets, {
      meta: { count: assets.length, query: assetCode },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
