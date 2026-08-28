const { parseStellarAmount } = require("./parseStellarAmount");
const { formatLedgerSequence } = require("./formatLedgerSequence");

const SURGE_CAPACITY_THRESHOLD = 0.5;

function toStroops(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function amountPair(stroops) {
  return {
    stroops,
    xlm: parseStellarAmount(stroops),
  };
}

/**
 * True when recent ledgers are congested or the accepted base fee has
 * lifted above the current minimum charged fee.
 *
 * @param {object} feeStats - Raw Horizon feeStats() response.
 * @returns {boolean}
 */
function computeIsSurge(feeStats) {
  const usage = parseFloat(feeStats.ledger_capacity_usage);
  const baseFeeStroops = toStroops(feeStats.last_ledger_base_fee);
  const minFee = toStroops(feeStats.fee_charged && feeStats.fee_charged.min);
  return usage > SURGE_CAPACITY_THRESHOLD || baseFeeStroops > minFee;
}

/**
 * Maps a Horizon feeStats() payload onto the StellarKit normalised fee fields.
 *
 * @param {object} feeStats - Raw Horizon feeStats() response (snake_case).
 * @returns {object} CamelCase fee snapshot: baseFeeStroops, baseFeeXLM, p50, p95, isSurge, lastLedgerSequence.
 */
function mapFeeStats(feeStats) {
  const charged = feeStats.fee_charged || {};
  const baseFeeStroops = toStroops(feeStats.last_ledger_base_fee);
  const p50Stroops = toStroops(charged.p50);
  const p95Stroops = toStroops(charged.p95);

  return {
    baseFeeStroops,
    baseFeeXLM: parseStellarAmount(baseFeeStroops),
    p50: amountPair(p50Stroops),
    p95: amountPair(p95Stroops),
    isSurge: computeIsSurge(feeStats),
    lastLedgerSequence: formatLedgerSequence(feeStats.last_ledger),
  };
}

module.exports = {
  mapFeeStats,
  computeIsSurge,
  SURGE_CAPACITY_THRESHOLD,
};
