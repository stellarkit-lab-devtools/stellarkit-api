const { normalizeAsset } = require("./asset");
const { toISOTimestamp } = require("./response");

function toSevenDecimalString(value) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "0.0000000";
  return parsed.toFixed(7);
}

function tradePrice(trade) {
  const priceN = trade.price && trade.price.n;
  const priceD = trade.price && trade.price.d;
  if (priceN != null && priceD != null && Number(priceD) !== 0) {
    return toSevenDecimalString(Number(priceN) / Number(priceD));
  }
  return "0.0000000";
}

/**
 * Maps a raw Horizon trade onto the normalised StellarKit shape.
 *
 * selling/buying/soldAmount/boughtAmount are taken from the queried
 * account's side of the trade (not always the Horizon "base" side).
 *
 * @param {object} trade - Raw Horizon trade record.
 * @param {string} accountId - The account the trades were requested for.
 * @returns {object} CamelCase trade object.
 */
function mapAccountTrade(trade, accountId) {
  const baseAsset = normalizeAsset(
    trade.base_asset_code,
    trade.base_asset_issuer,
    trade.base_asset_type,
  );
  const counterAsset = normalizeAsset(
    trade.counter_asset_code,
    trade.counter_asset_issuer,
    trade.counter_asset_type,
  );

  const accountIsBase = trade.base_account === accountId;
  const soldBaseAsset = accountIsBase === Boolean(trade.base_is_seller);

  const selling = soldBaseAsset ? baseAsset : counterAsset;
  const buying = soldBaseAsset ? counterAsset : baseAsset;
  const soldAmount = toSevenDecimalString(
    soldBaseAsset ? trade.base_amount : trade.counter_amount,
  );
  const boughtAmount = toSevenDecimalString(
    soldBaseAsset ? trade.counter_amount : trade.base_amount,
  );

  return {
    tradeId: trade.id,
    id: trade.id,
    pagingToken: trade.paging_token,
    ledgerCloseTime: toISOTimestamp(trade.ledger_close_time),
    offerId: trade.offer_id,
    selling,
    buying,
    soldAmount,
    boughtAmount,
    tradeType: trade.base_is_seller ? "sell" : "buy",
    baseAccount: trade.base_account,
    baseAmount: toSevenDecimalString(trade.base_amount),
    baseAsset,
    counterAccount: trade.counter_account,
    counterAmount: toSevenDecimalString(trade.counter_amount),
    counterAsset,
    price: tradePrice(trade),
  };
}

module.exports = { mapAccountTrade, toSevenDecimalString };
