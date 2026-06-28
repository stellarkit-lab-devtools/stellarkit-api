import { normaliseOffer, normaliseOffers } from '../src/utils/normaliseOffers.js';

const RAW = {
  id: '123456789',
  seller: 'GABC',
  selling: { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GA5Z' },
  buying:  { asset_type: 'native' },
  amount: '100.0000000',
  price:  '1.0500000',
  price_r: { n: 21, d: 20 },
  last_modified_ledger: 12345678,
  last_modified_time: '2026-06-27T00:00:00Z',
};

describe('normaliseOffer', () => {
  it('converts price_r fraction to decimal string', () => {
    const r = normaliseOffer(RAW);
    expect(r.price).toBe('1.0500000');
  });
  it('formats amount to 7 decimal places', () => {
    const r = normaliseOffer(RAW);
    expect(r.amount).toBe('100.0000000');
  });
  it('includes last_modified_ledger', () => {
    const r = normaliseOffer(RAW);
    expect(r.last_modified_ledger).toBe(12345678);
  });
  it('selling has asset_code and asset_issuer', () => {
    const r = normaliseOffer(RAW);
    expect(r.selling.asset_code).toBe('USDC');
    expect(r.selling.asset_issuer).toBe('GA5Z');
  });
  it('buying native has null issuer', () => {
    const r = normaliseOffer(RAW);
    expect(r.buying.asset_issuer).toBeNull();
  });
  it('normaliseOffers handles array', () => {
    const result = normaliseOffers([RAW, RAW]);
    expect(result).toHaveLength(2);
  });
  it('normaliseOffers handles empty', () => {
    expect(normaliseOffers([])).toHaveLength(0);
  });
});
