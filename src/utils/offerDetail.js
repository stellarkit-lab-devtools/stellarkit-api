const { normalizeAsset } = require("./asset");
const { formatAmount } = require("./formatAmount");

const SCALE = 10000000n;
function stroops(value) {
  const [whole, fraction] = formatAmount(value).split(".");
  return BigInt(whole) * SCALE + BigInt(fraction);
}
function decimal(value) {
  return `${value / SCALE}.${(value % SCALE).toString().padStart(7, "0")}`;
}
function ratio(numerator, denominator) {
  const n = BigInt(numerator), d = BigInt(denominator);
  if (d <= 0n) throw new Error("Invalid Horizon price denominator");
  return decimal((n * SCALE + d / 2n) / d);
}
function asset(record, prefix = "") {
  return normalizeAsset(record[`${prefix}asset_code`], record[`${prefix}asset_issuer`], record[`${prefix}asset_type`]);
}
function offerDetail(offerId, offer, trades) {
  const first = trades[0];
  // Horizon offer trades identify which side supplied the offer. Its selling
  // amount is always used, so all fill amounts share the offer's selling asset.
  const baseSide = (trade) => String(trade.base_offer_id) === offerId;
  const fills = trades.map((trade) => {
    const base = baseSide(trade);
    return {
      tradeId: trade.id,
      ledgerCloseTime: trade.ledger_close_time,
      amount: formatAmount(base ? trade.base_amount : trade.counter_amount),
      price: base ? ratio(trade.price.n, trade.price.d) : ratio(trade.price.d, trade.price.n),
      counterAccount: (base ? trade.counter_account : trade.base_account) || null,
    };
  });
  const base = first && baseSide(first);
  return {
    offerId,
    status: offer ? "open" : "closed",
    seller: offer ? offer.seller : (base ? first.base_account : first.counter_account) || null,
    selling: offer ? asset(offer.selling) : asset(first, base ? "base_" : "counter_"),
    buying: offer ? asset(offer.buying) : asset(first, base ? "counter_" : "base_"),
    amount: offer ? formatAmount(offer.amount) : null,
    price: offer ? (offer.price_r ? ratio(offer.price_r.n, offer.price_r.d) : formatAmount(offer.price)) : null,
    sponsor: offer ? offer.sponsor || null : null,
    lastModifiedLedger: offer ? offer.last_modified_ledger : null,
    fills,
    // Total of the returned fills, bounded by fillLimit.
    totalFilledAmount: decimal(fills.reduce((total, fill) => total + stroops(fill.amount), 0n)),
  };
}

module.exports = { offerDetail };
