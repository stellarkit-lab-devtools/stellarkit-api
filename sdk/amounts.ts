/**
 * @fileoverview
 * Safe arithmetic and conversion helpers for Stellar stroops and amounts.
 *
 * In Stellar, 1 XLM = 10,000,000 stroops (7 decimal places).
 * Floating-point arithmetic introduces rounding and precision errors.
 * This module performs all conversions and arithmetic using native BigInt,
 * guaranteeing exact precision within signed 64-bit integer (int64) boundaries.
 *
 * @module amounts
 */

/**
 * Maximum stroops representable in a signed 64-bit integer.
 * Equivalent to 922337203685.4775807 in decimal amount representation.
 */
export const INT64_MAX = 9223372036854775807n;

/**
 * Minimum stroops representable in a signed 64-bit integer.
 * Equivalent to -922337203685.4775808 in decimal amount representation.
 */
export const INT64_MIN = -9223372036854775808n;

/**
 * Scale factor: 1 amount unit = 10^7 stroops.
 */
export const STROOPS_PER_UNIT = 10000000n;

/**
 * Typed error thrown when an amount string is malformed, has invalid precision,
 * or exceeds the 64-bit signed integer (int64) range in stroops.
 */
export class InvalidAmount extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAmount";
    Object.setPrototypeOf(this, InvalidAmount.prototype);
  }
}

/**
 * Converts a decimal amount string to integer stroops (BigInt).
 *
 * Accepts at most 7 decimal places. Leading '-' is allowed for net values.
 * Rejects whitespace, empty strings, exponential notation (e.g. '1e7'),
 * more than 7 decimals, or values exceeding signed int64 bounds.
 *
 * @param str - The decimal amount string to convert.
 * @returns BigInt representation in stroops.
 * @throws {InvalidAmount} If the string format is invalid or exceeds int64 bounds.
 *
 * @example
 * ```ts
 * toStroops("100"); // 1000000000n
 * toStroops("12.34"); // 123400000n
 * toStroops("-5.0000001"); // -50000001n
 * toStroops("922337203685.4775807"); // 9223372036854775807n (int64 boundary)
 * ```
 */
export function toStroops(str: string): bigint {
  if (typeof str !== "string") {
    throw new InvalidAmount("Amount must be a string");
  }
  if (str.length === 0) {
    throw new InvalidAmount("Amount cannot be empty");
  }
  if (/\s/.test(str)) {
    throw new InvalidAmount("Amount cannot contain whitespace");
  }
  if (/[eE]/.test(str)) {
    throw new InvalidAmount("Exponent notation is not allowed");
  }

  const match = str.match(/^([+-])?(\d+)?(?:\.(\d+))?$/);
  if (!match) {
    throw new InvalidAmount(`Invalid amount format: "${str}"`);
  }

  const sign = match[1];
  const integerPart = match[2];
  const fractionalPart = match[3];

  if (!integerPart && !fractionalPart) {
    throw new InvalidAmount(`Invalid amount format: "${str}"`);
  }

  if (fractionalPart && fractionalPart.length > 7) {
    throw new InvalidAmount(
      `Amount cannot have more than 7 decimal places (got ${fractionalPart.length} in "${str}")`
    );
  }

  const isNegative = sign === "-";
  const intVal = integerPart ? BigInt(integerPart) : 0n;
  const fracVal = fractionalPart
    ? BigInt(fractionalPart.padEnd(7, "0"))
    : 0n;

  let stroops = intVal * STROOPS_PER_UNIT + fracVal;
  if (isNegative) {
    stroops = -stroops;
  }

  if (stroops < INT64_MIN || stroops > INT64_MAX) {
    throw new InvalidAmount(
      `Amount "${str}" exceeds int64 bounds [${INT64_MIN}, ${INT64_MAX}]`
    );
  }

  return stroops;
}

/**
 * Formats a BigInt or integer string stroops value into a standard seven-decimal amount string.
 *
 * @param value - The stroops value as BigInt or numeric string.
 * @returns Exact seven-decimal string representation.
 * @throws {InvalidAmount} If the value exceeds int64 bounds or is not a valid integer.
 *
 * @example
 * ```ts
 * fromStroops(1000000000n); // "100.0000000"
 * fromStroops("123400000"); // "12.3400000"
 * fromStroops(-1n); // "-0.0000001"
 * fromStroops(0n); // "0.0000000"
 * ```
 */
export function fromStroops(value: bigint | string): string {
  let stroops: bigint;
  if (typeof value === "bigint") {
    stroops = value;
  } else if (typeof value === "string") {
    if (!value || /\s/.test(value) || /[eE.]/.test(value)) {
      throw new InvalidAmount(`Invalid stroops string format: "${value}"`);
    }
    try {
      stroops = BigInt(value);
    } catch {
      throw new InvalidAmount(`Failed to parse stroops string: "${value}"`);
    }
  } else {
    throw new InvalidAmount("Value must be a bigint or string");
  }

  if (stroops < INT64_MIN || stroops > INT64_MAX) {
    throw new InvalidAmount(
      `Stroops value "${value}" exceeds int64 bounds [${INT64_MIN}, ${INT64_MAX}]`
    );
  }

  const isNegative = stroops < 0n;
  const absStroops = isNegative ? -stroops : stroops;

  const intPart = absStroops / STROOPS_PER_UNIT;
  const fracPart = absStroops % STROOPS_PER_UNIT;
  const fracStr = fracPart.toString().padStart(7, "0");

  return `${isNegative ? "-" : ""}${intPart.toString()}.${fracStr}`;
}

