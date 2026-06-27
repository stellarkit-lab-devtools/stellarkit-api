/**
 * StellarKit Fees Module
 * Wraps all /fee-estimate/* routes into typed methods.
 * Throws StellarKitError on failure.
 */

const { StellarKitError } = require('./stellarkit-client.js') || {};

class FeesModule {
  constructor(client) {
    this._client = client;
  }

  /**
   * Get the current fee estimate.
   * @param {object} [opts]
   * @param {boolean} [opts.fresh=false] - Append ?fresh=true to bypass cache
   * @returns {Promise<{base_fee:number,fee_charged:object}>}
   */
  async getFeeEstimate(opts = {}) {
    const qs = opts.fresh ? '?fresh=true' : '';
    return this._client._request('GET', `/fee-estimate${qs}`);
  }

  /**
   * Get current surge pricing status.
   * @returns {Promise<{is_surge:boolean,surge_multiplier:number}>}
   */
  async getSurgeStatus() {
    return this._client._request('GET', '/fee-estimate/surge');
  }

  /**
   * Get fee trends over time.
   * @returns {Promise<{trends:Array}>}
   */
  async getFeeTrends() {
    return this._client._request('GET', '/fee-estimate/trends');
  }
}

module.exports = FeesModule;
