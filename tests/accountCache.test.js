import { clearAccountCache, ACCOUNT_CACHE_TTL_MS } from '../src/middlewares/accountCache.js';

describe('account cache', () => {
  afterEach(() => clearAccountCache());

  it('has a positive TTL', () => expect(ACCOUNT_CACHE_TTL_MS).toBeGreaterThan(0));
  it('defaults to 10000ms', () => expect(ACCOUNT_CACHE_TTL_MS).toBe(10000));
  it('clearAccountCache does not throw', () => expect(() => clearAccountCache()).not.toThrow());
});
