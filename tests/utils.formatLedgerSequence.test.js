const { formatLedgerSequence } = require("../src/utils/formatLedgerSequence");

describe("formatLedgerSequence", () => {
  describe("valid inputs", () => {
    it("should convert string sequence to integer", () => {
      expect(formatLedgerSequence("12345678")).toBe(12345678);
    });

    it("should pass through integer sequence unchanged", () => {
      expect(formatLedgerSequence(12345678)).toBe(12345678);
    });

    it("should handle zero", () => {
      expect(formatLedgerSequence(0)).toBe(0);
      expect(formatLedgerSequence("0")).toBe(0);
    });

    it("should floor decimal numbers", () => {
      expect(formatLedgerSequence(12345.67)).toBe(12345);
      expect(formatLedgerSequence("12345.99")).toBe(12345);
    });

    it("should handle very large ledger numbers", () => {
      expect(formatLedgerSequence("999999999")).toBe(999999999);
      expect(formatLedgerSequence(999999999)).toBe(999999999);
    });
  });

  describe("invalid inputs", () => {
    it("should return null for null", () => {
      expect(formatLedgerSequence(null)).toBeNull();
    });

    it("should return null for undefined", () => {
      expect(formatLedgerSequence(undefined)).toBeNull();
    });

    it("should return null for non-numeric strings", () => {
      expect(formatLedgerSequence("invalid")).toBeNull();
      expect(formatLedgerSequence("abc123")).toBeNull();
    });

    it("should return null for negative numbers", () => {
      expect(formatLedgerSequence(-1)).toBeNull();
      expect(formatLedgerSequence("-123")).toBeNull();
    });

    it("should return null for NaN", () => {
      expect(formatLedgerSequence(NaN)).toBeNull();
    });

    it("should return null for Infinity", () => {
      expect(formatLedgerSequence(Infinity)).toBeNull();
      expect(formatLedgerSequence(-Infinity)).toBeNull();
    });

    it("should return null for empty string", () => {
      expect(formatLedgerSequence("")).toBeNull();
    });

    it("should return null for whitespace-only string", () => {
      expect(formatLedgerSequence("   ")).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("should handle string with leading zeros", () => {
      expect(formatLedgerSequence("00012345")).toBe(12345);
    });

    it("should handle scientific notation strings", () => {
      expect(formatLedgerSequence("1e6")).toBe(1000000);
    });

    it("should handle boolean values as numbers", () => {
      // true coerces to 1, false to 0
      expect(formatLedgerSequence(true)).toBe(1);
      expect(formatLedgerSequence(false)).toBe(0);
    });
  });
});
