import { validateOrder } from '../src/middlewares/orderParam.js';

describe('validateOrder', () => {
  it('defaults to desc when undefined', () => {
    expect(validateOrder(undefined).order).toBe('desc');
  });
  it('accepts asc', () => {
    expect(validateOrder('asc').order).toBe('asc');
  });
  it('accepts desc', () => {
    expect(validateOrder('desc').order).toBe('desc');
  });
  it('normalises uppercase', () => {
    expect(validateOrder('ASC').order).toBe('asc');
  });
  it('returns error for invalid value', () => {
    const r = validateOrder('random');
    expect(r.error).toContain('Invalid order');
  });
  it('does not set error on valid input', () => {
    expect(validateOrder('asc').error).toBeUndefined();
  });
});
