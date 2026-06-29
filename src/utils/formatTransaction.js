const { toISOTimestamp } = require("./response");

/**
 * Formats a Horizon transaction record into a clean SSE payload.
 *
 * @param {import('@stellar/stellar-sdk').Horizon.ServerApi.TransactionRecord} tx - The transaction record from Horizon
 * @returns {Object} Formatted transaction object for SSE streaming
 */
function formatTransaction(tx) {
  return {
    id: tx.id,
    hash: tx.hash,
    ledger: tx.ledger,
    createdAt: toISOTimestamp(tx.created_at),
    sourceAccount: tx.source_account,
    feeCharged: tx.fee_charged,
    operationCount: tx.operation_count,
    envelopeXdr: tx.envelope_xdr,
    resultXdr: tx.result_xdr,
    resultMetaXdr: tx.result_meta_xdr,
    memoType: tx.memo_type,
    memo: tx.memo ?? null,
    successful: tx.successful,
  };
}

module.exports = { formatTransaction };
