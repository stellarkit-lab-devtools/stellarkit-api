/**
 * Expanded Horizon operation result code translations.
 * Covers the full set of common Stellar operation result codes.
 */

const horizonErrors = {
  // Payment / path payment
  op_malformed: { code: 'op_malformed', message: 'Operation is malformed', hint: 'Check operation parameters are valid' },
  op_underfunded: { code: 'op_underfunded', message: 'Source account has insufficient balance', hint: 'Add funds to your account' },
  op_src_no_trust: { code: 'op_src_no_trust', message: 'Source account has no trustline for asset', hint: 'Create a trustline before sending this asset' },
  op_src_not_authorized: { code: 'op_src_not_authorized', message: 'Source account not authorized to send asset', hint: 'Contact the asset issuer to authorize your account' },
  op_no_destination: { code: 'op_no_destination', message: 'Destination account does not exist', hint: 'Create the destination account first or check the address' },
  op_no_trust: { code: 'op_no_trust', message: 'Destination has no trustline for asset', hint: 'Ask the recipient to add a trustline for this asset' },
  op_line_full: { code: 'op_line_full', message: 'Destination trustline is full', hint: 'Recipient cannot receive more of this asset' },
  op_no_issuer: { code: 'op_no_issuer', message: 'Asset issuer does not exist', hint: 'Check the asset issuer address is valid' },
  op_not_authorized: { code: 'op_not_authorized', message: 'Account not authorized for this operation', hint: 'Ensure the account has the required authorization flags' },
  op_low_reserve: { code: 'op_low_reserve', message: 'Account has insufficient XLM reserve', hint: 'Add at least 0.5 XLM per additional subentry' },
  // Offers / DEX
  op_cross_self: { code: 'op_cross_self', message: 'Offer would cross one of your existing offers', hint: 'Cancel conflicting offers before placing this one' },
  op_sell_no_trust: { code: 'op_sell_no_trust', message: 'No trustline for asset being sold', hint: 'Create a trustline for the sell asset' },
  op_buy_no_trust: { code: 'op_buy_no_trust', message: 'No trustline for asset being bought', hint: 'Create a trustline for the buy asset' },
  op_sell_not_authorized: { code: 'op_sell_not_authorized', message: 'Not authorized to sell this asset', hint: 'Contact the asset issuer for authorization' },
  op_buy_not_authorized: { code: 'op_buy_not_authorized', message: 'Not authorized to buy this asset', hint: 'Contact the asset issuer for authorization' },
  op_offer_not_found: { code: 'op_offer_not_found', message: 'Offer not found', hint: 'The offer may have already been filled or cancelled' },
  op_offer_low_amount: { code: 'op_offer_low_amount', message: 'Offer amount too low', hint: 'Increase the offer amount' },
  // Trustlines
  op_invalid_limit: { code: 'op_invalid_limit', message: 'Invalid trustline limit', hint: 'Limit must be >= current balance and >= 0' },
  op_low_reserve_change: { code: 'op_low_reserve', message: 'Insufficient reserve for this change', hint: 'Ensure minimum XLM reserve is maintained' },
  // Account
  op_already_exists: { code: 'op_already_exists', message: 'Account already exists', hint: 'The destination account has already been created' },
  op_success: { code: 'op_success', message: 'Operation succeeded', hint: null },
};

/**
 * Translate a Horizon operation result code to a human-readable message.
 * @param {string} code - Horizon result code
 * @returns {{ code: string, message: string, hint: string|null }}
 */
const translateHorizonError = (code) => {
  return horizonErrors[code] || {
    code,
    message: `Unknown Horizon error: ${code}`,
    hint: 'Check the Stellar documentation for this result code',
  };
};

module.exports = { translateHorizonError, horizonErrors };
