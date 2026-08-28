/**
 * Centralised error handler middleware.
 * Formats Horizon / Stellar SDK errors into consistent JSON responses.
 * All non-Horizon errors are wrapped in StellaKitError for consistency.
 */
const logger = require("../utils/logger");
const { translateHorizonError } = require("../utils/horizonErrors");
const { mapHorizonErrorToStatus } = require("../utils/horizonStatusMapper");
const StellaKitError = require("../utils/StellaKitError");
const {
  HORIZON_TIMEOUT_MESSAGE,
  HORIZON_TIMEOUT_SUGGESTION,
  isHorizonTimeoutError,
} = require("../utils/errors");
const { NETWORK } = require("../config/stellar");
const metrics = require("../services/metrics");

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

/**
 * Send an error response AND record the status code in the metrics service.
 *
 * @param {import('express').Response} res
 * @param {number} status
 * @param {object} body
 */
function errorResponse(res, status, body) {
  metrics.incrementError(status);
  return res.status(status).json(body);
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
  return (horizonError &&
    horizonError.type &&
    typeof horizonError.type === "string" &&
    horizonError.type.includes("transaction_failed")
  );
}

/**
 * Returns true when err is a network-level connection failure to Horizon.
 */
function isConnectionError(err) {
  if (!err) return false;
  const code = err.code || (err.cause && err.cause.code);
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ECONNRESET") return true;
  const msg = (err.message || "").toLowerCase();
  return msg.includes("econnrefused") || msg.includes("enotfound");
}

/**
 * Returns true when a Horizon 404 is for an offer endpoint
 * (e.g. GET /offers/123 returned Not Found).
 */
