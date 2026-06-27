import { AssetNotFoundError } from '../src/errors/AssetNotFoundError.js';

describe('AssetNotFoundError', () => {
  const err = new AssetNotFoundError('USDC', 'GA5Z');

  it('is an instance of Error', () => expect(err).toBeInstanceOf(Error));
  it('has name AssetNotFoundError', () => expect(err.name).toBe('AssetNotFoundError'));
  it('has httpStatus 404', () => expect(err.httpStatus).toBe(404));
  it('has type ASSET_NOT_FOUND', () => expect(err.type).toBe('ASSET_NOT_FOUND'));
  it('includes asset code in message', () => expect(err.message).toContain('USDC'));
  it('includes issuer in message', () => expect(err.message).toContain('GA5Z'));
  it('toJSON returns structured error', () => {
    const j = err.toJSON();
    expect(j.success).toBe(false);
    expect(j.error.type).toBe('ASSET_NOT_FOUND');
    expect(j.error.asset.code).toBe('USDC');
  });
  it('includes hint', () => expect(err.toJSON().error.hint).toBeTruthy());
});
