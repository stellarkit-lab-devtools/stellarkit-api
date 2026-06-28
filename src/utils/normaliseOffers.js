/**
 * Normalise a raw Horizon offer record into the StellarKit standard shape.
 * Converts price_r fraction to decimal string, snake_cases all fields,
 * and formats amounts with consistent decimal precision.
 *
 * @param {object} raw - Raw Horizon offer record
 * @returns {object} Normalised offer
 */
export function normaliseOffer(raw) {
  const price = raw.price_r
    ? (raw.price_r.n / raw.price_r.d).toFixed(7)
    : raw.price;

  return {
    id:                   String(raw.id),
    seller:               raw.seller,
    selling: {
      asset_type:   raw.selling?.asset_type || 'native',
      asset_code:   raw.selling?.asset_code   || 'XLM',
      asset_issuer: raw.selling?.asset_issuer || null,
    },
    buying: {
      asset_type:   raw.buying?.asset_type || 'native',
      asset_code:   raw.buying?.asset_code   || 'XLM',
      asset_issuer: raw.buying?.asset_issuer || null,
    },
    amount:               parseFloat(raw.amount).toFixed(7),
    price:                price,
    last_modified_ledger: raw.last_modified_ledger ?? null,
    last_modified_time:   raw.last_modified_time   ?? null,
  };
}

/**
 * Normalise an array of raw Horizon offer records.
 * @param {object[]} raws
 * @returns {object[]}
 */
export function normaliseOffers(raws) {
  return Array.isArray(raws) ? raws.map(normaliseOffer) : [];
}
