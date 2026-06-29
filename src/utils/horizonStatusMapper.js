const HORIZON_STATUS_MAP = {
  tx_bad_seq: 409,
  tx_insufficient_fee: 422,
  tx_bad_auth: 403,

  op_no_trust: 422,
  op_line_full: 422,
  op_no_destination: 404,
  op_underfunded: 422,
  op_low_reserve: 422,

  transaction_failed: 422,
  not_found: 404,
};

/**
 * Maps a Horizon result code to its corresponding HTTP status code.
 *
 * @param {string|null|undefined} code - The Horizon transaction or operation result code.
 * @returns {number|null} The HTTP status code, or null if the code is not recognized.
 */
function mapHorizonErrorToStatus(code) {
  if (!code) return null;
  return HORIZON_STATUS_MAP[code] ?? null;
}

module.exports = {
  mapHorizonErrorToStatus,
  HORIZON_STATUS_MAP,
};
