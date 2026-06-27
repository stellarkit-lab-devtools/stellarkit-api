const { translateHorizonError, horizonErrors } = require('../src/utils/horizonErrors');

describe('translateHorizonError', () => {
  it('translates op_no_trust correctly', () => {
    const result = translateHorizonError('op_no_trust');
    expect(result.code).toBe('op_no_trust');
    expect(result.message).toBeTruthy();
    expect(result.hint).toBeTruthy();
  });

  it('translates op_line_full correctly', () => {
    const result = translateHorizonError('op_line_full');
    expect(result.code).toBe('op_line_full');
    expect(result.message).toContain('full');
  });

  it('translates op_not_authorized correctly', () => {
    const result = translateHorizonError('op_not_authorized');
    expect(result.message).toBeTruthy();
  });

  it('translates op_offer_not_found correctly', () => {
    const result = translateHorizonError('op_offer_not_found');
    expect(result.code).toBe('op_offer_not_found');
  });

  it('translates op_low_reserve correctly', () => {
    const result = translateHorizonError('op_low_reserve');
    expect(result.code).toBe('op_low_reserve');
  });

  it('translates op_cross_self correctly', () => {
    const result = translateHorizonError('op_cross_self');
    expect(result.hint).toBeTruthy();
  });

  it('translates op_no_issuer correctly', () => {
    const result = translateHorizonError('op_no_issuer');
    expect(result.message).toContain('issuer');
  });

  it('returns fallback for unknown code', () => {
    const result = translateHorizonError('op_totally_unknown');
    expect(result.message).toContain('Unknown');
    expect(result.hint).toBeTruthy();
  });

  it('covers all expected result codes', () => {
    const required = ['op_no_trust','op_line_full','op_not_authorized','op_no_issuer','op_offer_not_found','op_low_reserve','op_cross_self'];
    for (const code of required) {
      const result = translateHorizonError(code);
      expect(result.code).toBe(code);
    }
  });
});
