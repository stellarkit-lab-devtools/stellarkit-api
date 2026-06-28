import { clearTrustlinesCache, TRUSTLINES_CACHE_TTL_MS } from '../src/middlewares/trustlinesCache.js';

describe('trustlines cache', () => {
  afterEach(() => clearTrustlinesCache());

  it('has a positive TTL', () => expect(TRUSTLINES_CACHE_TTL_MS).toBeGreaterThan(0));
  it('defaults to 15000ms', () => expect(TRUSTLINES_CACHE_TTL_MS).toBe(15000));
  it('clearTrustlinesCache does not throw', () => expect(() => clearTrustlinesCache()).not.toThrow());
});
