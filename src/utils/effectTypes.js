/**
 * Valid Horizon effect type strings (see Stellar SDK EffectType enum).
 */
const VALID_EFFECT_TYPES = [
  "account_created",
  "account_removed",
  "account_credited",
  "account_debited",
  "account_thresholds_updated",
  "account_home_domain_updated",
  "account_flags_updated",
  "account_inflation_destination_updated",
  "signer_created",
  "signer_removed",
  "signer_updated",
  "trustline_created",
  "trustline_removed",
  "trustline_updated",
  "trustline_authorized",
  "trustline_deauthorized",
  "trustline_authorized_to_maintain_liabilities",
  "trustline_flags_updated",
  "offer_created",
  "offer_removed",
  "offer_updated",
  "trade",
  "data_created",
  "data_removed",
  "data_updated",
  "sequence_bumped",
  "claimable_balance_created",
  "claimable_balance_claimant_created",
  "claimable_balance_claimed",
  "account_sponsorship_created",
  "account_sponsorship_updated",
  "account_sponsorship_removed",
  "trustline_sponsorship_created",
  "trustline_sponsorship_updated",
  "trustline_sponsorship_removed",
  "data_sponsorship_created",
  "data_sponsorship_updated",
  "data_sponsorship_removed",
  "claimable_balance_sponsorship_created",
  "claimable_balance_sponsorship_updated",
  "claimable_balance_sponsorship_removed",
  "signer_sponsorship_created",
  "signer_sponsorship_updated",
  "signer_sponsorship_removed",
  "claimable_balance_clawed_back",
  "liquidity_pool_deposited",
  "liquidity_pool_withdrew",
  "liquidity_pool_trade",
  "liquidity_pool_created",
  "liquidity_pool_removed",
  "liquidity_pool_revoked",
  "contract_credited",
  "contract_debited",
];

/**
 * Validates an optional effect type query parameter.
 *
 * @param {string} type - Effect type from req.query.type
 * @throws {Error} Validation error when type is not recognised
 */
function validateEffectType(type) {
  if (!VALID_EFFECT_TYPES.includes(type)) {
    const err = new Error(
      `Unrecognised effect type "${type}". Valid types are: ${VALID_EFFECT_TYPES.join(", ")}.`
    );
    err.isValidation = true;
    err.field = "type";
    err.receivedValue = type;
    throw err;
  }
}

module.exports = { VALID_EFFECT_TYPES, validateEffectType };
