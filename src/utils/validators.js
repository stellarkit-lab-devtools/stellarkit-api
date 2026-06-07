const { StrKey } = require("@stellar/stellar-sdk");

function makeValidationError(message, field, receivedValue, expectedFormat) {
  const err = new Error(message);
  err.isValidation = true;
  err.field = field;
  err.receivedValue = receivedValue !== undefined ? String(receivedValue).slice(0, 50) : undefined;
  err.expectedFormat = expectedFormat;
  return err;
}

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
