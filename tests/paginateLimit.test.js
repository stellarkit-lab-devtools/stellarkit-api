import { parseLimit, DEFAULT_LIMIT, MAX_LIMIT } from '../src/middlewares/paginateLimit.js';

describe('parseLimit', () => {
  it('defaults to 20 when undefined', () => expect(parseLimit(undefined).limit).toBe(DEFAULT_LIMIT));
  it('defaults to 20 for empty string', () => expect(parseLimit('').limit).toBe(DEFAULT_LIMIT));
  it('accepts valid integer', () => expect(parseLimit('50').limit).toBe(50));
  it('caps at 200', () => expect(parseLimit('999').limit).toBe(MAX_LIMIT));
  it('rejects non-numeric', () => expect(parseLimit('abc').error).toBeTruthy());
  it('rejects zero', () => expect(parseLimit('0').error).toBeTruthy());
  it('rejects negative', () => expect(parseLimit('-5').error).toBeTruthy());
  it('accepts 1', () => expect(parseLimit('1').limit).toBe(1));
});
