const StellarKitError = require('../src/utils/StellarKitError');

describe('StellarKitError', () => {
  it('is instanceof Error', () => {
    const e = new StellarKitError('test', 400, 'INVALID_REQUEST');
    expect(e).toBeInstanceOf(Error);
  });
  it('has correct name', () => {
    const e = new StellarKitError('test', 404, 'NOT_FOUND');
    expect(e.name).toBe('StellarKitError');
  });
  it('static notFound creates 404', () => {
    const e = StellarKitError.notFound();
    expect(e.status).toBe(404);
    expect(e.type).toBe('NOT_FOUND');
  });
  it('static invalidRequest creates 400', () => {
    const e = StellarKitError.invalidRequest('bad input');
    expect(e.status).toBe(400);
  });
  it('toJSON returns structured object', () => {
    const e = StellarKitError.upstreamError('horizon down');
    const j = e.toJSON();
    expect(j.type).toBe('UPSTREAM_ERROR');
    expect(j.status).toBe(502);
    expect(j.message).toBe('horizon down');
  });
});
