/**
 * Custom error class for StellarKit API errors.
 * Provides consistent type identity for error handling.
 */
class StellarKitError extends Error {
  /**
   * @param {string} message - Human-readable error message
   * @param {number} status - HTTP status code
   * @param {string} type - Error type (NOT_FOUND, INVALID_REQUEST, etc)
   * @param {object} [details] - Optional extra context
   */
  constructor(message, status, type, details = null) {
    super(message);
    this.name = 'StellarKitError';
    this.status = status;
    this.type = type;
    this.details = details;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, StellarKitError);
    }
  }

  static notFound(message = 'Resource not found') {
    return new StellarKitError(message, 404, 'NOT_FOUND');
  }

  static invalidRequest(message = 'Invalid request', details = null) {
    return new StellarKitError(message, 400, 'INVALID_REQUEST', details);
  }

  static upstreamError(message = 'Horizon API error', details = null) {
    return new StellarKitError(message, 502, 'UPSTREAM_ERROR', details);
  }

  static rateLimited(message = 'Too many requests') {
    return new StellarKitError(message, 429, 'RATE_LIMITED');
  }

  toJSON() {
    return { message: this.message, type: this.type, status: this.status, details: this.details };
  }
}

module.exports = StellarKitError;
