/**
 * AssetNotFoundError — thrown when an asset lookup returns no results
 * from Horizon (asset does not exist or has no activity on the network).
 */
export class AssetNotFoundError extends Error {
  /**
   * @param {string} code   - The asset code that was not found
   * @param {string} issuer - The issuer address that was not found
   */
  constructor(code, issuer) {
    super(`Asset ${code}:${issuer} was not found on the Stellar network.`);
    this.name = 'AssetNotFoundError';
    this.code = code;
    this.issuer = issuer;
    this.httpStatus = 404;
    this.type = 'ASSET_NOT_FOUND';
    this.hint = 'Verify the asset code and issuer address are correct and the asset has activity on the network.';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AssetNotFoundError);
    }
  }

  toJSON() {
    return {
      success: false,
      error: {
        type: this.type,
        message: this.message,
        hint: this.hint,
        asset: { code: this.code, issuer: this.issuer },
      },
    };
  }
}
