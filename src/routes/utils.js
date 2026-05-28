const express = require("express");
const axios = require("axios");
const router = express.Router();
const { success } = require("../utils/response");
const { validateAccountId } = require("../utils/validators");

const FRIENDBOT_URL = "https://friendbot.stellar.org";

/**
 * GET /utils/friendbot/:accountId
 * Calls Stellar Friendbot to fund a testnet account with 10,000 XLM.
 * Only available on testnet.
 *
 * @param {string} accountId - Stellar account public key (G...)
 *
 * @returns {Object} Success response with accountId and confirmation message
 * @throws {Error} 403 if not on testnet
 * @throws {Error} 400 if accountId is invalid
 * @throws {Error} 400 if Friendbot returns an error
 *
 * @example
 * GET /utils/friendbot/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
 */
router.get("/friendbot/:accountId", async (req, res, next) => {
  try {
    const { accountId } = req.params;

    // Validate account ID format
    validateAccountId(accountId);

    // Check if running on testnet
    const network = process.env.STELLAR_NETWORK || "testnet";
    if (network !== "testnet") {
      const err = new Error(
        "Friendbot is only available on testnet. Current network: " + network
      );
      err.statusCode = 403;
      throw err;
    }

    // Call Friendbot
    const response = await axios.get(FRIENDBOT_URL, {
      params: { addr: accountId },
      timeout: 10000, // 10 second timeout
    });

    // Friendbot returns transaction details on success
    return success(res, {
      accountId,
      message: "Account funded with 10,000 XLM on testnet",
      transaction: response.data,
    });
  } catch (err) {
    // Handle Friendbot-specific errors from axios
    if (err.response && err.response.data) {
      const friendbotError = err.response.data;
      const message = friendbotError.detail || friendbotError.message || "Friendbot error";
      const customErr = new Error(message);
      customErr.statusCode = err.response.status || 400;
      return next(customErr);
    }

    // Pass other errors to global handler
    next(err);
  }
});

module.exports = router;
