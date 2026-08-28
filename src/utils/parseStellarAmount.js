/**
 * Converts a stroops value to a seven-decimal XLM string.
 *
 * Stellar's smallest unit is a stroop: 1 XLM = 10,000,000 stroops.
 * Horizon reports fees and reserves as integer stroops; this helper
 * performs the division and formats the result consistently so that
 * every API response that exposes an XLM equivalent uses the same
 * representation.
 *
 * @param {number|string} stroops - Integer stroop count (may be a numeric string).
 * @returns {string} XLM amount formatted to exactly seven decimal places.
 *
 * @example
 * parseStellarAmount(100)        // "0.0000100"
 * parseStellarAmount("1000000")  // "0.1000000"
 * parseStellarAmount(10000000)   // "1.0000000"
 * parseStellarAmount(0)          // "0.0000000"
 * parseStellarAmount(-100)       // "-0.0000100"
 */
const STROOPS_PER_XLM = 10_000_000;

function parseStellarAmount(stroops) {
  const numeric = typeof stroops === "string" ? parseFloat(stroops) : Number(stroops);
  if (!Number.isFinite(numeric)) {
    return "0.0000000";
  }
  return (numeric / STROOPS_PER_XLM).toFixed(7);
}

module.exports = { parseStellarAmount };
