const { isNativeAsset, isNonNativeAsset } = require("../src/utils/assetHelpers");

describe("assetHelpers", () => {
  describe("isNativeAsset", () => {
    describe("Horizon balance format (asset_type)", () => {
      it("should return true for native asset_type", () => {
        expect(isNativeAsset({ asset_type: "native" })).toBe(true);
      });

      it("should return false for credit_alphanum4", () => {
        expect(isNativeAsset({ asset_type: "credit_alphanum4" })).toBe(false);
      });

      it("should return false for credit_alphanum12", () => {
        expect(isNativeAsset({ asset_type: "credit_alphanum12" })).toBe(false);
      });
    });

    describe("Normalized format (type)", () => {
      it("should return true for native type", () => {
        expect(isNativeAsset({ type: "native" })).toBe(true);
      });

      it("should return false for credit_alphanum4 type", () => {
        expect(isNativeAsset({ type: "credit_alphanum4" })).toBe(false);
      });

      it("should return false for credit_alphanum12 type", () => {
        expect(isNativeAsset({ type: "credit_alphanum12" })).toBe(false);
      });
    });

    describe("String format", () => {
      it('should return true for "native" string', () => {
        expect(isNativeAsset("native")).toBe(true);
      });

      it("should return false for asset identifier string", () => {
        expect(isNativeAsset("USDC:GA...")).toBe(false);
      });

      it("should return false for asset code string", () => {
        expect(isNativeAsset("USDC")).toBe(false);
      });
    });

    describe("Full asset objects", () => {
      it("should return true for native asset with all fields", () => {
        const asset = {
          asset_type: "native",
          balance: "100.0000000",
          buying_liabilities: "0.0000000",
          selling_liabilities: "0.0000000",
        };
        expect(isNativeAsset(asset)).toBe(true);
      });

      it("should return false for credit asset with all fields", () => {
        const asset = {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
          balance: "500.0000000",
          limit: "922337203685.4775807",
        };
        expect(isNativeAsset(asset)).toBe(false);
      });
    });

    describe("Edge cases", () => {
      it("should return false for null", () => {
        expect(isNativeAsset(null)).toBe(false);
      });

      it("should return false for undefined", () => {
        expect(isNativeAsset(undefined)).toBe(false);
      });

      it("should return false for empty object", () => {
        expect(isNativeAsset({})).toBe(false);
      });

      it("should return false for empty string", () => {
        expect(isNativeAsset("")).toBe(false);
      });

      it("should handle both asset_type and type present", () => {
        expect(isNativeAsset({ asset_type: "native", type: "native" })).toBe(true);
        expect(isNativeAsset({ asset_type: "native", type: "credit_alphanum4" })).toBe(true);
      });
    });

    describe("Case sensitivity", () => {
      it("should be case-sensitive for string comparison", () => {
        expect(isNativeAsset("NATIVE")).toBe(false);
        expect(isNativeAsset("Native")).toBe(false);
      });

      it("should be case-sensitive for type field", () => {
        expect(isNativeAsset({ type: "NATIVE" })).toBe(false);
        expect(isNativeAsset({ asset_type: "NATIVE" })).toBe(false);
      });
    });
  });

  describe("isNonNativeAsset", () => {
    it("should return false for native asset", () => {
      expect(isNonNativeAsset({ asset_type: "native" })).toBe(false);
    });

    it("should return true for credit_alphanum4", () => {
      expect(isNonNativeAsset({ asset_type: "credit_alphanum4" })).toBe(true);
    });

    it("should return true for credit_alphanum12", () => {
      expect(isNonNativeAsset({ asset_type: "credit_alphanum12" })).toBe(true);
    });

    it('should return false for "native" string', () => {
      expect(isNonNativeAsset("native")).toBe(false);
    });

    it("should return true for asset identifier string", () => {
      expect(isNonNativeAsset("USDC:GA...")).toBe(true);
    });

    it("should return true for null", () => {
      expect(isNonNativeAsset(null)).toBe(true);
    });

    it("should return true for undefined", () => {
      expect(isNonNativeAsset(undefined)).toBe(true);
    });

    it("should return true for empty object", () => {
      expect(isNonNativeAsset({})).toBe(true);
    });
  });

  describe("Consistency between isNativeAsset and isNonNativeAsset", () => {
    const testCases = [
      { asset_type: "native" },
      { asset_type: "credit_alphanum4" },
      { type: "native" },
      "native",
      "USDC:GA...",
      null,
      undefined,
      {},
    ];

    testCases.forEach((testCase) => {
      it(`should be opposites for ${JSON.stringify(testCase)}`, () => {
        expect(isNativeAsset(testCase)).toBe(!isNonNativeAsset(testCase));
      });
    });
  });
});
