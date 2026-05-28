const express = require("express");
const axios = require("axios");
const router = express.Router();
const { success } = require("../utils/response");
const { validateAccountId } = require("../utils/validators");

const FRIENDBOT_URL = "https://friendbot.stellar.org";
const { decodeMemo } = require("../utils/memo");

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

/**
 * GET /utils/memo?type={type}&value={value}
 * Decode a raw Horizon memo into a human-friendly representation.
 */
router.get("/memo", (req, res, next) => {
  try {
    const { type, value } = req.query;
    const result = decodeMemo(type, value);
    return success(res, result);
  } catch (err) {
    if (!err.isValidation) {
      // Unexpected error - forward to global handler
      return next(err);
    }
    err.isValidation = true;
    return next(err);
 * GET /utils/base64
 * Encode or decode a string using Base64.
 *
 * @example
 * GET /utils/base64?encode=Hello
 * GET /utils/base64?decode=SGVsbG8=
 */
router.get("/base64", (req, res, next) => {
  try {
    const { encode, decode } = req.query;
    const hasEncode = typeof encode === "string";
    const hasDecode = typeof decode === "string";

    if (hasEncode && hasDecode) {
      const err = new Error("Provide only one of 'encode' or 'decode', not both");
      err.statusCode = 400;
      err.isValidation = true;
      throw err;
    }

    if (!hasEncode && !hasDecode) {
      const err = new Error("Provide either 'encode' or 'decode' query param");
      err.statusCode = 400;
      err.isValidation = true;
      throw err;
    }

    if (hasEncode) {
      return success(res, {
        input: encode,
        encoded: Buffer.from(encode, "utf8").toString("base64"),
        mode: "encode",
      });
    }

    const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/;
    if (!base64Pattern.test(decode) || decode.length % 4 !== 0) {
      const err = new Error("Invalid base64 string");
      err.statusCode = 400;
      err.isValidation = true;
      throw err;
    }

    return success(res, {
      input: decode,
      decoded: Buffer.from(decode, "base64").toString("utf8"),
      mode: "decode",
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /utils/validate-asset?code={code}
 * Validate whether a given string is a valid Stellar asset code.
 *
 * @example
 * GET /utils/validate-asset?code=USDC
 */
router.get("/validate-asset", (req, res, next) => {
  try {
    const { code } = req.query;
    if (code === undefined || code === null || code === "") {
      const err = new Error("Query parameter 'code' is required.");
      err.statusCode = 400;
      err.isValidation = true;
      throw err;
    }

    const input = code;
    let isValid = true;
    let assetType = null;
    let reason = null;

    const upperCode = code.toUpperCase();

    if (upperCode === "XLM") {
      assetType = "native";
    } else if (code.length >= 1 && code.length <= 4) {
      assetType = "credit_alphanum4";
    } else if (code.length >= 5 && code.length <= 12) {
      assetType = "credit_alphanum12";
    } else if (code.length > 12) {
      isValid = false;
      reason = "Asset code is too long (maximum 12 characters).";
    } else {
      // Empty code check
      isValid = false;
      reason = "Asset code cannot be empty.";
    }

    if (isValid && assetType !== "native") {
      const alphanumericPattern = /^[A-Za-z0-9]+$/;
      if (!alphanumericPattern.test(code)) {
        isValid = false;
        reason = "Asset code contains invalid characters. Only alphanumeric characters are allowed.";
      }
    }

    return success(res, {
      input,
      isValid,
      assetType,
      reason,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

