const express = require("express");
const router = express.Router();
const { server } = require("../config/stellar");
const { success } = require("../utils/response");
const { validateAccountId } = require("../utils/validators");

/**
 * GET /account/:id
 * Returns full account details including XLM balance, all asset balances,
 * signers, thresholds, flags, and sequence number.
 *
 * @param {string} id - Stellar account public key (G...)
 *
 * @example
 * GET /account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
 */

/**
 * Handler to fetch and format a Stellar account's full details.
 *
 * @async
 * @function
 * @param {import("express").Request} req - Express request object
 * @param {Object} req.params - Route parameters
 * @param {string} req.params.id - Stellar account public key (G...)
 * @param {import("express").Response} res - Express response object
 * @param {import("express").NextFunction} next - Express next middleware function
 *
 * @returns {Promise<void>} Sends a JSON response with the following structure:
 * {
 *   accountId: string,
 *   sequence: string,
 *   subentryCount: number,
 *   xlm: {
 *     balance: string,
 *     buyingLiabilities: string,
 *     sellingLiabilities: string,
 *     minimumBalance: string,
 *     spendableBalance: string
 *   },
 *   assets: Array<{
 *     assetCode: string,
 *     assetIssuer: string,
 *     assetType: string,
 *     balance: string,
 *     limit: string,
 *     buyingLiabilities: string,
 *     sellingLiabilities: string,
 *     isAuthorized: boolean,
 *     isClawbackEnabled: boolean
 *   }>,
 *   assetCount: number,
 *   signers: Array<{
 *     key: string,
 *     type: string,
 *     weight: number
 *   }>,
 *   thresholds: Object,
 *   flags: Object,
 *   homeDomain: string | null,
 *   lastModifiedLedger: number
 * }
 *
 * @throws Will pass any error to the next middleware
 */
router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);

    const account = await server.loadAccount(id);

    // Separate native XLM from other assets
    const xlmBalance = account.balances.find((b) => b.asset_type === "native");
    const tokenBalances = account.balances
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

    // Minimum balance calculation
    // Min balance = (2 + subentries) * base_reserve
    // We use 0.5 XLM as the current base reserve
    const baseReserve = 0.5;
    const minBalance = (2 + account.subentry_count) * baseReserve;

    return success(res, {
      accountId: account.id,
      sequence: account.sequence,
      subentryCount: account.subentry_count,
      xlm: {
        balance: xlmBalance ? xlmBalance.balance : "0.0000000",
        buyingLiabilities: xlmBalance ? xlmBalance.buying_liabilities : "0",
        sellingLiabilities: xlmBalance ? xlmBalance.selling_liabilities : "0",
        minimumBalance: minBalance.toFixed(7),
        spendableBalance: xlmBalance
          ? Math.max(0, parseFloat(xlmBalance.balance) - minBalance).toFixed(7)
          : "0.0000000",
      },
      assets: tokenBalances,
      assetCount: tokenBalances.length,
      signers: account.signers.map((s) => ({
        key: s.key,
        type: s.type,
        weight: s.weight,
      })),
      thresholds: account.thresholds,
      flags: account.flags,
      homeDomain: account.home_domain || null,
      lastModifiedLedger: account.last_modified_ledger,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
