const crypto = require("crypto");

const MAX_REQUEST_ID_LENGTH = 100;
const INVALID_CHARS_PATTERN = /[\r\n\0\x00-\x1f\x7f-\x9f]/;
const VALID_REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function generateRequestId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

/**
 * Validates whether an incoming request ID is safe to use.
 * Rejects values containing newlines, null bytes, non-printable characters,
 * disallowed characters (only alphanumeric, hyphens, and underscores are allowed),
 * or values exceeding the maximum length limit.
 *
 * @param {any} id - The incoming ID value to validate
 * @returns {boolean} True if valid, false otherwise
 */
function isValidRequestId(id) {
  if (typeof id !== "string") {
    return false;
  }

  if (INVALID_CHARS_PATTERN.test(id)) {
    return false;
  }

  const trimmed = id.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_REQUEST_ID_LENGTH) {
    return false;
  }

  return VALID_REQUEST_ID_PATTERN.test(trimmed);
}

function requestIdMiddleware(req, res, next) {
  const incomingId =
    (typeof req.get === "function" ? req.get("x-request-id") : null) ||
    (req.headers ? req.headers["x-request-id"] : null);

  const requestId = isValidRequestId(incomingId)
    ? incomingId.trim()
    : generateRequestId();

  req.requestId = requestId;
  if (typeof res.setHeader === "function") {
    res.setHeader("X-Request-ID", requestId);
  }
  next();
}

module.exports = requestIdMiddleware;
module.exports.generateRequestId = generateRequestId;
module.exports.isValidRequestId = isValidRequestId;
module.exports.MAX_REQUEST_ID_LENGTH = MAX_REQUEST_ID_LENGTH;
module.exports.VALID_REQUEST_ID_PATTERN = VALID_REQUEST_ID_PATTERN;

