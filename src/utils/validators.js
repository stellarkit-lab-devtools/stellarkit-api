const { StrKey } = require("@stellar/stellar-sdk");

/**
 * Create a structured validation error for invalid input.
 *
 * @param {string} message - Human-readable error message.
 * @param {string} field - Name of the field that failed validation.
 * @param {*} receivedValue - Value supplied by the caller.
 * @param {string} expectedFormat - Expected format description for the field.
 * @returns {Error} A validation error with metadata for API error handling.
 * @throws {Error} Always throws an Error instance populated with validation metadata.
 */
function makeValidationError(message, field, receivedValue, expectedFormat) {
  const err = new Error(message);
  err.isValidation = true;
  err.field = field;
  err.receivedValue = receivedValue !== undefined ? String(receivedValue).slice(0, 50) : undefined;
  err.expectedFormat = expectedFormat;
  return err;
}

/**
 * Validate a Stellar account ID and ensure it is a valid Ed25519 public key.
 *
 * @param {string} accountId - The Stellar public key to validate.
 * @returns {void} Returns nothing when validation succeeds.
 * @throws {Error} Throws a validation error when the account ID is missing or invalid.
 */
function validateAccountId(accountId) {
  if (!accountId) {
    throw makeValidationError(
      "Account ID is required.",
      "accountId",
      accountId,
      "G... (valid Ed25519 public key)"
    );
  }
  if (!StrKey.isValidEd25519PublicKey(accountId)) {
    throw makeValidationError(
      `Invalid Stellar account ID. Must be a valid Ed25519 public key starting with "G".`,
      "accountId",
      accountId,
      "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"
    );
  }
}

/**
 * Validate an asset code and ensure it matches the expected Stellar format.
 *
 * @param {string} code - The asset code to validate.
 * @returns {void} Returns nothing when validation succeeds.
 * @throws {Error} Throws a validation error when the asset code is missing or invalid.
 */
function validateAssetCode(code) {
  if (!code) {
    throw makeValidationError(
      "Asset code is required.",
      "assetCode",
      code,
      "USDC"
    );
  }
  if (!/^[A-Z0-9]{1,12}$/.test(code.toUpperCase())) {
    throw makeValidationError(
      `Invalid asset code. Must be 1–12 uppercase alphanumeric characters.`,
      "assetCode",
      code,
      "USDC"
    );
  }
}

/**
 * Validate a numeric limit value and ensure it falls within the allowed range.
 *
 * @param {number|string} limit - The requested limit value to validate.
 * @param {number} [max=200] - Maximum allowable limit value.
 * @returns {number} The parsed limit as an integer when valid.
 * @throws {Error} Throws a validation error when the limit is missing, non-numeric, or out of range.
 */
function validateLimit(limit, max = 200) {
  const parsed = parseInt(limit);
  if (isNaN(parsed) || parsed < 1 || parsed > max) {
    throw makeValidationError(
      `Limit must be a number between 1 and ${max}.`,
      "limit",
      limit,
      `1–${max}`
    );
  }
  return parsed;
}

/**
 * Validate an ordering parameter and normalize it to the supported values.
 *
 * @param {string} [order] - The requested sort direction.
 * @returns {string} The normalized order value, either "asc" or "desc".
 * @throws {Error} Throws a validation error when the order value is unsupported.
 */
function validateOrder(order) {
  if (!order) return "desc";
  const lowerOrder = String(order).toLowerCase();
  if (!["asc", "desc"].includes(lowerOrder)) {
    throw makeValidationError(
      `Invalid order parameter. Valid values are "asc" or "desc".`,
      "order",
      order,
      "asc or desc"
    );
  }
  return lowerOrder;
}

module.exports = { validateAccountId, validateAssetCode, validateLimit, validateOrder };
