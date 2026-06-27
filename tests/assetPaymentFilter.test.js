import { parseAssetFilter, filterPaymentsByAsset } from '../src/middlewares/assetPaymentFilter.js';

const PAYMENTS = [
  { asset_code: 'USDC', asset_issuer: 'GA5Z', amount: '100' },
  { asset_code: 'USDC', asset_issuer: 'GOTHER', amount: '50' },
  { asset_type: 'native', amount: '10' },
  { asset_code: 'BTC', asset_issuer: 'GBTC', amount: '0.01' },
];

describe('parseAssetFilter', () => {
  it('returns empty filter when no params', () => {
    const r = parseAssetFilter({ query: {} });
    expect(r.error).toBeUndefined();
    expect(r.assetCode).toBeUndefined();
  });
  it('rejects assetIssuer without assetCode', () => {
    const r = parseAssetFilter({ query: { assetIssuer: 'GA5Z' } });
    expect(r.error).toContain('assetIssuer requires');
  });
  it('accepts assetCode alone', () => {
    const r = parseAssetFilter({ query: { assetCode: 'USDC' } });
    expect(r.assetCode).toBe('USDC');
    expect(r.error).toBeUndefined();
  });
});

describe('filterPaymentsByAsset', () => {
  it('filters by code only', () => {
    const result = filterPaymentsByAsset(PAYMENTS, 'USDC');
    expect(result).toHaveLength(2);
  });
  it('filters by code and issuer', () => {
    const result = filterPaymentsByAsset(PAYMENTS, 'USDC', 'GA5Z');
    expect(result).toHaveLength(1);
    expect(result[0].asset_issuer).toBe('GA5Z');
  });
  it('matches native XLM by code', () => {
    const result = filterPaymentsByAsset(PAYMENTS, 'XLM');
    expect(result).toHaveLength(1);
    expect(result[0].asset_type).toBe('native');
  });
  it('returns empty when no match', () => {
    const result = filterPaymentsByAsset(PAYMENTS, 'DOGE');
    expect(result).toHaveLength(0);
  });
});
