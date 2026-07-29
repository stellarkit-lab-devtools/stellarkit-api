/**
 * Centralised error handler middleware.
 * Formats Horizon / Stellar SDK errors into consistent JSON responses.
 * All non-Horizon errors are wrapped in StellarKitError for consistency.
 */
const logger = require("../utils/logger");
const { translateHorizonError } = require("../utils/horizonErrors");
const { mapHorizonErrorToStatus } = require("../utils/horizonStatusMapper");
const StellarKitError = require("../utils/StellarKitError");
const {
  HORIZON_TIMEOUT_MESSAGE,
  HORIZON_TIMEOUT_SUGGESTION,
  isHorizonTimeoutError,
} = require("../utils/errors");

/**
 * Logs 4xx and 5xx responses using the structured logger.
 * Suppressed when NODE_ENV=test to keep test output clean.
 *
 * @param {number} status - HTTP status code
 * @param {import('express').Request} req - Express request object
 * @param {string} message - Human-readable error message
 */
function logError(status, req, message) {
  if (process.env.NODE_ENV === "test") return;
  if (status >= 400) {
    const requestId = req.requestId || "-";
    const logLevel = status >= 500 ? "error" : "warn";
    logger[logLevel](
      {
        requestId,
        method: req.method,
        path: req.path,
        status,
      },
      message
    );
  }
}

const ACCOUNT_MERGE_FAILURES = {
  op_does_not_exist: {
    message: "Account merge failed because the destination account does not exist.",
    suggestion:
      "Use an existing funded destination account (G...) before retrying the merge.",
  },
  op_malformed: {
    message: "Account merge failed because the operation payload is malformed.",
    suggestion:
      "Check source/destination values and rebuild the transaction with a valid accountMerge operation.",
  },
  op_dest_full: {
    message: "Account merge failed because the destination account cannot accept additional reserves or entries.",
    suggestion:
      "Free capacity on the destination account (remove subentries or use a different destination) and try again.",
  },
};

function isMergePath(pathname) {
  if (!pathname || typeof pathname !== "string") return false;
  return pathname.toLowerCase().includes("merge");
}

/**
 * Picks the most specific result code from Horizon's extras.result_codes.
 * Prefers the transaction code, falling back to the first operation code.
 */
function pickMostSpecificResultCode(result_codes) {
  if (!result_codes) return null;
  if (typeof result_codes.transaction === "string") {
    return result_codes.transaction;
  }
  if (Array.isArray(result_codes.operations) && result_codes.operations.length > 0) {
    return result_codes.operations[0];
  }
  return null;
}

/**
 * Returns true if the Horizon error is a transaction submission failure
 * (i.e. the network accepted the request but the transaction itself failed).
 */
function isTransactionSubmissionFailure(horizonError) {
  return (
    horizonError &&
    horizonError.type &&
    typeof horizonError.type === "string" &&
    horizonError.type.includes("transaction_failed")
  );
}

/**
 * Builds a normalised error body for a transaction submission failure.
 */
function buildTransactionSubmissionFailedError(horizonError) {
  const resultCodes = horizonError.extras && horizonError.extras.result_codes
    ? horizonError.extras.result_codes
    : {};
  const resultCode = pickMostSpecificResultCode(resultCodes);
  const humanMessage = resultCode ? translateHorizonError(resultCode) : null;

  return {
    type: "TransactionSubmissionFailed",
    title: horizonError.title || "Transaction Failed",
    detail: horizonError.detail || "The transaction was rejected by the Stellar network.",
    message: humanMessage || horizonError.detail || "The transaction was rejected by the Stellar network.",
    resultCodes,
    ...(resultCode ? { code: resultCode } : {}),
  };
}

