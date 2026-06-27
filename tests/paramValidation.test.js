import { requireParams } from '../src/middlewares/paramValidation.js';

const mockRes = () => {
  const r = {};
  r.status = jest.fn().mockReturnValue(r);
  r.json = jest.fn().mockReturnValue(r);
  return r;
};

describe('requireParams middleware', () => {
  it('calls next when param is valid', () => {
    const next = jest.fn();
    requireParams('id')({ params: { id: 'GABC123' } }, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });
  it('returns 400 for empty string param', () => {
    const res = mockRes(); const next = jest.fn();
    requireParams('id')({ params: { id: ''} }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
  it('returns 400 for whitespace-only param', () => {
    const res = mockRes(); const next = jest.fn();
    requireParams('id')({ params: { id: '   ' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it('validates multiple params', () => {
    const next = jest.fn();
    requireParams('code','issuer')({ params: { code: 'USDC', issuer: 'GA5Z' } }, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });
  it('returns error message mentioning the param name', () => {
    const res = mockRes();
    requireParams('id')({ params: { id: ''} }, res, jest.fn());
    expect(res.json.mock.calls[0][0].error.message).toContain('id');
  });
});
