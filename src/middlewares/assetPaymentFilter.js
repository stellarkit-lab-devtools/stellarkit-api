/**
 * Middleware: filter payment results by asset.
 *
 * Validates optional ?assetCode and ?assetIssuer query parameters,
 * then filters the Horizon payment records to only those involving
 * the specified asset. Both params are optional but if assetIssuer
 * is provided without assetCode a 400 is returned.
 */

/**
 * Parse and validate asset filter params from a request.
 * @param {import('express').Request} req
 * @returns {{ assetCode?: string, assetIssuer?: string, error?: string }}
 */
export function parseAssetFilter(req) {
  const { assetCode, assetIssuer } = req.query;

  if (assetIssuer && !assetCode) {
    return { error: 'assetIssuer requires assetCode to be specified' };
  }
  if (assetCode && typeof assetCode !== 'string') {
    return { error: 'assetCode must be a string' };
  }
  if (assetIssuer && typeof assetIssuer !== 'string') {
    return { error: 'assetIssuer must be a string' };
  }
  return { assetCode: assetCode || undefined, assetIssuer: assetIssuer || undefined };
}

/**
 * Filter a list of Horizon payment records by asset.
 *
 * @param {object[]} payments   - Raw payment records from Horizon
 * @param {string}   assetCode  - Asset code to filter by (e.g. 'USDC')
 * @param {string}   [assetIssuer] - Asset issuer address (optional; narrows further)
 * @returns {object[]}
 */
export function filterPaymentsByAsset(payments, assetCode, assetIssuer) {
  return payments.filter(p => {
    const matchesCode  = p.asset_code === assetCode || (assetCode === 'XLM' && p.asset_type === 'native');
    const matchesIssuer = !assetIssuer || p.asset_issuer === assetIssuer;
    return matchesCode && matchesIssuer;
  });
}