function errorHandler(err, req, res, next) {
  if (isConnectionError(err)) {
    const ske = new StellarKitError(
      "Unable to connect to the Stellar Horizon node.",
      503,
      "HorizonUnavailable",
      null,
      "Check your HORIZON_URL and verify the node is reachable. See https://status.stellar.org for network status."
    );
    logError(503, req, ske.message);
    return res.status(503).json({
      success: false,
      error: ske.toJSON(),
    });
  }

  if (err?.isOfferNotFound || isOfferNotFoundError(err)) {
    const offerId = err?.offerId || "unknown";
    const message = `Offer '${offerId}' was not found on the Stellar ${NETWORK} network.`;
    const ske = new StellarKitError(
      message,
      404,
      "OfferNotFound",
      null,
      "The offer may have already been filled, cancelled, or the offer ID may be incorrect."
    );
    logError(404, req, ske.message);
    return res.status(404).json({
      success: false,
      error: ske.toJSON(),
    });
  }

  // Horizon errors returned from horizon-client / Stellar SDK
  if (err && err.response && err.response.data) {
    const horizonError = err.response.data;
    const extras = horizonError.extras !== undefined ? horizonError.extras : null;

    const resultCode = pickMostSpecificResultCode(horizonError?.extras?.result_codes);

    // Handle op_low_reserve as a specific InsufficientReserve error
    if (resultCode === "op_low_reserve") {
      const status = mapHorizonErrorToStatus(resultCode) ?? 422;
      const body = {
        success: false,
        error: {
          type: "InsufficientReserve",
          message: "Account does not have enough XLM to cover the minimum reserve requirement.",
          suggestion: "Fund the account with additional XLM. Each account requires a base reserve of 1 XLM plus 0.5 XLM per subentry.",
        },
      };
      logError(status, req, body.error.message);
      return res.status(status).json(body);
    }

    const mappedStatus = mapHorizonErrorToStatus(resultCode);
    const status = mappedStatus ?? err.response.status ?? 400;

    if (isTransactionSubmissionFailure(horizonError)) {
      const body = buildTransactionSubmissionFailedError(horizonError);
      logError(status, req, body.message);
      return res.status(status).json({ success: false, error: body });
    }

    const message = horizonError.detail || horizonError.title || "Horizon Error";
    const code = resultCode;
    const humanMessage = code ? translateHorizonError(code) : null;
    logError(status, req, message);

    const body = {
      success: false,
      error: {
        type: "HorizonError",
        title: horizonError.title || "Horizon Error",
        detail: message,
        status: err.response.status,
        extras,
      },
    };

    if (code) {
      body.error.code = code;
      if (humanMessage && typeof humanMessage === "string" && humanMessage.length > 0) {
        body.error.message = humanMessage;
      }
    }

    return res.status(status).json(body);
  }

  // StellarKitError instances — already structured
  if (err instanceof StellarKitError) {
    logError(err.statusCode, req, err.message);
    return res.status(err.statusCode).json({
      success: false,
      error: err.toJSON(),
    });
  }
  // ReferenceError and TypeError — catch runtime exceptions
  if (err instanceof ReferenceError || err instanceof TypeError) {
    logError(500, req, err.message);
    return res.status(500).json({
      success: false,
      error: {
        type: "InternalError",
        title: "Internal Server Error",
        detail: process.env.NODE_ENV === "production"
          ? "An unexpected error occurred."
          : err.message,
      },
    });
  }
  // Payload too large errors from body parsers
  if (err.type === "entity.too.large" || err.status === 413) {
    const maxBodySize = process.env.MAX_BODY_SIZE || "10kb";
    const ske = new StellarKitError(
      `Payload too large. Maximum request body size is ${maxBodySize}.`,
      413,
      "PayloadTooLargeError",
      null,
      `Reduce your request body size to under ${maxBodySize}.`
    );
    logError(413, req, ske.message);
    return res.status(413).json({
      success: false,
      error: ske.toJSON(),
    });
  }

// AccountNotFound errors (Horizon 404 on account lookup)
  // TransactionNotFound errors (Horizon 404 on transaction lookup)
  if (err.isTransactionNotFound) {
    logError(404, req, err.message);
    return res.status(404).json({
      success: false,
      error: {
        type: "NotFound",
        message: err.message,
        suggestion: "Verify the transaction hash is correct and exists on the network.",
      },
    });
  }

  // AccountNotFound errors (Horizon 404 on account lookup)
  if (err.isAccountNotFound) {
    logError(404, req, err.message);
    return res.status(404).json({
      success: false,
      error: {
        type: "AccountNotFound",
        message: err.message,
        suggestion:
          "Verify the account address is correct and that the account has been funded.",
      },
    });
  }

  // AssetNotFound errors (asset lookup returned no results)
  if (err.isAssetNotFound) {
    logError(404, req, err.message);
    return res.status(404).json({
      success: false,
      error: {
        type: "AssetNotFound",
        message: err.message,
        suggestion:
          "Verify the asset code and issuer address are correct.",
      },
    });
  }

  // InvalidAccountId errors — thrown by validateAccountId(id)
  if (err.isInvalidAccountId) {
    logError(400, req, err.message);
    return res.status(400).json({
      success: false,
      error: {
        type: "InvalidAccountId",
        message: err.message,
        suggestion:
          err.suggestion ||
          "Account addresses start with G and are 56 characters long.",
      },
    });
  }

  // InvalidAsset errors — thrown by validateAsset(code, issuer)
  if (err.isInvalidAsset) {
    logError(400, req, err.message);
    return res.status(400).json({
      success: false,
      error: {
        type: "InvalidAsset",
        message: err.message,
        suggestion: err.suggestion || null,
      },
    });
  }

  // InvalidLimit errors — thrown by validateLimit()
  if (err.isInvalidLimit) {
    logError(400, req, err.message);
    return res.status(400).json({
      success: false,
      error: {
        type: "InvalidLimit",
        message: "limit must be a number between 1 and 100.",
        suggestion: "Provide a valid integer for the limit parameter, e.g. ?limit=20",
      },
    });
  }

  // Horizon timeout errors (Horizon node did not respond in time)
  if (isHorizonTimeoutError(err)) {
    logError(504, req, HORIZON_TIMEOUT_MESSAGE);
    return res.status(504).json({
      success: false,
      error: {
        type: "HorizonTimeout",
        message: HORIZON_TIMEOUT_MESSAGE,
        suggestion: HORIZON_TIMEOUT_SUGGESTION,
      },
    });
  }

  // Transaction not found errors
  if (err.isTransactionNotFound) {
    logError(404, req, err.message);
    return res.status(404).json({
      success: false,
      error: {
        type: "NotFound",
        message: err.message,
        suggestion: "Verify the transaction hash is correct.",
      },
    });
  }

  // Offer not found errors
  if (err.isOfferNotFound) {
    logError(404, req, err.message);
    return res.status(404).json({
      success: false,
      error: {
        type: "OfferNotFound",
        message: err.message,
        suggestion: err.suggestion,
      },
    });
  }

  // Validation errors (thrown manually)
  if (err.isValidation) {
    const ske = new StellarKitError(
      err.message,
      400,
      "ValidationError",
      null,
      err.expectedFormat ? `Expected format: ${err.expectedFormat}` : null
    );
    logError(400, req, err.message);
    return res.status(400).json({
      success: false,
      error: {
        ...ske.toJSON(),
        field: err.field,
        receivedValue: err.receivedValue,
        expectedFormat: err.expectedFormat,
      },
    });
  }

  // Generic errors
  const status = err.status || err.statusCode || 500;
  const message =
    process.env.NODE_ENV === "production"
      ? "An unexpected error occurred."
      : err.message;
  const skeGeneric = new StellarKitError(message, status, "ServerError");
  logError(status, req, err.message);
  return res.status(status).json({
    success: false,
    error: skeGeneric.toJSON(),
  });
}

module.exports = errorHandler;