function isOfferNotFoundError(err) {
  if (!err || !err.response) return false;
  const { status, config } = err.response;
  if (status !== 404) return false;
  const url = (config && config.url) || "";
  return url.includes("/offers/");
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

/**
 * Injects requestId from the request into the response body.
 */
function withRequestId(body, req) {
  return { ...body, requestId: req.requestId || null };
}

function errorHandler(err, req, res, next) {
  if (isConnectionError(err)) {
    const ske = new StellaKitError(
      "Unable to connect to the Stellar Horizon node.",
      503,
      "HorizonUnavailable",
      null,
      "Check your HORIZON_URL and verify the node is reachable. See https://status.stellar.org for network status."
    );
    logError(503, req, ske.message);
    return errorResponse(res, 503, withRequestId({
      success: false,
      error: ske.toJSON(),
    }, req));
  }

  if (err?.isOfferNotFound || isOfferNotFoundError(err)) {
    const offerId = err?.offerId || "unknown";
    const message = `Offer '${offerId}' was not found on the Stellar ${NETWORK} network.`;
    const ske = new StellaKitError(
      message,
      404,
      "OfferNotFound",
      null,
      "The offer may have already been filled, cancelled, or the offer ID may be incorrect."
    );
    logError(404, req, ske.message);
    return errorResponse(res, 404, withRequestId({
      success: false,
      error: ske.toJSON(),
    }, req));
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
      return errorResponse(res, status, withRequestId(body, req));
    }

    const mappedStatus = mapHorizonErrorToStatus(resultCode);
    const status = mappedStatus ?? err.response.status ?? 400;

    if (isTransactionSubmissionFailure(horizonError)) {
      const body = buildTransactionSubmissionFailedError horizonError);
      logError(status, req, body.message);
      return errorResponse(res, status, withRequestId({ success: false, error: body }, req));
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

    return errorResponse(res, status, withRequestId(body, req));
  }

  // StellaKitError instances — already structured
  if (err instanceof StellaKitError) {
    logError(err.statusCode, req, err.message);
    return errorResponse(res, err.statusCode, withRequestId({
      success: false,
      error: err.toJSON(),
    }, req));
  }
  // ReferenceError and TypeError — catch runtime exceptions
  if (err instanceof ReferenceError || err instanceof TypeError) {
    logError(500, req, err.message);
    return errorResponse(res, 500, withRequestId({
      success: false,
      error: {
        type: "InternalError",
        title: "Internal Server Error",
        detail: process.env.NODE_ENV === "production"
          ? "An unexpected error occurred."
          : err.message,
      },
    }, req));
  }
  // Payload too large errors from body parsers
  if (err.type === "entity.too.large" || err.status === 413) {
    const maxBodySize = process.env.MAX_BODY_SIZE || "10kb";
    const ske = new StellaKitError(
      `Payload too large. Maximum request body size is ${maxBodySize}.`,
      413,
      "PayloadTooLargeError",
      null,
      `Reduce your request body size to under ${maxBodySize}.`
    );
    logError(413, req, ske.message);
    return errorResponse(res, 413, withRequestId({
      success: false,
      error: ske.toJSON(),
    }, req));
  }

// AccountNotFound errors (Horizon 404 on account lookup)
  // TransactionNotFound errors (Horizon 404 on transaction lookup)
  if (err.isTransactionNotFound) {
    logError(404, req, err.message);
    return errorResponse(res, 404, withRequestId({
      success: false,
      error: {
        type: "NotFound",
        message: err.message,
        suggestion: "Verify the transaction hash is correct and exists on the network.",
      },
    }, req));
  }

  // AccountNotFound errors (Horizon 404 on account lookup)
  if (err.isAccountNotFound) {
    logError(404, req, err.message);
    return errorResponse(res, 404, withRequestId({
      success: false,
      error: {
        type: "AccountNotFound",
        message: err.message,
        suggestion:
          "Verify the account address is correct and that the account has been funded.",
      },
    }, req));
  }

  // AssetNotFound errors (asset lookup returned no results)
  if (err.isAssetNotFound) {
    logError(404, req, err.message);
    return errorResponse(res, 404, withRequestId({
      success: false,
      error: {
        type: "AssetNotFound",
        message: err.message,
        suggestion:
          "Verify the asset code and issuer address are correct.",
      },
    }, req));
  }

  // TrustlineNotFound errors — specific asset trustline missing on an account
  if (err.isTrustlineNotFound) {
    logError(404, req, err.message);
    return errorResponse(res, 404, withRequestId({
      success: false,
      error: {
        type: "TrustlineNotFound",
        message: err.message,
        suggestion:
          "The account must establish a trustline before holding this asset.",
      },
    }, req));
  }

  // TomlFetchFailed errors — issuer's stellar.toml could not be fetched
  // (network error, missing file, or invalid format)
  if (err.isTomlFetchFailed) {
    logError(502, req, err.message);
    return errorResponse(res, 502, withRequestId({
      success: false,
      error: {
        type: "TomlFetchFailed",
        message: err.message,
        suggestion:
          "Verify the issuer has a valid stellar.toml at their home domain. See https://developers.stellar.org/docs/issuing-assets/publishing-asset-info for requirements.",
      },
    }, req));
  }

  // InvalidAccountId errors — thrown by validateAccountId(id)
  if (err.isInvalidAccountId) {
    logError(400, req, err.message);
    return errorResponse(res, 400, withRequestId({
      success: false,
      error: {
        type: "InvalidAccountId",
        message: err.message,
        suggestion: err.suggestion,
      },
    }, req));
  }

  // InvalidTransactionHash errors — thrown by validateTransactionHash(hash)
  if (err.isInvalidTransactionHash) {
    logError(400, req, err.message);
    return errorResponse(res, 400, withRequestId({
      success: false,
      error: {
        type: "InvalidTransactionHash",
        message: err.message,
        suggestion: err.suggestion,
      },
    }, req));
  }

  // Fallback for any other error
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal Server Error";
  logError(status, req, message);
  return errorResponse(res, status, withRequestId({
    success: false,
    error: {
      type: err.type || "InternalError",
      message,
    },
  }, req));
}

// Export the middleware
module.exports = errorHandler;