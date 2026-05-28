const { StrKey } = require("@stellar/stellar-sdk");

/**
 * Validate a Stellar account ID.
 *
 * @param {string} accountId - The Stellar account ID to validate.
 * @throws {Error} If the account ID is missing or invalid.
 */
function validateAccountId(accountId) {
  if (!accountId) {
    const err = new Error("Account ID is required.");
    err.isValidation = true;
    throw err;
  }
  if (!StrKey.isValidEd25519PublicKey(accountId)) {
    const err = new Error(
      `Invalid Stellar account ID: "${accountId}". Must be a valid Ed25519 public key starting with "G".`,
    );
    err.isValidation = true;
    throw err;
  }
}

/**
 * Validate an asset code.
 *
 * @param {string} code - The asset code to validate.
 * @throws {Error} If the asset code is missing or invalid.
 */
function validateAssetCode(code) {
  if (!code) {
    const err = new Error("Asset code is required.");
    err.isValidation = true;
    throw err;
  }
  if (!/^[A-Z0-9]{1,12}$/.test(code.toUpperCase())) {
    const err = new Error(
      `Invalid asset code: "${code}". Must be 1–12 uppercase alphanumeric characters.`,
    );
    err.isValidation = true;
    throw err;
  }
}

/**
 * Validate a numeric limit and return it as an integer.
 *
 * @param {number|string} limit - The limit value to validate.
 * @param {number} [max=200] - The maximum allowed limit.
 * @returns {number} The parsed limit value.
 * @throws {Error} If the limit is not a number or is out of range.
 */
function validateLimit(limit, max = 200) {
  const parsed = parseInt(limit);
  if (isNaN(parsed) || parsed < 1 || parsed > max) {
    const err = new Error(`Limit must be a number between 1 and ${max}.`);
    err.isValidation = true;
    throw err;
  }
  return parsed;
}

/**
 * Validate the order query parameter.
 *
 * @param {string} order - The order value to validate ("asc" or "desc").
 * @returns {string} The validated order value.
 * @throws {Error} If the order is not "asc" or "desc".
 */
function validateOrder(order) {
  if (!order) {
    // order is optional, default to "desc"
    return "desc";
  }

  const lowerOrder = String(order).toLowerCase();
  if (!["asc", "desc"].includes(lowerOrder)) {
    const err = new Error(
      `Invalid order parameter: "${order}". Valid values are "asc" or "desc".`
    );
    err.isValidation = true;
    throw err;
  }
  return lowerOrder;
}

module.exports = { validateAccountId, validateAssetCode, validateLimit, validateOrder };