/**
 * Adds two decimal amount strings using exact BigInt stroops arithmetic.
 *
 * @param a - First amount string.
 * @param b - Second amount string.
 * @returns Sum formatted to 7 decimals.
 * @throws {InvalidAmount} On invalid input or int64 overflow.
 *
 * @example
 * ```ts
 * add("12.5", "3.25"); // "15.7500000"
 * add("-10", "2.5"); // "-7.5000000"
 * ```
 */
export function add(a: string, b: string): string {
  const sa = toStroops(a);
  const sb = toStroops(b);
  const result = sa + sb;
  if (result < INT64_MIN || result > INT64_MAX) {
    throw new InvalidAmount(`Addition overflowed int64 bounds: ${a} + ${b}`);
  }
  return fromStroops(result);
}

/**
 * Subtracts amount string `b` from amount string `a` using exact BigInt stroops arithmetic.
 *
 * @param a - Minuend amount string.
 * @param b - Subtrahend amount string.
 * @returns Difference formatted to 7 decimals.
 * @throws {InvalidAmount} On invalid input or int64 overflow.
 *
 * @example
 * ```ts
 * sub("10", "2.5"); // "7.5000000"
 * sub("1", "5"); // "-4.0000000"
 * ```
 */
export function sub(a: string, b: string): string {
  const sa = toStroops(a);
  const sb = toStroops(b);
  const result = sa - sb;
  if (result < INT64_MIN || result > INT64_MAX) {
    throw new InvalidAmount(`Subtraction overflowed int64 bounds: ${a} - ${b}`);
  }
  return fromStroops(result);
}

/**
 * Compares two decimal amount strings.
 *
 * @param a - First amount string.
 * @param b - Second amount string.
 * @returns -1 if a < b, 0 if a == b, 1 if a > b.
 * @throws {InvalidAmount} If either input is invalid.
 *
 * @example
 * ```ts
 * cmp("5.0", "10.0"); // -1
 * cmp("10.0", "10");   // 0
 * cmp("12.5", "12.4"); // 1
 * ```
 */
export function cmp(a: string, b: string): number {
  const sa = toStroops(a);
  const sb = toStroops(b);
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
}

/**
 * Returns the smaller of two decimal amount strings, formatted to 7 decimals.
 *
 * @param a - First amount string.
 * @param b - Second amount string.
 * @returns Minimum value formatted to 7 decimals.
 * @throws {InvalidAmount} If either input is invalid.
 *
 * @example
 * ```ts
 * min("5.5", "3.2"); // "3.2000000"
 * min("-10", "0");   // "-10.0000000"
 * ```
 */
export function min(a: string, b: string): string {
  const sa = toStroops(a);
  const sb = toStroops(b);
  return fromStroops(sa <= sb ? sa : sb);
}

/**
 * Returns the larger of two decimal amount strings, formatted to 7 decimals.
 *
 * @param a - First amount string.
 * @param b - Second amount string.
 * @returns Maximum value formatted to 7 decimals.
 * @throws {InvalidAmount} If either input is invalid.
 *
 * @example
 * ```ts
 * max("5.5", "3.2"); // "5.5000000"
 * max("-10", "0");   // "0.0000000"
 * ```
 */
export function max(a: string, b: string): string {
  const sa = toStroops(a);
  const sb = toStroops(b);
  return fromStroops(sa >= sb ? sa : sb);
}

/**
 * Sums an array of decimal amount strings using exact BigInt stroops arithmetic.
 *
 * @param amounts - Array of amount strings.
 * @returns Total sum formatted to 7 decimals.
 * @throws {InvalidAmount} On invalid input or int64 overflow.
 *
 * @example
 * ```ts
 * sum(["1.5", "2.25", "3.25"]); // "7.0000000"
 * sum([]); // "0.0000000"
 * ```
 */
export function sum(amounts: string[]): string {
  if (!Array.isArray(amounts)) {
    throw new InvalidAmount("Amounts must be an array");
  }
  let total = 0n;
  for (const amt of amounts) {
    const s = toStroops(amt);
    total += s;
    if (total < INT64_MIN || total > INT64_MAX) {
      throw new InvalidAmount("Sum overflowed int64 bounds");
    }
  }
  return fromStroops(total);
}

// CommonJS compatibility export
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    INT64_MAX,
    INT64_MIN,
    STROOPS_PER_UNIT,
    InvalidAmount,
    toStroops,
    fromStroops,
    add,
    sub,
    cmp,
    min,
    max,
    sum,
  };
}
