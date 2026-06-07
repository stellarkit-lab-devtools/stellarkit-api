/**
 * Centralised error handler middleware.
 * Formats Horizon / Stellar SDK errors into consistent JSON responses.
 */

const { mapHorizonErrorToStatus } = require("../utils/horizonStatusMapper");

/**
 * Logs 4xx and 5xx responses to the console.
 * Suppressed when NODE_ENV=test to keep test output clean.
 *
 * @param {number} status - HTTP status code
 * @param {import('express').Request} req - Express request object
 * @param {string} message - Human-readable error message
 */
function logError(status, req, message) {
  if (process.env.NODE_ENV === "test") return;
  if (status >= 400) {
    const label = status >= 500 ? "ERROR" : "WARN";
    console.error(
      `[${label}] ${req.method} ${req.path} → ${status} | ${message}`
    );
  }
}

function errorHandler(err, req, res, next) {
  // Stellar / Horizon specific errors
  if (err.response && err.response.data) {
    const horizonError = err.response.data;

    const resultCode =
      horizonError?.extras?.result_codes?.transaction ??
      horizonError?.extras?.result_codes?.operations?.[0] ??
      null;

    const mappedStatus = mapHorizonErrorToStatus(resultCode);
    const status = mappedStatus ?? err.response.status ?? 400;

    const message = horizonError.detail || horizonError.title || "Horizon Error";
    logError(status, req, message);
    return res.status(status).json({
      success: false,
      error: {
        type: "HorizonError",
        title: horizonError.title || "Horizon Error",
        detail: horizonError.detail || "An error occurred with the Stellar network.",
        status: horizonError.status || err.response.status,
        extras: horizonError.extras || null,
      },
    });
  }

  // Payload too large errors from body parsers
  if (err.type === "entity.too.large" || err.status === 413) {
    const maxBodySize = process.env.MAX_BODY_SIZE || "10kb";
    const message = `Payload too large. Maximum request body size is ${maxBodySize}.`;
    logError(413, req, message);
    return res.status(413).json({
      success: false,
      error: {
        type: "PayloadTooLargeError",
        message,
      },
    });
  }

  // Validation errors (thrown manually)
  if (err.isValidation) {
    logError(400, req, err.message);
    return res.status(400).json({
      success: false,
      error: {
        type: "ValidationError",
        message: err.message,
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
  logError(status, req, err.message);
  return res.status(status).json({
    success: false,
    error: {
      type: "ServerError",
      message,
    },
  });
}

module.exports = errorHandler;
