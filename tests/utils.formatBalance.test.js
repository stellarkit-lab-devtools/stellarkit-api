const { formatBalance } = require("../src/utils/formatBalance");

describe("formatBalance", () => {
  describe("Basic formatting with thousand separators", () => {
    it('should format "10000.1234567" as "10,000.1234567"', () => {
      expect(formatBalance("10000.1234567")).toBe("10,000.1234567");
    });

    it('should format "1234567.89" as "1,234,567.89"', () => {
      expect(formatBalance("1234567.89")).toBe("1,234,567.89");
    });

    it('should format "100" as "100" (no formatting needed)', () => {
      expect(formatBalance("100")).toBe("100");
    });

    it('should format "999" as "999" (under 1000)', () => {
      expect(formatBalance("999")).toBe("999");
    });

    it('should format "1000" as "1,000"', () => {
      expect(formatBalance("1000")).toBe("1,000");
    });
  });

  describe("Small balance handling (no trailing zero stripping)", () => {
    it('should return "0.0000100" without stripping trailing zeros', () => {
      expect(formatBalance("0.0000100")).toBe("0.0000100");
    });

    it('should return "0.0000001" without stripping trailing zeros', () => {
      expect(formatBalance("0.0000001")).toBe("0.0000001");
    });

    it('should format "0.10" as "0.10"', () => {
      expect(formatBalance("0.10")).toBe("0.10");
    });

    it('should return "0" as "0"', () => {
      expect(formatBalance("0")).toBe("0");
    });
  });

  describe("Large balance formatting", () => {
    it('should format "1000000.5555" as "1,000,000.5555"', () => {
      expect(formatBalance("1000000.5555")).toBe("1,000,000.5555");
    });

    it('should format "1000000000.1" as "1,000,000,000.1"', () => {
      expect(formatBalance("1000000000.1")).toBe("1,000,000,000.1");
    });

    it('should format "999999999.999999" as "999,999,999.999999"', () => {
      expect(formatBalance("999999999.999999")).toBe("999,999,999.999999");
    });
  });

  describe("Edge cases", () => {
    it("should handle null gracefully", () => {
      expect(formatBalance(null)).toBe(null);
    });

    it("should handle undefined gracefully", () => {
      expect(formatBalance(undefined)).toBe(undefined);
    });

    it("should handle empty string", () => {
      expect(formatBalance("")).toBe("");
    });

    it("should handle non-string input", () => {
      const num = 123;
      expect(formatBalance(num)).toBe(num);
    });
  });

  describe("Stellar-specific balance values", () => {
    it('should format XLM default balance "0.0000000" as "0.0000000"', () => {
      expect(formatBalance("0.0000000")).toBe("0.0000000");
    });

    it('should format typical XLM balance "50000.0000000" as "50,000.0000000"', () => {
      expect(formatBalance("50000.0000000")).toBe("50,000.0000000");
    });

    it('should format typical asset balance "1234567.123456" as "1,234,567.123456"', () => {
      expect(formatBalance("1234567.123456")).toBe("1,234,567.123456");
    });

    it('should format liability value "10000" as "10,000"', () => {
      expect(formatBalance("10000")).toBe("10,000");
    });
  });

  describe("Decimal precision preservation", () => {
    it("should preserve all decimal places", () => {
      expect(formatBalance("1000.123456789")).toBe("1,000.123456789");
    });

    it("should preserve many decimal places for small amounts", () => {
      expect(formatBalance("0.0000000000000001")).toBe("0.0000000000000001");
    });

    it("should format integer without decimal point", () => {
      expect(formatBalance("50000")).toBe("50,000");
    });
  });
});
