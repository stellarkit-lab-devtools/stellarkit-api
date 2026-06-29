/**
 * Centralised error handler middleware.
 * Formats Horizon / Stellar SDK errors into consistent JSON responses.
 * All non-Horizon errors are wrapped in StellarKitError for consistency.
 */
const logger = require("../utils/logger");
const { translateHorizonError } = require("../utils/horizonErrors");
const { mapHorizonErrorToStatus } = require("../utils/horizonStatusMapper");
const StellarKitError = require("../utils/StellarKitError");

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

function errorHandler(err, req, res, next) {
  // Horizon errors returned from horizon-client / Stellar SDK
  if (err && err.response && err.response.data) {
    const horizonError = err.response.data;
    const extras = horizonError.extras !== undefined ? horizonError.extras : null;

    let resultCode = null;
    if (extras && extras.result_codes) {
      if (typeof extras.result_codes.transaction === "string") {
        resultCode = extras.result_codes.transaction;
      } else if (
        Array.isArray(extras.result_codes.operations) &&
        extras.result_codes.operations.length > 0
      ) {
        resultCode = extras.result_codes.operations[0];
      }
    }

    const mappedStatus = mapHorizonErrorToStatus(resultCode);
    const httpStatus = mappedStatus ?? err.response.status ?? 400;

    const body = {
      success: false,
      error: {
        type: "HorizonError",
        title: horizonError.title || "Horizon Error",
        detail: horizonError.detail || "An error occurred with the Stellar network.",
        status: err.response.status,
        extras,
      },
    };

    if (resultCode) {
      body.error.code = resultCode;
      const humanMessage = translateHorizonError(resultCode);
      if (humanMessage && typeof humanMessage === "string" && humanMessage.length > 0) {
        body.error.message = humanMessage;
      }
    }

    logError(httpStatus, req, horizonError.detail || horizonError.title || "Horizon Error");
    return res.status(httpStatus).json(body);
  }

  // StellarKitError instances — already structured
  if (err instanceof StellarKitError) {
    logError(err.statusCode, req, err.message);
    return res.status(err.statusCode).json({
      success: false,
      error: err.toJSON(),
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
