const { toISOTimestamp } = require("./response");
const { normalizeAsset } = require("./asset");

/**
 * Normalises a raw Horizon operation record into the API's operation shape.
 * Mirrors the format returned by GET /transactions/:id/operations, so the
 * same shape is used anywhere operations are embedded (e.g.
 * GET /account/:id/transactions?includeOperations=true).
 *
 * @param {object} op - Raw operation record from Horizon
 * @returns {object} Normalised operation
 */
function normalizeOperation(op) {
  const formatted = {
    id: op.id,
    type: op.type,
    createdAt: toISOTimestamp(op.created_at),
    transactionHash: op.transaction_hash,
    transactionSuccessful: op.transaction_successful,
    sourceAccount: op.source_account,
  };

  // Add type-specific fields
  if (op.type === "payment") {
    formatted.asset = normalizeAsset(
      op.asset_code || "XLM",
      op.asset_issuer || null,
      op.asset_type || "native",
    );
    formatted.amount = op.amount;
    formatted.from = op.from;
    formatted.to = op.to;
  } else if (op.type === "create_account") {
    formatted.startingBalance = op.starting_balance;
    formatted.funder = op.funder;
    formatted.account = op.account;
  } else if (op.type === "change_trust") {
    formatted.asset = normalizeAsset(op.asset_code, op.asset_issuer, op.asset_type);
    formatted.trustor = op.trustor;
    formatted.trustee = op.trustee;
  }

  return formatted;
}

module.exports = { normalizeOperation };
