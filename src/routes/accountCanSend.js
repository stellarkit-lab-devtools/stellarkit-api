/**
 * GET /account/:id/can-send/:assetCode/:assetIssuer
 *
 * Checks whether an account can send a specified asset by verifying:
 *   1. The account has a trustline for the asset
 *   2. The available balance (balance - selling_liabilities) is > 0
 *   3. The account is authorized to send (for auth-required assets)
 *
 * Returns: { success: true, data: { canSend, reason } }
 *   reason is null when canSend is true.
 *   Possible reasons: "no_trustline", "insufficient_balance", "not_authorized"
 */

const express = require("express");
const router = express.Router({ mergeParams: true });
const { server } = require("../config/stellar");
const { success } = require("../utils/response");
const { makeAccountNotFoundError } = require("../utils/errors");

/**
 * Parse and validate asset code from URL parameter.
 * Stellar asset codes are 1-12 alphanumeric characters.
 */
function isValidAssetCode(code) {
  return /^[a-zA-Z0-9]{1,12}$/.test(code);
}

/**
 * Parse and validate Stellar account ID (G address).
 */
function isValidStellarAddress(address) {
  return /^G[A-Z0-9]{55}$/.test(address);
}

/**
 * GET /account/:id/can-send/:assetCode/:assetIssuer
 */
router.get("/account/:id/can-send/:assetCode/:assetIssuer", async (req, res, next) => {
  try {
    const { id, assetCode, assetIssuer } = req.params;

    // ── Validate parameters ────────────────────────────────────────────────
    if (!isValidStellarAddress(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid account ID format",
        code: "INVALID_ACCOUNT_ID",
      });
    }

    if (!isValidAssetCode(assetCode)) {
      return res.status(400).json({
        success: false,
        error: "Invalid asset code format (must be 1-12 alphanumeric characters)",
        code: "INVALID_ASSET_CODE",
      });
    }

    if (!isValidStellarAddress(assetIssuer)) {
      return res.status(400).json({
        success: false,
        error: "Invalid asset issuer address format",
        code: "INVALID_ASSET_ISSUER",
      });
    }

    // ── Fetch account from Horizon ─────────────────────────────────────────
    let account;
    try {
      account = await server.loadAccount(id);
    } catch (err) {
      if (err.response && err.response.status === 404) {
        return makeAccountNotFoundError(res, id);
      }
      throw err;
    }

    // ── Check for trustline ────────────────────────────────────────────────
    const balances = account.balances || [];
    const trustline = balances.find((b) => {
      return (
        b.asset_type !== "native" &&
        b.asset_code === assetCode &&
        b.asset_issuer === assetIssuer
      );
    });

    if (!trustline) {
      return success(res, {
        canSend: false,
        reason: "no_trustline",
      });
    }

    // ── Check authorization (for auth-required assets) ────────────────────
    // When an asset has AUTH_REQUIRED_FLAG set, the trustline has
    // `is_authorized` and `is_authorized_to_maintain_liabilities` flags.
    // If the account is not authorized to send, return early.
    if (trustline.is_authorized === false && trustline.is_authorized_to_maintain_liabilities === false) {
      return success(res, {
        canSend: false,
        reason: "not_authorized",
      });
    }

    // ── Check available balance (balance - selling_liabilities) ────────────
    const balance = parseFloat(trustline.balance || "0");
    const sellingLiabilities = parseFloat(trustline.selling_liabilities || "0");
    const availableBalance = balance - sellingLiabilities;

    if (availableBalance <= 0) {
      return success(res, {
        canSend: false,
        reason: "insufficient_balance",
      });
    }

    // ── All checks passed ──────────────────────────────────────────────────
    return success(res, {
      canSend: true,
      reason: null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
