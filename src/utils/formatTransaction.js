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
    ledger: typeof tx.ledger === "number" ? tx.ledger : tx.ledger_attr,
    created_at: toISOTimestamp(tx.created_at),
    source_account: tx.source_account,
    fee_charged: tx.fee_charged,
    operation_count: tx.operation_count,
    envelope_xdr: tx.envelope_xdr,
    result_xdr: tx.result_xdr,
    result_meta_xdr: tx.result_meta_xdr,
    memo_type: tx.memo_type,
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
