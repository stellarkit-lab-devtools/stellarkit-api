/**
 * Custom error class for consistent error handling across the StellarKit API.
 *
 * Extends the native Error class with additional fields for HTTP status,
 * machine-readable type, optional detail, and an optional suggestion.
 *
 * @example
 * throw new StellarKitError("Account not found", 404, "NotFound", "The requested Stellar account does not exist.", "Check the public key and try again.");
 */
class StellarKitError extends Error {
  /**
   * @param {string} message - Human-readable error message.
   * @param {number} statusCode - HTTP status code (e.g. 400, 404, 500).
   * @param {string} type - Machine-readable error type (e.g. "ValidationError", "NotFound").
   * @param {string} [detail] - Optional detailed explanation of the error.
   * @param {string} [suggestion] - Optional suggestion for how to resolve the error.
   */
  constructor(message, statusCode, type, detail, suggestion) {
    super(message);
    this.name = "StellarKitError";
    this.statusCode = statusCode;
    this.type = type;
    this.detail = detail || null;
    this.suggestion = suggestion || null;
  }

  /**
   * Serialize the error to a plain object suitable for JSON responses.
   *
   * @returns {{ type: string, message: string, detail?: string, suggestion?: string }}
   */
  toJSON() {
    const obj = {
      type: this.type,
      message: this.message,
    };
    if (this.detail) obj.detail = this.detail;
    if (this.suggestion) obj.suggestion = this.suggestion;
    return obj;
  }
}

module.exports = StellarKitError;
