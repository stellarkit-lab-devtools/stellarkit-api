const { handleAccountNotFound } = require('../src/middlewares/accountNotFound');

describe('handleAccountNotFound middleware', () => {
  const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };
  const mockReq = (path = '/account/GABC', params = { id: 'GABC' }) => ({ path, params });

  it('handles 404 status for account path', () => {
    const res = mockRes();
    const next = jest.fn();
    handleAccountNotFound({ status: 404 }, mockReq(), res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(next).not.toHaveBeenCalled();
  });
  it('returns ACCOUNT_NOT_FOUND type', () => {
    const res = mockRes();
    handleAccountNotFound({ status: 404 }, mockReq(), res, jest.fn());
    expect(res.json.mock.calls[0][0].error.type).toBe('ACCOUNT_NOT_FOUND');
  });
  it('passes through non-404 errors', () => {
    const next = jest.fn();
    handleAccountNotFound({ status: 500 }, mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });
  it('includes account address in response', () => {
    const res = mockRes();
    handleAccountNotFound({ status: 404 }, mockReq(), res, jest.fn());
    expect(res.json.mock.calls[0][0].error.address).toBe('GABC');
  });
});
