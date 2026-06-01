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
    created_at: tx.created_at,
    source_account: tx.source_account,
    fee_charged: tx.fee_charged,
    operation_count: tx.operation_count,
    envelope_xdr: tx.envelope_xdr,
    result_xdr: tx.result_xdr,
    result_meta_xdr: tx.result_meta_xdr,
    memo_type: tx.memo_type,
    memo: tx.memo ?? null,
    successful: tx.successful,
  };
}

module.exports = { formatTransaction };
