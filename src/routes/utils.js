const express = require("express");
const axios = require("axios");
const router = express.Router();
const { success } = require("../utils/response");
const { validateAccountId } = require("../utils/validators");
const { Transaction, Networks, Keypair } = require("@stellar/stellar-sdk");
const { server } = require("../config/stellar");

const FRIENDBOT_URL = "https://friendbot.stellar.org";
const STROOPS_PER_XLM = 10000000n;
const AVERAGE_LEDGER_CLOSE_SECONDS = 5;
const { decodeMemo } = require("../utils/memo");

function createValidationError(message) {
  const err = new Error(message);
  err.statusCode = 400;
  err.isValidation = true;
  return err;
}

function parseXlmToStroops(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw createValidationError("Query parameter 'xlm' must be a non-negative number.");
  }

  if (value.startsWith("-")) {
    throw createValidationError("Query parameter 'xlm' cannot be negative.");
  }

  if (!/^\d+(?:\.\d{1,7})?$/.test(value)) {
    throw createValidationError(
      "Query parameter 'xlm' must be a decimal with no more than 7 fractional digits."
    );
  }

  const [whole, fractional = ""] = value.split(".");
  const stroops =
    BigInt(whole) * STROOPS_PER_XLM +
    BigInt(fractional.padEnd(7, "0"));

  if (stroops > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw createValidationError("Converted stroop value exceeds the safe integer range.");
  }

  return Number(stroops);
}

function parseStroops(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw createValidationError("Query parameter 'stroops' must be a non-negative integer.");
  }

  if (value.startsWith("-")) {
    throw createValidationError("Query parameter 'stroops' cannot be negative.");
  }

  if (!/^\d+$/.test(value)) {
    throw createValidationError("Query parameter 'stroops' must be an integer.");
  }

  const stroops = BigInt(value);
  if (stroops > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw createValidationError("Query parameter 'stroops' exceeds the safe integer range.");
  }

  return Number(stroops);
}

function formatStroopsToXlm(stroops) {
  const stroopValue = BigInt(stroops);
  const whole = stroopValue / STROOPS_PER_XLM;
  const fractional = (stroopValue % STROOPS_PER_XLM).toString().padStart(7, "0");
  return `${whole}.${fractional}`;
}

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
  }
});

/**
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
 * GET /utils/convert?xlm={amount}
 * GET /utils/convert?stroops={amount}
 * Convert between XLM and stroops without hitting Horizon.
 */
router.get("/convert", (req, res, next) => {
  try {
    const { xlm, stroops } = req.query;
    const hasXlm = xlm !== undefined;
    const hasStroops = stroops !== undefined;

    if (hasXlm && hasStroops) {
      throw createValidationError("Provide only one of 'xlm' or 'stroops', not both.");
    }

    if (!hasXlm && !hasStroops) {
      throw createValidationError("Provide either 'xlm' or 'stroops' query param.");
    }

    if (hasXlm) {
      const convertedStroops = parseXlmToStroops(xlm);
      return success(res, {
        xlm: formatStroopsToXlm(convertedStroops),
        stroops: convertedStroops,
      });
    }

    const convertedStroops = parseStroops(stroops);
    return success(res, {
      xlm: formatStroopsToXlm(convertedStroops),
      stroops: convertedStroops,
    });
  } catch (err) {
    next(err);
  }
});

function parseLedgerSequence(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw createValidationError("Query parameter 'sequence' is required and must be a positive integer.");
  }

  if (!/^\d+$/.test(value)) {
    throw createValidationError("Query parameter 'sequence' must be a positive integer.");
  }

  const sequence = Number(value);
  if (sequence <= 0 || !Number.isSafeInteger(sequence)) {
    throw createValidationError("Query parameter 'sequence' must be a positive integer.");
  }

  return sequence;
}

/**
 * GET /utils/ledger-date?sequence={sequence}
 * Estimate the approximate date and time a Stellar ledger sequence was closed.
 */
