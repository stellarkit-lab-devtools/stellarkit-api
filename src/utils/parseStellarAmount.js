/**
 * Converts a stroops value to a seven-decimal XLM string.
 *
 * Stellar's smallest unit is a stroop: 1 XLM = 10,000,000 stroops.
 * Horizon reports fees and reserves as integer stroops; this helper
 * performs the division and formats the result consistently so that
 * every API response that exposes an XLM equivalent uses the same
 * representation. BigInt is used throughout so the full signed int64
 * range is handled without floating-point precision loss.
 *
 * @param {number|string|bigint} stroops - Integer stroop count (numeric string or bigint allowed).
 * @returns {string} XLM amount formatted to exactly seven decimal places.
 */
const STROOPS_PER_XLM = 10_000_000n;

function parseStellarAmount(stroops) {
  let value;
  try {
    value = BigInt(stroops);
  } catch {
    const numeric = Number(stroops);
    if (!Number.isFinite(numeric)) return "0.0000000";
    value = BigInt(Math.trunc(numeric));
  }

  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / STROOPS_PER_XLM;
  const fractional = (absolute % STROOPS_PER_XLM).toString().padStart(7, "0");
  return `${negative ? "-" : ""}${whole}.${fractional}`;
}

/**
 * Converts a seven-decimal XLM string into an exact BigInt stroop count.
 * Inputs with more than seven decimals are rejected.
 *
 * @param {string} amount - Decimal XLM amount.
 * @returns {bigint} Exact stroop count.
 */
function xlmToStroops(amount) {
  const value = String(amount ?? "").trim();
  if (!/^[+-]?\d+(?:\.\d{1,7})?$/.test(value)) {
    throw new TypeError(`Invalid XLM amount: ${amount}`);
  }
  const negative = value.startsWith("-");
  const unsigned = value.replace(/^[+-]/, "");
  const [whole, fraction = ""] = unsigned.split(".");
  const stroops = BigInt(whole) * STROOPS_PER_XLM + BigInt(fraction.padEnd(7, "0"));
  return negative ? -stroops : stroops;
}

module.exports = { parseStellarAmount, xlmToStroops };
