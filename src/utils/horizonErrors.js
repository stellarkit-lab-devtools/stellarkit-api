/**
 * Plain-English translations for common Horizon error codes.
 */
const HORIZON_ERROR_MESSAGES = {
  tx_bad_seq: "Transaction sequence number does not match the account's current sequence. Reload the account and rebuild the transaction.",
  tx_insufficient_fee: "Transaction fee is too low. Increase the fee or use the current base fee from Horizon multiplied by the number of operations.",
  tx_bad_auth: "Transaction is missing a required signature or has an invalid signature. Sign with all required signers and verify the network passphrase.",
  tx_no_source_account: "The source account does not exist on the network.",
  tx_bad_auth_extra: "Transaction has too many signatures. Remove unnecessary signatures.",
  tx_internal_error: "An internal Horizon error occurred. Try again later.",
  tx_not_supported: "This transaction type is not supported on the current network.",
  tx_fee_bump_inner_failed: "The inner transaction in a fee-bump transaction failed.",
  op_no_destination: "The destination account does not exist. Create the account first with a createAccount operation.",
  op_no_trust: "The destination account does not have a trustline for this asset. The destination must create a trustline before receiving the asset.",
  op_line_full: "The destination trustline is full. The destination account must raise its trustline limit or reduce the payment amount.",
  op_underfunded: "The source account does not have enough funds. Add funds or reduce the operation amount.",
  op_low_reserve: "The operation would leave the account below the minimum XLM reserve. Keep more XLM in the account or remove unused subentries.",
  op_bad_auth: "The operation is missing a required authorization or has an invalid signature.",
  op_no_account: "The account does not exist on the network.",
  op_not_authorized: "The source account is not authorized to perform this operation on the given asset.",
  op_malformed: "The operation is malformed or contains invalid parameters.",
};

/**
 * Translate a Horizon error code to a plain-English message.
 *
 * @param {string} code - Horizon result code (e.g. "tx_bad_seq")
 * @returns {string|null} Human-readable message, or null if not found
 */
function translateHorizonError(code) {
  return HORIZON_ERROR_MESSAGES[code] || null;
}

module.exports = { translateHorizonError, HORIZON_ERROR_MESSAGES };