router.get("/ledger-date", async (req, res, next) => {
  try {
    const sequence = parseLedgerSequence(req.query.sequence);
    const latestResponse = await server.ledgers().order("desc").limit(1).call();
    const latestLedger = latestResponse.records && latestResponse.records[0];

    if (!latestLedger || !latestLedger.closed_at || !latestLedger.sequence) {
      throw new Error("Unable to determine the latest ledger from Horizon.");
    }

    const latestSequence = Number(latestLedger.sequence);
    const latestClosedAt = new Date(latestLedger.closed_at);
    const sequenceDelta = latestSequence - sequence;
    const estimatedDate = new Date(
      latestClosedAt.getTime() - sequenceDelta * AVERAGE_LEDGER_CLOSE_SECONDS * 1000,
    );

    return success(res, {
      sequence,
      estimatedDate: estimatedDate.toISOString(),
      note: "This date is an approximation based on an average Stellar ledger close time of ~5 seconds.",
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

/**
 * GET /utils/validate-account?id=GAAZI4...
 * Validate whether a string is a valid Stellar Ed25519 public key (account ID).
 * No Horizon call is made — validation is purely local via StrKey.
 *
 * @param {string} id - The string to validate.
 *
 * @returns {{ input, isValid, reason }} isValid is true when the key is valid;
 *   reason is null for valid keys and a human-readable explanation for invalid ones.
 *
 * @example
 * GET /utils/validate-account?id=GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
 */
router.get("/validate-account", (req, res, next) => {
  try {
    const { id } = req.query;

    if (!id || id.trim() === "") {
      const err = new Error("Query parameter 'id' is required.");
      err.statusCode = 400;
      err.isValidation = true;
      throw err;
    }

    const { StrKey } = require("@stellar/stellar-sdk");

    let isValid = true;
    let reason = null;

    if (!id.startsWith("G")) {
      isValid = false;
      reason = "Invalid prefix: Stellar public keys must start with 'G'.";
    } else if (id.length !== 56) {
      isValid = false;
      reason = `Invalid length: expected 56 characters, got ${id.length}.`;
    } else if (!/^[A-Z2-7]+$/.test(id)) {
      isValid = false;
      reason = "Invalid characters: Stellar public keys use base32 encoding (A–Z and 2–7 only).";
    } else if (!StrKey.isValidEd25519PublicKey(id)) {
      // Catches checksum failures and any other structural issues
      isValid = false;
      reason = "Invalid key: checksum verification failed.";
    }

    return success(res, { input: id, isValid, reason });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /utils/decode-xdr
 * Decode a base64-encoded Stellar transaction XDR envelope into JSON.
 *
 * @param {string} xdr - The base64-encoded transaction XDR envelope.
 *
 * @example
 * POST /utils/decode-xdr
 * { "xdr": "AAAAAgAAAAD..." }
 */
router.post("/decode-xdr", (req, res, next) => {
  try {
    const { xdr } = req.body;

    if (!xdr) {
      const err = new Error("XDR string is required in the request body.");
      err.statusCode = 400;
      err.isValidation = true;
      throw err;
    }

    let tx;
    try {
      // We use TESTNET as default network for decoding, but since we are not 
      // submitting, the network passphrase only affects the hash calculation.
      const networkPassphrase = process.env.STELLAR_NETWORK === "mainnet" 
        ? Networks.PUBLIC 
        : Networks.TESTNET;
      
      tx = new Transaction(xdr, networkPassphrase);
    } catch (e) {
      const err = new Error(`Invalid or malformed XDR: ${e.message}`);
      err.statusCode = 400;
      err.isValidation = true;
      throw err;
    }

    const decoded = {
      sourceAccount: tx.source,
      fee: tx.fee,
      sequenceNumber: tx.sequence,
      memo: tx.memo.value ? {
        type: tx.memo.type,
        value: tx.memo.value.toString()
      } : null,
      timeBounds: tx.timebounds ? {
        minTime: tx.timebounds.minTime,
        maxTime: tx.timebounds.maxTime
      } : null,
      operations: tx.operations.map((op) => {
        // The SDK operations are already fairly clean, but we ensure 
        // they are plain JSON objects.
        const formattedOp = { ...op };
        
        // Remove internal SDK properties if any (usually starting with _)
        Object.keys(formattedOp).forEach(key => {
          if (key.startsWith("_")) delete formattedOp[key];
        });

        return formattedOp;
      })
    };

    return success(res, decoded);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /utils/keypair
 * Generates a new random Stellar keypair for testnet use.
 * Only available when STELLAR_NETWORK=testnet.
 *
 * @returns {{ publicKey, secretKey, warning }}
 * @throws {Error} 403 if not on testnet
 */
router.get("/keypair", (req, res, next) => {
  try {
    const network = process.env.STELLAR_NETWORK || "testnet";
    if (network !== "testnet") {
      const err = new Error("Keypair generation is only available on testnet.");
      err.statusCode = 403;
      throw err;
    }

    const keypair = Keypair.random();
    return success(res, {
      publicKey: keypair.publicKey(),
      secretKey: keypair.secret(),
      warning: "Never share your secret key",
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
