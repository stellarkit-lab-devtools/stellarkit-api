/**
 * Memo decoding and validation utilities for Stellar memos.
 */
const TEXT_MEMO_MAX_BYTES = 28;
const HASH_MEMO_BYTES = 32;
const UINT64_MAX = 18446744073709551615n;
const VALID_MEMO_TYPES = ["none", "text", "id", "hash", "return"];

function invalidMemo(type, value, error, byteLength = null) {
  return {
    valid: false,
    type,
    value: value === undefined ? null : value,
    byteLength,
    error,
  };
}

function decodeBase64ToUtf8(value) {
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch (e) {
    throw new Error("Invalid base64 value for text memo");
  }
}

function decodeBase64ToHex(value) {
  try {
    return Buffer.from(value, "base64").toString("hex");
  } catch (e) {
    throw new Error("Invalid base64 value for hash/return memo");
  }
}

/**
 * Decode a raw memo value for the given Stellar memo type.
 *
 * @param {string} type - one of: none, text, id, hash, return
 * @param {string|undefined} value - raw memo value as returned by Horizon (usually base64 for text/hash/return, decimal string for id)
 * @returns {{type:string, raw: string|null, decoded: string|null, description: string}}
 */
function decodeMemo(type, value) {
  if (!type) {
    const err = new Error("Missing memo type");
    err.isValidation = true;
    throw err;
  }

  const t = String(type).toLowerCase();

  const descriptions = {
    none: "No memo attached to the transaction.",
    text: "Plain text memo",
    id: "Unsigned 64-bit integer memo used for references",
    hash: "32-byte hash memo (hex) commonly used for transaction references",
    return: "32-byte hash memo (hex) used as a return address",
  };

  if (!Object.prototype.hasOwnProperty.call(descriptions, t)) {
    const err = new Error(`Unsupported memo type: ${type}`);
    err.isValidation = true;
    throw err;
  }

  if (t === "none") {
    return { type: "none", raw: null, decoded: null, description: descriptions.none };
  }

  if (t === "text") {
    if (typeof value !== "string") {
      const err = new Error("Missing memo value for text type");
      err.isValidation = true;
      throw err;
    }
    const decoded = decodeBase64ToUtf8(value);
    return { type: "text", raw: value, decoded, description: descriptions.text };
  }

  if (t === "id") {
    if (typeof value !== "string") {
      const err = new Error("Missing memo value for id type");
      err.isValidation = true;
      throw err;
    }
    // Ensure it's a decimal string (unsigned 64-bit). We keep as string to avoid precision loss.
    if (!/^[0-9]+$/.test(value)) {
      const err = new Error("Invalid id memo value; expected unsigned integer string");
      err.isValidation = true;
      throw err;
    }
    return { type: "id", raw: value, decoded: value, description: descriptions.id };
  }

  // hash or return - Horizon provides base64; present hex to developers
  if (t === "hash" || t === "return") {
    if (typeof value !== "string") {
      const err = new Error(`Missing memo value for ${t} type`);
      err.isValidation = true;
      throw err;
    }
    const decoded = decodeBase64ToHex(value);
    return { type: t, raw: value, decoded, description: descriptions[t] };
  }

  // Should not reach here
  const err = new Error(`Unsupported memo type: ${type}`);
  err.isValidation = true;
  throw err;
}

/**
 * Validate a memo value against its declared Stellar memo type, without
 * touching Horizon.
 *
 * Stellar memo rules enforced here:
 *   - `none`   — no value may be attached.
 *   - `text`   — UTF-8, at most 28 bytes.
 *   - `id`     — decimal string that fits in an unsigned 64-bit integer.
 *   - `hash`   — exactly 32 bytes, given as 64 hex characters or base64.
 *   - `return` — same encoding and length rules as `hash`.
 *
 * @param {string} type - one of: none, text, id, hash, return
 * @param {string} [value] - the memo value to validate
 * @returns {{valid:boolean, type:string, value:string|null, byteLength:number|null, error:string|null}}
 * @throws {Error} when no type is supplied (flagged with `isValidation`)
 */
function validateMemo(type, value) {
  if (type === undefined || type === null || String(type).trim() === "") {
    const err = new Error("Missing memo type");
    err.statusCode = 400;
    err.isValidation = true;
    throw err;
  }

  const t = String(type).toLowerCase();

  if (!VALID_MEMO_TYPES.includes(t)) {
    return invalidMemo(t, value, `Unsupported memo type: ${type}`);
  }

  if (t === "none") {
    if (value !== undefined && value !== null && value !== "") {
      return invalidMemo(t, value, "A 'none' memo must not carry a value");
    }
    return { valid: true, type: "none", value: null, byteLength: 0, error: null };
  }

  if (t === "text") {
    if (typeof value !== "string" || value === "") {
      return invalidMemo(t, value, "Missing memo value for text type");
    }
    const byteLength = Buffer.byteLength(value, "utf8");
    if (byteLength > TEXT_MEMO_MAX_BYTES) {
      return invalidMemo(
        t,
        value,
        `Text memo must not exceed ${TEXT_MEMO_MAX_BYTES} bytes (got ${byteLength})`,
        byteLength
      );
    }
    return { valid: true, type: "text", value, byteLength, error: null };
  }

  if (t === "id") {
    if (typeof value !== "string" || value === "") {
      return invalidMemo(t, value, "Missing memo value for id type");
    }
    if (!/^[0-9]+$/.test(value)) {
      return invalidMemo(t, value, "ID memo must be an unsigned integer string");
    }
    if (BigInt(value) > UINT64_MAX) {
      return invalidMemo(t, value, "ID memo must fit in an unsigned 64-bit integer");
    }
    return { valid: true, type: "id", value, byteLength: null, error: null };
  }

  // hash / return
  if (typeof value !== "string" || value === "") {
    return invalidMemo(t, value, `Missing memo value for ${t} type`);
  }

  let bytes;
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    bytes = Buffer.from(value, "hex");
  } else if (/^[A-Za-z0-9+/]*={0,2}$/.test(value) && value.length % 4 === 0) {
    bytes = Buffer.from(value, "base64");
  } else {
    return invalidMemo(
      t,
      value,
      "Memo value must be a 64-character hex string or a valid base64 string"
    );
  }

  if (bytes.length !== HASH_MEMO_BYTES) {
    return invalidMemo(
      t,
      value,
      `Hash memo must be exactly ${HASH_MEMO_BYTES} bytes (got ${bytes.length})`,
      bytes.length
    );
  }

  return { valid: true, type: t, value, byteLength: bytes.length, error: null };
}

module.exports = { decodeMemo, validateMemo, TEXT_MEMO_MAX_BYTES, HASH_MEMO_BYTES };
