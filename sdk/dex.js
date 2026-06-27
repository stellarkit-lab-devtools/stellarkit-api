/**
 * StellarKit DEX Module
 * Wraps all /dex/* routes into typed methods.
 * Asset parameters accept either a plain string "CODE:ISSUER"
 * or a typed { code, issuer } object.
 */

const serializeAsset = (asset) => {
  if (typeof asset === 'string') return asset;
  if (asset.code === 'native' || asset.issuer === 'native') return 'XLM';
  return `${asset.code}:${asset.issuer}`;
};

/**
 * DEX module for StellarKit.
 */
class DexModule {
  constructor(client) {
    this._client = client;
  }

  /**
   * Get the current bid/ask spread between two assets.
   * @param {string|{code:string,issuer:string}} sellAsset
   * @param {string|{code:string,issuer:string}} buyAsset
   * @returns {Promise<{bid:string,ask:string,spread:string}>}
   */
  async getSpread(sellAsset, buyAsset) {
    const sell = serializeAsset(sellAsset);
    const buy = serializeAsset(buyAsset);
    return this._client._request('GET', `/dex/spread?sell=${encodeURIComponent(sell)}&buy=${encodeURIComponent(buy)}`);
  }

  /**
   * Get the imbalance between two assets on the DEX.
   * @param {string|{code:string,issuer:string}} sellAsset
   * @param {string|{code:string,issuer:string}} buyAsset
   * @returns {Promise<{imbalance:string}>}
   */
  async getImbalance(sellAsset, buyAsset) {
    const sell = serializeAsset(sellAsset);
    const buy = serializeAsset(buyAsset);
    return this._client._request('GET', `/dex/imbalance?sell=${encodeURIComponent(sell)}&buy=${encodeURIComponent(buy)}`);
  }

  /**
   * Get arbitrage opportunities for an asset.
   * @param {string} code - Asset code
   * @param {string} issuer - Asset issuer
   * @returns {Promise<object>}
   */
  async getArbitrage(code, issuer) {
    return this._client._request('GET', `/dex/arbitrage?code=${encodeURIComponent(code)}&issuer=${encodeURIComponent(issuer)}`);
  }

  /**
   * Get the full order book for two assets.
   * @param {string|{code:string,issuer:string}} sellAsset
   * @param {string|{code:string,issuer:string}} buyAsset
   * @returns {Promise<{bids:Array,asks:Array}>}
   */
  async getOrderBook(sellAsset, buyAsset) {
    const sell = serializeAsset(sellAsset);
    const buy = serializeAsset(buyAsset);
    return this._client._request('GET', `/dex/orderbook?sell=${encodeURIComponent(sell)}&buy=${encodeURIComponent(buy)}`);
  }
}

module.exports = DexModule;
