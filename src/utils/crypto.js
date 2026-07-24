/**
 * Cryptographic proof utilities for the StellarKit API.
 *
 * These functions are used to generate and verify deterministic proof hashes
 * for API security features (e.g. request signing, nonce verification).
 *
 * Uses Node.js built-in `crypto` — no external dependencies required.
 */

const crypto = require("crypto");

/**
 * Generate a SHA-256 proof hash from an input string and a salt.
 *
 * The salt is prepended to the input before hashing so that the same input
 * with different salts always produces different hashes.  This prevents
 * rainbow-table attacks and ensures each proof is unique.
 *
 * @param {string} input - The value to hash (e.g. an account ID, nonce).
 * @param {string} salt  - A per-proof random or context-derived salt.
 * @returns {string} A 64-character lowercase hex string (SHA-256 digest).
 */
function generateProofHash(input, salt) {
  return crypto
    .createHash("sha256")
    .update(`${salt}:${input}`)
    .digest("hex");
}

/**
 * Verify that a candidate hash matches the expected proof hash for a given
 * input and salt combination.
 *
 * Uses a timing-safe comparison to prevent timing-based side-channel attacks.
 *
 * @param {string} input     - The original input value used when generating the hash.
 * @param {string} salt      - The salt used when generating the hash.
 * @param {string} candidate - The hash to verify.
 * @returns {boolean} `true` when the candidate matches the expected hash, `false` otherwise.
 */
function verifyProofHash(input, salt, candidate) {
  const expected = generateProofHash(input, salt);
  if (expected.length !== candidate.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(candidate, "hex"),
  );
}

module.exports = { generateProofHash, verifyProofHash };
