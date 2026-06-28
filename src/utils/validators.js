const { StrKey } = require("@stellar/stellar-sdk");

function makeValidationError(message, field, receivedValue, expectedFormat) {
  const err = new Error(message);
  err.isValidation = true;
  err.field = field;
  err.receivedValue = receivedValue !== undefined ? String(receivedValue).slice(0, 50) : undefined;
  err.expectedFormat = expectedFormat;
  return err;
}

function makeInvalidAssetError(message, suggestion) {
  const err = new Error(message);
  err.isInvalidAsset = true;
  err.suggestion = suggestion || null;
  return err;
}

function qp(field, details) {
  // Keep a consistent template for query validation errors.
  return `Query parameter '${field}' ${details}`;
}

function validateAccountId(accountId) {
  if (!accountId) {
    throw makeValidationError(
      qp("accountId", "is required."),
      "accountId",
      accountId,
      "G... (valid Ed25519 public key)"
    );
  }
  if (!StrKey.isValidEd25519PublicKey(accountId)) {
    throw makeValidationError(
      qp("accountId", 'must be a valid Ed25519 public key starting with "G".'),
      "accountId",
      accountId,
      "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"
    );
  }
}

function validateAssetCode(code) {
  if (!code) {
    throw makeValidationError(
      qp("assetCode", "is required."),
      "assetCode",
      code,
      "USDC"
    );
  }
  if (!/^[A-Z0-9]{1,12}$/.test(code.toUpperCase())) {
    throw makeValidationError(
      qp("assetCode", "must be 1–12 uppercase alphanumeric characters."),
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
      qp("limit", `must be an integer between 1 and ${max}.`),
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
      qp("order", 'must be either "asc" or "desc".'),
      "order",
      order,
      "asc or desc"
    );
  }
  return lowerOrder;
}

/**
 * Validates a Stellar asset defined by a code and issuer route parameter pair.
 *
 * Checks:
 * - code is present and at most 12 alphanumeric characters
 * - issuer is present and a valid Ed25519 public key (starts with G)
 *
 * Throws an error with `isInvalidAsset = true` and a standardised
 * { type: "InvalidAsset", message, suggestion } shape when invalid.
 *
 * @param {string} code   - Asset code from route params (e.g. USDC)
 * @param {string} issuer - Asset issuer from route params (G... public key)
 */
function validateAsset(code, issuer) {
  if (!code) {
    throw makeInvalidAssetError(
      "Asset code is required.",
      "Provide a valid asset code (1–12 alphanumeric characters), e.g. USDC."
    );
  }

  if (code.length > 12) {
    throw makeInvalidAssetError(
      `Asset code "${code.slice(0, 20)}" is too long (maximum 12 characters).`,
      "Use a Stellar asset code of 1–12 uppercase alphanumeric characters, e.g. USDC or LONGASSET12."
    );
  }

  if (!/^[A-Za-z0-9]{1,12}$/.test(code)) {
    throw makeInvalidAssetError(
      `Asset code "${code.slice(0, 20)}" contains invalid characters. Only alphanumeric characters are allowed.`,
      "Use a Stellar asset code of 1–12 uppercase alphanumeric characters, e.g. USDC."
    );
  }

  if (!issuer) {
    throw makeInvalidAssetError(
      "Asset issuer is required.",
      "Provide the issuer's Stellar public key (a G... address), e.g. GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN."
    );
  }

  if (!StrKey.isValidEd25519PublicKey(issuer)) {
    throw makeInvalidAssetError(
      `Issuer address "${String(issuer).slice(0, 10)}..." is not a valid Stellar public key.`,
      "The issuer must be a valid Ed25519 public key starting with G (56 characters), e.g. GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN."
    );
  }
}

module.exports = { validateAccountId, validateAssetCode, validateLimit, validateOrder, validateAsset };
