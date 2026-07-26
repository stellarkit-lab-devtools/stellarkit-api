const { StrKey } = require("@stellar/stellar-sdk");

/**
 * Format a query-parameter validation message.
 * e.g. qp("order", 'must be "asc" or "desc".') → "Query param 'order' must be \"asc\" or \"desc\"."
 *
 * @param {string} param - Parameter name
 * @param {string} msg   - Remainder of the message
 * @returns {string}
 */
function qp(param, msg) {
  return `Query param '${param}' ${msg}`;
}

/**
 * Creates a structured InvalidAccountId error.
 * @param {string} accountId
 * @returns {Error}
 */
function makeInvalidAccountIdError(accountId) {
  const err = new Error(
    `"${String(accountId).slice(0, 60)}" is not a valid Stellar account address.`
  );
  err.isInvalidAccountId = true;
  err.accountId = accountId;
  err.suggestion = "Account addresses start with G and are 56 characters long.";
  err.status = 400;
  return err;
}

/**
 * Creates a structured InvalidAsset error.
 * @param {string} message
 * @param {string} suggestion
 * @returns {Error}
 */
function makeInvalidAssetError(message, suggestion) {
  const err = new Error(message);
  err.isInvalidAsset = true;
  err.suggestion = suggestion || null;
  err.status = 400;
  return err;
}

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
  if (typeof accountId !== "string" || !StrKey.isValidEd25519PublicKey(accountId)) {
    throw makeInvalidAccountIdError(accountId);
  }
}

function validateContractId(contractId) {
  if (!contractId) {
    throw makeValidationError(
      "Contract ID is required.",
      "contractId",
      contractId,
      "C... (valid Soroban contract address)"
    );
  }
  if (!StrKey.isValidContract(contractId)) {
    throw makeValidationError(
      `Invalid Soroban contract ID. Must be a valid contract address starting with "C".`,
      "contractId",
      contractId,
      "CCJZ5DGASBWQXR5MPFCJXMBI333XE5U3FSJTNQU7RIKE3P5GN2K2WYD2"
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

/**
 * Validate a numeric limit value and ensure it falls within the allowed range.
 *
 * Throws an error with `isInvalidLimit = true` and the standardised
 * { type: "InvalidLimit", message, suggestion } shape when invalid.
 *
 * @param {number|string} limit - The requested limit value to validate.
 * @param {number} [max=100] - Maximum allowable limit value.
 * @returns {number} The parsed limit as an integer when valid.
 * @throws {Error} Throws an InvalidLimit error when the limit is non-numeric, <= 0, or > max.
 */
function validateLimit(limit, max = 100) {
  const parsed = parseInt(limit, 10);
  if (isNaN(parsed) || parsed < 1 || parsed > max) {
    const err = new Error("limit must be a number between 1 and 100.");
    err.isInvalidLimit = true;
    err.status = 400;
    err.receivedValue = limit !== undefined ? String(limit).slice(0, 50) : undefined;
    throw err;
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
      `Invalid order parameter: "${order}". Valid values are "asc" or "desc".`,
      qp("order", 'must be either "asc" or "desc".'),
      "order",
      order,
      "asc or desc"
    );
  }
  return lowerOrder;
}

module.exports = { validateAccountId, validateContractId, validateAssetCode, validateLimit, validateOrder };
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
