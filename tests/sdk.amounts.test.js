"use strict";

/**
 * Tests for sdk/amounts.ts — BigInt stroops amount arithmetic module (#1243).
 *
 * Covers:
 *   - toStroops accepts up to 7 decimal places
 *   - toStroops rejects > 7 decimal places
 *   - toStroops rejects exponent notation
 *   - toStroops rejects whitespace and empty strings
 *   - fromStroops returns seven-decimal string
 *   - fromStroops accepts bigint or string
 *   - Round trip: fromStroops(toStroops(x))
 *   - Exact boundary: 922337203685.4775807 (int64 max) and -922337203685.4775808 (int64 min)
 *   - Overflow detection beyond int64 boundaries throws InvalidAmount
 *   - Negative amounts and net value arithmetic
 *   - add, sub, cmp, min, max, and sum operations
 *   - Long sum with multiple mixed values
 */

const {
  toStroops,
  fromStroops,
  add,
  sub,
  cmp,
  min,
  max,
  sum,
  InvalidAmount,
  INT64_MAX,
  INT64_MIN,
} = require("../sdk/dist/amounts");

describe("Amounts Module (sdk/amounts.ts)", () => {
  describe("toStroops", () => {
    test("converts integer amounts to stroops", () => {
      expect(toStroops("1")).toBe(10000000n);
      expect(toStroops("100")).toBe(1000000000n);
      expect(toStroops("0")).toBe(0n);
    });

    test("converts fractional amounts with up to 7 decimal places", () => {
      expect(toStroops("0.1")).toBe(1000000n);
      expect(toStroops("0.0000001")).toBe(1n);
      expect(toStroops("12.34")).toBe(123400000n);
      expect(toStroops("100.1234567")).toBe(1001234567n);
    });

    test("supports negative amounts for net values", () => {
      expect(toStroops("-1")).toBe(-10000000n);
      expect(toStroops("-0.0000001")).toBe(-1n);
      expect(toStroops("-12.34")).toBe(-123400000n);
    });

    test("rejects 8 or more decimal places", () => {
      expect(() => toStroops("1.12345678")).toThrow(InvalidAmount);
      expect(() => toStroops("0.00000001")).toThrow(InvalidAmount);
      expect(() => toStroops("10.00000000")).toThrow(InvalidAmount);
    });

    test("rejects exponent notation", () => {
      expect(() => toStroops("1e7")).toThrow(InvalidAmount);
      expect(() => toStroops("2.5E3")).toThrow(InvalidAmount);
      expect(() => toStroops("1e-7")).toThrow(InvalidAmount);
    });

    test("rejects whitespace and empty strings", () => {
      expect(() => toStroops("")).toThrow(InvalidAmount);
      expect(() => toStroops(" ")).toThrow(InvalidAmount);
      expect(() => toStroops(" 100")).toThrow(InvalidAmount);
      expect(() => toStroops("100 ")).toThrow(InvalidAmount);
      expect(() => toStroops("10 0")).toThrow(InvalidAmount);
    });

    test("rejects invalid characters and malformed numbers", () => {
      expect(() => toStroops("abc")).toThrow(InvalidAmount);
      expect(() => toStroops("-")).toThrow(InvalidAmount);
      expect(() => toStroops(".")).toThrow(InvalidAmount);
      expect(() => toStroops("1.2.3")).toThrow(InvalidAmount);
      expect(() => toStroops(100)).toThrow(InvalidAmount);
    });

    test("handles int64 maximum boundary", () => {
      expect(toStroops("922337203685.4775807")).toBe(INT64_MAX);
    });

    test("handles int64 minimum boundary", () => {
      expect(toStroops("-922337203685.4775808")).toBe(INT64_MIN);
    });

    test("throws InvalidAmount on overflow beyond int64 boundaries", () => {
      expect(() => toStroops("922337203685.4775808")).toThrow(InvalidAmount);
      expect(() => toStroops("-922337203685.4775809")).toThrow(InvalidAmount);
      expect(() => toStroops("10000000000000")).toThrow(InvalidAmount);
    });
  });

  describe("fromStroops", () => {
    test("formats bigint stroops to seven decimals", () => {
      expect(fromStroops(10000000n)).toBe("1.0000000");
      expect(fromStroops(123400000n)).toBe("12.3400000");
      expect(fromStroops(1n)).toBe("0.0000001");
      expect(fromStroops(0n)).toBe("0.0000000");
    });

    test("formats negative stroops correctly", () => {
      expect(fromStroops(-10000000n)).toBe("-1.0000000");
      expect(fromStroops(-1n)).toBe("-0.0000001");
      expect(fromStroops(-123400000n)).toBe("-12.3400000");
    });

    test("accepts stroops as numeric string", () => {
      expect(fromStroops("10000000")).toBe("1.0000000");
      expect(fromStroops("-50000000")).toBe("-5.0000000");
      expect(fromStroops("0")).toBe("0.0000000");
    });

    test("rejects invalid stroops inputs", () => {
      expect(() => fromStroops("1.5")).toThrow(InvalidAmount);
      expect(() => fromStroops("1e7")).toThrow(InvalidAmount);
      expect(() => fromStroops("")).toThrow(InvalidAmount);
      expect(() => fromStroops(10.5)).toThrow(InvalidAmount);
      expect(() => fromStroops(INT64_MAX + 1n)).toThrow(InvalidAmount);
      expect(() => fromStroops(INT64_MIN - 1n)).toThrow(InvalidAmount);
    });
  });

  describe("Round trip", () => {
    const testCases = [
      "0.0000000",
      "0.0000001",
      "1.0000000",
      "12.3400000",
      "999.9999999",
      "-5.5000000",
      "-0.0000001",
      "922337203685.4775807",
      "-922337203685.4775808",
    ];

    test.each(testCases)("preserves exact representation for %s", (amount) => {
      const stroops = toStroops(amount);
      const formatted = fromStroops(stroops);
      expect(formatted).toBe(amount);
    });
  });

  describe("Arithmetic operations (add, sub)", () => {
    test("add calculates exact sum", () => {
      expect(add("10.5", "5.25")).toBe("15.7500000");
      expect(add("0.0000001", "0.0000002")).toBe("0.0000003");
      expect(add("-5", "10")).toBe("5.0000000");
    });

    test("add detects overflow beyond int64", () => {
      expect(() => add("922337203685.4775807", "0.0000001")).toThrow(InvalidAmount);
    });

    test("sub calculates exact difference", () => {
      expect(sub("10", "3.5")).toBe("6.5000000");
      expect(sub("1", "5")).toBe("-4.0000000");
      expect(sub("-5", "-5")).toBe("0.0000000");
    });

    test("sub detects underflow beyond int64", () => {
      expect(() => sub("-922337203685.4775808", "0.0000001")).toThrow(InvalidAmount);
    });
  });

  describe("Comparison and Ordering (cmp, min, max)", () => {
    test("cmp orders correctly", () => {
      expect(cmp("5", "10")).toBe(-1);
      expect(cmp("10", "5")).toBe(1);
      expect(cmp("5.0000000", "5")).toBe(0);
      expect(cmp("-10", "-5")).toBe(-1);
      expect(cmp("-5", "-10")).toBe(1);
    });

    test("min returns minimum amount formatted", () => {
      expect(min("12.5", "3.2")).toBe("3.2000000");
      expect(min("-10", "0")).toBe("-10.0000000");
      expect(min("5", "5.0")).toBe("5.0000000");
    });

    test("max returns maximum amount formatted", () => {
      expect(max("12.5", "3.2")).toBe("12.5000000");
      expect(max("-10", "0")).toBe("0.0000000");
      expect(max("5", "5.0")).toBe("5.0000000");
    });
  });

  describe("Sum operation", () => {
    test("sum sums an empty array to 0", () => {
      expect(sum([])).toBe("0.0000000");
    });

    test("sum sums an array of amounts", () => {
      expect(sum(["1.5", "2.25", "3.25"])).toBe("7.0000000");
      expect(sum(["10", "-3", "-7"])).toBe("0.0000000");
    });

    test("long sum with many micro amounts calculates exact total", () => {
      const items = Array.from({ length: 1000 }, () => "0.0001000");
      expect(sum(items)).toBe("0.1000000");
    });

    test("sum detects overflow", () => {
      expect(() => sum(["922337203680", "10"])).toThrow(InvalidAmount);
    });
  });
});
