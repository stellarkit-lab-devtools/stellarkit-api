const express = require("express");
const router = express.Router();
const { server } = require("../config/stellar");
const { success } = require("../utils/response");
const { validateAccountId, validateAssetCode } = require("../utils/validators");

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

/**
 * Handler to fetch metadata and statistics for a specific Stellar asset.
 *
 * @async
 * @function
 * @param {import("express").Request} req - Express request object
 * @param {Object} req.params - Route parameters
 * @param {string} req.params.code - Asset code (e.g. USDC)
 * @param {string} req.params.issuer - Issuer account public key (G...)
 * @param {import("express").Response} res - Express response object
 * @param {import("express").NextFunction} next - Express next middleware function
 *
 * @returns {Promise<void>} Sends a JSON response with the following structure:
 * {
 *   assetCode: string,
 *   assetIssuer: string,
 *   assetType: string,
 *   amount: string,
 *   numAccounts: number,
 *   numClaimableBalances: number,
 *   numLiquidityPools: number,
 *   claimableBalancesAmount: string,
 *   liquidityPoolsAmount: string,
 *   flags: Object,
 *   issuer: {
 *     homeDomain: string | null,
 *     flags: Object,
 *     thresholds: Object
 *   } | null
 * }
 *
 * @throws Will pass validation or network errors to the next middleware
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

/**
 * Handler to search for Stellar assets by code across all issuers.
 *
 * @async
 * @function
 * @param {import("express").Request} req - Express request object
 * @param {Object} req.query - Query parameters
 * @param {string} req.query.code - Asset code to search (required)
 * @param {string|number} [req.query.limit=10] - Maximum number of results (capped at 50)
 * @param {import("express").Response} res - Express response object
 * @param {import("express").NextFunction} next - Express next middleware function
 *
 * @returns {Promise<void>} Sends a JSON response with the following structure:
 * {
 *   data: Array<{
 *     assetCode: string,
 *     assetIssuer: string,
 *     assetType: string,
 *     amount: string,
 *     numAccounts: number,
 *     flags: Object
 *   }>,
 *   meta: {
 *     count: number,
 *     query: string
 *   }
 * }
 *
 * @throws Will throw a validation error if 'code' is missing or invalid
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
