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
    `""${String(accountId).slice(0, 60)}" is not a valid Stellar account address.`
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

/**
 * Validate a Stellar public key in lightweight boolean form.
 *
 * @param {string|null|undefined} address
 * @returns {boolean}
 */
function validateStellarAddress(address) {
  if (typeof address !== "string") return false;
  const trimmed = address.trim();
  if (!trimmed) return false;
  if (!trimmed.startsWith("G")) return false;
  if (trimmed.length !== 56) return false;
  return StrKey.isValidEd25519PublicKey(trimmed);
}

/**
 * Validate a credential type token.
 *
 * Allowed characters: letters, digits, underscore, dash, and dot.
 * Maximum length: 64 characters.
 *
 * @param {string|null|undefined} type
 * @returns {boolean}
 */
function validateCredentialType(type) {
  if (typeof type !== "string") return false;
  const trimmed = type.trim();
  if (!trimmed) return false;
  if (trimmed.length > 64) return false;
  return /^[A-Za-z0-9._-]+$/.test(trimmed);
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
      "Provide a valid asset code (14–12 alphanumeric characters), e.g. USDC."
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
      "Provide the issuer's Stellar public key (a G... address), e.g. GA5ZSEYJB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN."
    );
  }

  if (!StrKey.isValidEd25519PublicKey(issuer)) {
    throw makeInvalidAssetError(
      `Issuer address "${String(issuer).slice(0, 10)}..." is not a valid Stellar public key.`,
      "The issuer must be a valid Ed25519 public key starting with G (56 characters), e.g. GA5ZSEYJB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN."
    );
  }
}

/**
 * Validate a pagination cursor value.
 *
 * A valid cursor is a non-empty string (as returned by Horizon's paging_token
 * field).  Passing null, undefined, an empty string, or a non-string value
 * throws a structured error that the central error handler maps to a 400
 * response with the standardised InvalidCursor shape.
 *
 * Callers that receive `undefined` from `req.query.cursor` should skip this
 * call entirely — the function is only needed when the caller explicitly
 * intends to forward a cursor to Horizon.
 *
 * @param {*} cursor - The cursor value supplied by the API client.
 * @returns {string} The validated cursor string (same value, type-confirmed).
 * @throws {Error} Throws an error with `isInvalidCursor = true` when invalid.
 *
 * @example
 * // In a paginated route:
 * if (req.query.cursor !== undefined) {
 *   validateCursor(req.query.cursor);
 * }
 */
const CURSOR_PATTERN = /^[A-Za-z0-9-]+$/;

function validateCursor(cursor) {
  if (
    cursor === null ||
    cursor === undefined ||
    typeof cursor !== "string" ||
    cursor.trim() === "" ||
    !CURSOR_PATTERN.test(cursor)
  ) {
    const err = new Error("The provided cursor value is invalid.");
    err.isInvalidCursor = true;
    err.type = "InvalidCursor";
    err.suggestion = "Use the cursor returned in the previous response.";
    err.status = 400;
    throw err;
  }
  return cursor;
}

/**
 * Validate and parse an ISO 8601 date string supplied as a query parameter.
 *
 * Accepts any string that JavaScript's Date constructor recognises as a valid
 * date (e.g. "2024-01-15", "2024-01-15T12:00:00Z"). Empty strings and values
 * that produce an invalid Date are rejected with a structured 400 error.
 *
 * @param {string} value - Raw query-parameter value to validate.
 * @param {string} field - Parameter name used in error messages (e.g. "startDate").
 * @returns {Date} A valid Date object.
 * @throws {Error} A validation error (isValidation = true, status = 400) when invalid.
 */
function validateISODate(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw makeValidationError(
      `Query param '${field}' must be a valid ISO 8601 date string (e.g. "2024-01-15" or "2024-01-15T12:00:00Z").`,
      field,
      value,
      "ISO 8601 date string"
    );
  }
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    throw makeValidationError(
      `Query param '${field}' is not a valid date: "${String(value).slice(0, 50)}".`,
      field,
      value,
      "ISO 8601 date string"
    );
  }
  return date;
}

/**
 * Validate a transaction hash.
 *
 * A valid transaction hash is a 64-character hexadecimal string.
 * Throws an error with `isInvalidTransactionHash = true` and the standardised
 * { type: "InvalidTransactionHash", message, suggestion } shape when invalid.
 *
 * @param {string} hash - The transaction hash to validate.
 * @returns {string} The validated hash (same value).
 * @throws {Error} Throws an error with `isInvalidTransactionHash = true` when invalid.
 */
function validateTransactionHash(hash) {
  const isHex64 = typeof hash === "string" && /^[0-9a-fA-F]{64}$/.test(hash);
  if (!isHex64) {
    const err = new Error(`'${hash}' is not a valid transaction hash.`);
    err.isInvalidTransactionHash = true;
    err.type = "InvalidTransactionHash";
    err.suggestion = "Transaction hashes are 64-character hexadecimal strings.";
    err.status = 400;
    throw err;
  }
  return hash;
}

module.exports = {
  validateAccountId,
  validateContractId,
  validateAssetCode,
  validateLimit,
  validateOrder,
  validateAsset,
  validateCursor,
  validateISODate,
  validateStellarAddress,
  validateCredentialType,
  validateTransactionHash,
};
