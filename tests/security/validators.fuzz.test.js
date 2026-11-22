const fc = require("fast-check");
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
  validateTransactionHash,
  isValidPoolId,
  validateDaysLookback,
} = require("../../src/utils/validators");

const MAX_EXECUTION_TIME_MS = 50;

describe("Validator Fuzz Tests", () => {
  describe("validateAccountId", () => {
    it("should handle arbitrary strings without crashing", () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          try {
            validateAccountId(input);
          } catch (err) {
            expect(err).toHaveProperty("type", "InvalidAccountId");
            expect(err).toHaveProperty("status", 400);
          }
        }),
        { seed: Date.now(), numRuns: 1000 }
      );
    });

    it("should handle Unicode strings", () => {
      fc.assert(
        fc.property(fc.fullUnicodeString(), (input) => {
          try {
            validateAccountId(input);
          } catch (err) {
            expect(err).toHaveProperty("type", "InvalidAccountId");
          }
        }),
        { seed: Date.now(), numRuns: 500 }
      );
    });

    it("should handle large strings within time limit", () => {
      const largeString = "a".repeat(100000) + "!";
      const start = Date.now();
      try {
        validateAccountId(largeString);
      } catch (err) {
        expect(err).toHaveProperty("type", "InvalidAccountId");
      }
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(MAX_EXECUTION_TIME_MS);
    });

    it("should handle null bytes and control characters", () => {
      const inputs = [
        "\0",
        "\x00\x01\x02",
        "\n\r\t",
        "G\0AAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
      ];
      inputs.forEach((input) => {
        try {
          validateAccountId(input);
        } catch (err) {
          expect(err).toHaveProperty("type", "InvalidAccountId");
        }
      });
    });
  });

  describe("validateContractId", () => {
    it("should handle arbitrary strings without crashing", () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          try {
            validateContractId(input);
          } catch (err) {
            expect(err).toHaveProperty("isValidation", true);
            expect(err).toHaveProperty("field", "contractId");
          }
        }),
        { seed: Date.now(), numRuns: 1000 }
      );
    });

    it("should handle large strings within time limit", () => {
      const largeString = "C".repeat(100000);
      const start = Date.now();
      try {
        validateContractId(largeString);
      } catch (err) {
        expect(err).toHaveProperty("field", "contractId");
      }
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(MAX_EXECUTION_TIME_MS);
    });

    it("should handle null and undefined", () => {
      [null, undefined, ""].forEach((input) => {
        try {
          validateContractId(input);
        } catch (err) {
          expect(err).toHaveProperty("field", "contractId");
        }
      });
    });
  });

  describe("validateAssetCode", () => {
    it("should handle arbitrary strings without crashing", () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          try {
            validateAssetCode(input);
          } catch (err) {
            expect(err).toHaveProperty("isValidation", true);
            expect(err).toHaveProperty("field", "assetCode");
          }
        }),
        { seed: Date.now(), numRuns: 1000 }
      );
    });

    it("should handle large strings within time limit", () => {
      const largeString = "A".repeat(100000);
      const start = Date.now();
      try {
        validateAssetCode(largeString);
      } catch (err) {
        expect(err).toHaveProperty("field", "assetCode");
      }
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(MAX_EXECUTION_TIME_MS);
    });

    it("should handle Unicode and special characters", () => {
      const inputs = ["😀", "USDC\0", "USDC\n\r\t", "USDC\x00\x01"];
      inputs.forEach((input) => {
        try {
          validateAssetCode(input);
        } catch (err) {
          expect(err).toHaveProperty("field", "assetCode");
        }
      });
    });
  });

  describe("validateLimit", () => {
    it("should handle arbitrary inputs without crashing", () => {
      fc.assert(
        fc.property(fc.anything(), (input) => {
          try {
            validateLimit(input);
          } catch (err) {
            expect(err).toHaveProperty("isInvalidLimit", true);
            expect(err).toHaveProperty("status", 400);
          }
        }),
        { seed: Date.now(), numRuns: 1000 }
      );
    });

    it("should handle large numbers and strings", () => {
      const inputs = [
        "9999999999999999",
        Number.MAX_SAFE_INTEGER,
        Number.MAX_VALUE,
        "1".repeat(100000),
      ];
      inputs.forEach((input) => {
        const start = Date.now();
        try {
          validateLimit(input);
        } catch (err) {
          expect(err).toHaveProperty("isInvalidLimit", true);
        }
        const duration = Date.now() - start;
        expect(duration).toBeLessThan(MAX_EXECUTION_TIME_MS);
      });
    });

    it("should return valid limits for proper input", () => {
      expect(validateLimit(50)).toBe(50);
      expect(validateLimit("25")).toBe(25);
    });
  });

  describe("validateOrder", () => {
    it("should handle arbitrary strings without crashing", () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          try {
            const result = validateOrder(input);
            expect(["asc", "desc"]).toContain(result);
          } catch (err) {
            expect(err).toHaveProperty("isValidation", true);
            expect(err).toHaveProperty("field", "order");
          }
        }),
        { seed: Date.now(), numRuns: 1000 }
      );
    });

    it("should handle large strings within time limit", () => {
      const largeString = "x".repeat(100000);
      const start = Date.now();
      try {
        validateOrder(largeString);
      } catch (err) {
        expect(err).toHaveProperty("field", "order");
      }
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(MAX_EXECUTION_TIME_MS);
    });
  });

  describe("validateAsset", () => {
    it("should handle arbitrary code and issuer pairs without crashing", () => {
      fc.assert(
        fc.property(fc.string(), fc.string(), (code, issuer) => {
          try {
            validateAsset(code, issuer);
          } catch (err) {
            expect(err).toHaveProperty("isInvalidAsset", true);
            expect(err).toHaveProperty("status", 400);
          }
        }),
        { seed: Date.now(), numRuns: 1000 }
      );
    });

    it("should handle large strings within time limit", () => {
      const largeCode = "A".repeat(100000);
      const largeIssuer = "G".repeat(100000);
      const start = Date.now();
      try {
        validateAsset(largeCode, largeIssuer);
      } catch (err) {
        expect(err).toHaveProperty("isInvalidAsset", true);
      }
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(MAX_EXECUTION_TIME_MS);
    });
  });

  describe("validateCursor", () => {
    it("should handle arbitrary inputs without crashing", () => {
      fc.assert(
        fc.property(fc.anything(), (input) => {
          try {
            validateCursor(input);
          } catch (err) {
            expect(err).toHaveProperty("isInvalidCursor", true);
            expect(err).toHaveProperty("type", "InvalidCursor");
            expect(err).toHaveProperty("status", 400);
          }
        }),
        { seed: Date.now(), numRuns: 1000 }
      );
    });

    it("should handle adversarial patterns within time limit", () => {
      const patterns = [
        "a".repeat(100000),
        "A-".repeat(50000),
        "0-9".repeat(33333),
        "\n".repeat(100000),
      ];
      patterns.forEach((input) => {
        const start = Date.now();
        try {
          validateCursor(input);
        } catch (err) {
          expect(err).toHaveProperty("isInvalidCursor", true);
        }
        const duration = Date.now() - start;
        expect(duration).toBeLessThan(MAX_EXECUTION_TIME_MS);
      });
    });
  });

  describe("validateISODate", () => {
    it("should handle arbitrary strings without crashing", () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          try {
            validateISODate(input, "testField");
          } catch (err) {
            expect(err).toHaveProperty("isValidation", true);
            expect(err).toHaveProperty("field", "testField");
          }
        }),
        { seed: Date.now(), numRuns: 1000 }
      );
    });

    it("should handle large strings within time limit", () => {
      const largeString = "2024-01-01T00:00:00Z" + "x".repeat(100000);
      const start = Date.now();
      try {
        validateISODate(largeString, "date");
      } catch (err) {
        expect(err).toHaveProperty("field", "date");
      }
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(MAX_EXECUTION_TIME_MS);
    });
  });

  describe("validateStellarAddress", () => {
    it("should handle arbitrary inputs without crashing", () => {
      fc.assert(
        fc.property(fc.anything(), (input) => {
          const result = validateStellarAddress(input);
          expect(typeof result).toBe("boolean");
        }),
        { seed: Date.now(), numRuns: 1000 }
      );
    });

    it("should handle large strings within time limit", () => {
      const largeString = "G" + "A".repeat(100000);
      const start = Date.now();
      const result = validateStellarAddress(largeString);
      expect(typeof result).toBe("boolean");
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(MAX_EXECUTION_TIME_MS);
    });

    it("should handle null and undefined", () => {
      expect(validateStellarAddress(null)).toBe(false);
      expect(validateStellarAddress(undefined)).toBe(false);
      expect(validateStellarAddress("")).toBe(false);
    });
  });

  describe("validateCredentialType", () => {
    it("should handle arbitrary inputs without crashing", () => {
      fc.assert(
        fc.property(fc.anything(), (input) => {
          const result = validateCredentialType(input);
          expect(typeof result).toBe("boolean");
        }),
        { seed: Date.now(), numRuns: 1000 }
      );
    });

    it("should handle large strings within time limit", () => {
      const largeString = "a".repeat(100000);
      const start = Date.now();
      const result = validateCredentialType(largeString);
      expect(typeof result).toBe("boolean");
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(MAX_EXECUTION_TIME_MS);
    });

    it("should handle adversarial patterns within time limit", () => {
      const patterns = [
        "abc_".repeat(25000),
        "A-Z.".repeat(25000),
        "0-9_".repeat(33333),
      ];
      patterns.forEach((input) => {
        const start = Date.now();
        const result = validateCredentialType(input);
        expect(typeof result).toBe("boolean");
        const duration = Date.now() - start;
        expect(duration).toBeLessThan(MAX_EXECUTION_TIME_MS);
      });
    });
  });

  describe("validateTransactionHash", () => {
    it("should handle arbitrary strings without crashing", () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          try {
            validateTransactionHash(input);
          } catch (err) {
            expect(err).toHaveProperty("isInvalidTransactionHash", true);
            expect(err).toHaveProperty("type", "InvalidTransactionHash");
            expect(err).toHaveProperty("status", 400);
          }
        }),
        { seed: Date.now(), numRuns: 1000 }
      );
    });

    it("should handle adversarial patterns within time limit", () => {
      const patterns = [
        "a".repeat(100000),
        "0f".repeat(50000),
        "abc123".repeat(16667),
      ];
      patterns.forEach((input) => {
        const start = Date.now();
        try {
          validateTransactionHash(input);
        } catch (err) {
          expect(err).toHaveProperty("isInvalidTransactionHash", true);
        }
        const duration = Date.now() - start;
        expect(duration).toBeLessThan(MAX_EXECUTION_TIME_MS);
      });
    });
  });

  describe("isValidPoolId", () => {
    it("should handle arbitrary inputs without crashing", () => {
      fc.assert(
        fc.property(fc.anything(), (input) => {
          const result = isValidPoolId(input);
          expect(typeof result).toBe("boolean");
        }),
        { seed: Date.now(), numRuns: 1000 }
      );
    });

    it("should handle large strings within time limit", () => {
      const largeString = "a".repeat(100000);
      const start = Date.now();
      const result = isValidPoolId(largeString);
      expect(typeof result).toBe("boolean");
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(MAX_EXECUTION_TIME_MS);
    });

    it("should handle adversarial patterns within time limit", () => {
      const patterns = [
        "0f".repeat(50000),
        "abc".repeat(33333),
      ];
      patterns.forEach((input) => {
        const start = Date.now();
        const result = isValidPoolId(input);
        expect(typeof result).toBe("boolean");
        const duration = Date.now() - start;
        expect(duration).toBeLessThan(MAX_EXECUTION_TIME_MS);
      });
    });
  });

  describe("validateDaysLookback", () => {
    it("should handle arbitrary inputs without crashing", () => {
      fc.assert(
        fc.property(fc.anything(), (input) => {
          try {
            const result = validateDaysLookback(input);
            expect(typeof result).toBe("number");
          } catch (err) {
            expect(err).toHaveProperty("isValidation", true);
            expect(err).toHaveProperty("field", "days");
          }
        }),
        { seed: Date.now(), numRuns: 1000 }
      );
    });

    it("should handle large strings within time limit", () => {
      const largeString = "9".repeat(100000);
      const start = Date.now();
      try {
        validateDaysLookback(largeString);
      } catch (err) {
        expect(err).toHaveProperty("field", "days");
      }
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(MAX_EXECUTION_TIME_MS);
    });

    it("should return default for null/undefined", () => {
      expect(validateDaysLookback(null)).toBe(30);
      expect(validateDaysLookback(undefined)).toBe(30);
      expect(validateDaysLookback("")).toBe(30);
    });
  });

  describe("ReDoS Prevention", () => {
    it("all validators complete within time limit for 100KB input", () => {
      const largeInput = "a".repeat(100000) + "!";
      
      const validators = [
        () => { try { validateAccountId(largeInput); } catch (e) {} },
        () => { try { validateContractId(largeInput); } catch (e) {} },
        () => { try { validateAssetCode(largeInput); } catch (e) {} },
        () => { try { validateCursor(largeInput); } catch (e) {} },
        () => { try { validateTransactionHash(largeInput); } catch (e) {} },
        () => validateStellarAddress(largeInput),
        () => validateCredentialType(largeInput),
        () => isValidPoolId(largeInput),
      ];

      validators.forEach((validator, index) => {
        const start = Date.now();
        validator();
        const duration = Date.now() - start;
        expect(duration).toBeLessThan(MAX_EXECUTION_TIME_MS);
      });
    });
  });
});
