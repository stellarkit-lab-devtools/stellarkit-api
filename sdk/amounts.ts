/** Error raised for malformed amounts or values outside signed int64 stroops. */
export class InvalidAmount extends Error {
  readonly type = "InvalidAmount";
  constructor(message = "Invalid amount or signed int64 overflow.") {
    super(message);
    this.name = "InvalidAmount";
  }
}

const SCALE = 10000000n;
const MAX = 9223372036854775807n;
const MIN = -9223372036854775808n;
function checked(value: bigint): bigint {
  if (value < MIN || value > MAX) throw new InvalidAmount();
  return value;
}

/** Convert decimal units to exact stroops. @example toStroops("1.0000001") // 10000001n */
export function toStroops(value: string): bigint {
  if (typeof value !== "string" || !/^-?\d+(?:\.\d{1,7})?$/.test(value)) {
    throw new InvalidAmount();
  }
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const result = BigInt(whole) * SCALE + BigInt(fraction.padEnd(7, "0"));
  return checked(negative ? -result : result);
}

/** Format integer stroops as seven decimals. @example fromStroops(1n) // "0.0000001" */
export function fromStroops(value: bigint | string): string {
  if (typeof value !== "bigint" && (typeof value !== "string" || !/^-?\d+$/.test(value))) {
    throw new InvalidAmount();
  }
  const amount = checked(BigInt(value));
  const absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? "-" : ""}${absolute / SCALE}.${(absolute % SCALE).toString().padStart(7, "0")}`;
}

/** Add exact amounts. @example add("0.1", "0.2") // "0.3000000" */
export const add = (a: string, b: string): string => fromStroops(toStroops(a) + toStroops(b));
/** Subtract exact amounts. @example sub("1", "2") // "-1.0000000" */
export const sub = (a: string, b: string): string => fromStroops(toStroops(a) - toStroops(b));
/** Compare amounts. @example cmp("2", "10") // -1 */
export function cmp(a: string, b: string): -1 | 0 | 1 {
  const left = toStroops(a), right = toStroops(b);
  return left < right ? -1 : left > right ? 1 : 0;
}
/** Smaller amount. @example min("2", "10") // "2.0000000" */
export const min = (a: string, b: string): string => fromStroops(toStroops(cmp(a, b) <= 0 ? a : b));
/** Larger amount. @example max("2", "10") // "10.0000000" */
export const max = (a: string, b: string): string => fromStroops(toStroops(cmp(a, b) >= 0 ? a : b));
/** Sum exact amounts; the final total must fit int64. @example sum(["0.1", "0.2"]) // "0.3000000" */
export function sum(values: Iterable<string>): string {
  let total = 0n;
  for (const value of values) total += toStroops(value);
  return fromStroops(total);
}
