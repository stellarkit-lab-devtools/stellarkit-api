"use strict";

const { Keypair } = require("@stellar/stellar-sdk");
const {
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
} = require("../../src/utils/validators");

const VALID_G = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

describe("validateStellarAddress", () => {
  it("returns true for a valid G address", () => {
    expect(validateStellarAddress(VALID_G)).toBe(true);
  });

  it("returns true for a valid G address with surrounding whitespace", () => {
    expect(validateStellarAddress(`  ${VALID_G}  `)).toBe(true);
  });

  it("returns false for wrong prefix", () => {
    expect(validateStellarAddress("SA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN")).toBe(false);
  });

  it("returns false for wrong length", () => {
    expect(validateStellarAddress("GABC")).toBe(false);
    expect(validateStellarAddress(`${VALID_G}X`)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(validateStellarAddress("")).toBe(false);
    expect(validateStellarAddress("   ")).toBe(false);
  });

  it("returns false for null", () => {
    expect(validateStellarAddress(null)).toBe(false);
  });

  it("returns false for undefined and non-string values", () => {
    expect(validateStellarAddress(undefined)).toBe(false);
    expect(validateStellarAddress(123)).toBe(false);
    expect(validateStellarAddress({})).toBe(false);
  });

  it("returns false for invalid checksum G address of correct length", () => {
    expect(validateStellarAddress("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toBe(false);
  });
});

describe("validateCredentialType", () => {
  it("returns true for a valid type", () => {
    expect(validateCredentialType("kyc")).toBe(true);
    expect(validateCredentialType("KYC_LEVEL-1.v2")).toBe(true);
  });

  it("returns false for type with spaces", () => {
    expect(validateCredentialType("kyc level")).toBe(false);
    expect(validateCredentialType("  ")).toBe(false);
  });

  it("returns false for type over 64 chars", () => {
    expect(validateCredentialType("a".repeat(65))).toBe(false);
  });

  it("returns true for type of exactly 64 chars", () => {
    expect(validateCredentialType("a".repeat(64))).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(validateCredentialType("")).toBe(false);
  });

  it("returns false for null and non-string values", () => {
    expect(validateCredentialType(null)).toBe(false);
    expect(validateCredentialType(undefined)).toBe(false);
    expect(validateCredentialType(42)).toBe(false);
  });

  it("returns false for types with disallowed characters", () => {
    expect(validateCredentialType("kyc@home")).toBe(false);
    expect(validateCredentialType("kyc/level")).toBe(false);
  });
});

describe("validateAccountId", () => {
  it("does not throw for a valid Ed25519 public key", () => {
    expect(() => validateAccountId(VALID_G)).not.toThrow();
  });

  it("throws for invalid account IDs", () => {
    expect(() => validateAccountId("not-valid")).toThrow();
    expect(() => validateAccountId(null)).toThrow();
  });
});

describe("validateContractId", () => {
  it("throws when contract ID is missing", () => {
    expect(() => validateContractId("")).toThrow(/Contract ID is required/);
    expect(() => validateContractId(null)).toThrow(/Contract ID is required/);
  });

  it("throws when contract ID is not a valid C address", () => {
    expect(() => validateContractId(VALID_G)).toThrow(/Invalid Soroban contract ID/);
  });

  it("does not throw for a valid contract ID", () => {
    // Generate a structurally valid contract ID via StrKey when possible;
    // fall back to asserting the error shape for clearly invalid input above.
    const { StrKey } = require("@stellar/stellar-sdk");
    const buf = Buffer.alloc(32, 7);
    const contractId = StrKey.encodeContract(buf);
    expect(() => validateContractId(contractId)).not.toThrow();
  });
});

describe("validateAssetCode", () => {
  it("accepts valid asset codes", () => {
    expect(() => validateAssetCode("USDC")).not.toThrow();
    expect(() => validateAssetCode("LONGTOKEN12")).not.toThrow();
  });

  it("throws when code is missing", () => {
    expect(() => validateAssetCode("")).toThrow(/assetCode/);
    expect(() => validateAssetCode(null)).toThrow(/assetCode/);
  });

  it("throws when code has invalid characters or length", () => {
    expect(() => validateAssetCode("BAD CODE")).toThrow(/assetCode/);
    expect(() => validateAssetCode("TOOLONGASSETX")).toThrow(/assetCode/);
  });
});

describe("validateLimit", () => {
  it("returns parsed limit when valid", () => {
    expect(validateLimit(10)).toBe(10);
    expect(validateLimit("25", 50)).toBe(25);
  });

  it("throws InvalidLimit for out-of-range values", () => {
    expect(() => validateLimit(0)).toThrow();
    expect(() => validateLimit(101)).toThrow();
    expect(() => validateLimit("abc")).toThrow();
  });
});

describe("validateOrder", () => {
  it("defaults to desc when order is omitted", () => {
    expect(validateOrder()).toBe("desc");
    expect(validateOrder("")).toBe("desc");
  });

  it("normalizes asc and desc", () => {
    expect(validateOrder("ASC")).toBe("asc");
    expect(validateOrder("desc")).toBe("desc");
  });

  it("throws for unsupported order values", () => {
    expect(() => validateOrder("sideways")).toThrow();
  });
});

describe("validateAsset", () => {
  it("accepts a valid code/issuer pair", () => {
    expect(() => validateAsset("USDC", VALID_G)).not.toThrow();
  });

  it("throws when code is missing", () => {
    expect(() => validateAsset("", VALID_G)).toThrow(/Asset code is required/);
  });

  it("throws when code is too long", () => {
    expect(() => validateAsset("TOOLONGASSETX", VALID_G)).toThrow(/too long/);
  });

  it("throws when code has invalid characters", () => {
    expect(() => validateAsset("US-DC", VALID_G)).toThrow(/invalid characters/);
  });

  it("throws when issuer is missing", () => {
    expect(() => validateAsset("USDC", "")).toThrow(/Asset issuer is required/);
  });

  it("throws when issuer is invalid", () => {
    expect(() => validateAsset("USDC", "not-a-key")).toThrow(/not a valid Stellar public key/);
  });
});

describe("validateCursor", () => {
  it("returns a valid cursor string", () => {
    expect(validateCursor("12345")).toBe("12345");
  });

  it("throws for null, undefined, empty, or non-string cursors", () => {
    expect(() => validateCursor(null)).toThrow();
    expect(() => validateCursor(undefined)).toThrow();
    expect(() => validateCursor("")).toThrow();
    expect(() => validateCursor("   ")).toThrow();
    expect(() => validateCursor(42)).toThrow();
  });
});

describe("validateISODate", () => {
  it("parses valid ISO 8601 dates", () => {
    const d = validateISODate("2024-01-15", "startDate");
    expect(d).toBeInstanceOf(Date);
    expect(d.getUTCFullYear()).toBe(2024);
  });

  it("throws for empty or non-string values", () => {
    expect(() => validateISODate("", "startDate")).toThrow(/ISO 8601/);
    expect(() => validateISODate(null, "startDate")).toThrow(/ISO 8601/);
  });

  it("throws for unparseable date strings", () => {
    expect(() => validateISODate("not-a-date", "startDate")).toThrow(/not a valid date/);
  });
});

describe("validateStellarAddress — random keypair", () => {
  it("accepts a freshly generated public key", () => {
    const pk = Keypair.random().publicKey();
    expect(validateStellarAddress(pk)).toBe(true);
  });
});
