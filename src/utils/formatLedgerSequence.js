/**
 * Normalizes a ledger sequence number to a consistent integer format.
 *
 * Horizon sometimes returns sequence numbers as strings and sometimes as numbers.
 * This helper ensures all ledger sequence fields are returned as integers across
 * all API endpoints, eliminating type inconsistency for consumers.
 *
 * @param {string|number|null|undefined} seq - The ledger sequence to normalize.
 * @returns {number|null} - Integer sequence number, or null if input is invalid.
 *
 * @example
 * formatLedgerSequence("12345678")  // → 12345678
 * formatLedgerSequence(12345678)    // → 12345678
 * formatLedgerSequence(null)        // → null
 * formatLedgerSequence("invalid")   // → null
 */
function formatLedgerSequence(seq) {
  if (seq === null || seq === undefined) return null;
  const parsed = Number(seq);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

module.exports = { formatLedgerSequence };
