/**
 * Tests for src/utils/crypto.js
 *
 * Covers:
 *   1. generateProofHash returns a 64-character hex string.
 *   2. The same input with different salts produces different hashes.
 *   3. verifyProofHash returns true for a matching hash.
 *   4. verifyProofHash returns false for a non-matching hash.
 *
 * These tests have no external service dependencies and run fully in-process.
 */

const { generateProofHash, verifyProofHash } = require("../../src/utils/crypto");

describe("generateProofHash", () => {
  it("returns a 64-character hex string", () => {
    const hash = generateProofHash("stellarkit-input", "some-salt");

    expect(typeof hash).toBe("string");
    expect(hash).toHaveLength(64);
    // Must be a valid lowercase hex string
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the same input with different salts produces different hashes", () => {
    const input = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
    const hash1 = generateProofHash(input, "salt-alpha");
    const hash2 = generateProofHash(input, "salt-beta");

    expect(hash1).not.toBe(hash2);
  });

  it("produces the same hash for identical input and salt", () => {
    const input = "deterministic-value";
    const salt = "fixed-salt";
    const hash1 = generateProofHash(input, salt);
    const hash2 = generateProofHash(input, salt);

    expect(hash1).toBe(hash2);
  });
});

describe("verifyProofHash", () => {
  it("returns true for a hash that matches the input and salt", () => {
    const input = "account-nonce-12345";
    const salt = "session-salt-xyz";
    const hash = generateProofHash(input, salt);

    expect(verifyProofHash(input, salt, hash)).toBe(true);
  });

  it("returns false for a hash that does not match (wrong input)", () => {
    const salt = "session-salt-xyz";
    const hash = generateProofHash("correct-input", salt);

    expect(verifyProofHash("tampered-input", salt, hash)).toBe(false);
  });

  it("returns false for a hash that does not match (wrong salt)", () => {
    const input = "account-nonce-12345";
    const hash = generateProofHash(input, "original-salt");

    expect(verifyProofHash(input, "different-salt", hash)).toBe(false);
  });

  it("returns false for an entirely fabricated candidate hash", () => {
    const input = "real-input";
    const salt = "real-salt";
    const fakeHash = "0".repeat(64);

    expect(verifyProofHash(input, salt, fakeHash)).toBe(false);
  });
});
