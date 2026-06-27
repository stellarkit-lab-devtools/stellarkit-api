const FeesModule = require('../sdk/fees.js');

const mockClient = { _request: jest.fn() };
beforeEach(() => mockClient._request.mockClear());

describe('FeesModule', () => {
  let fees;
  beforeEach(() => { fees = new FeesModule(mockClient); });

  it('getFeeEstimate calls /fee-estimate', async () => {
    mockClient._request.mockResolvedValue({ base_fee: 100 });
    await fees.getFeeEstimate();
    expect(mockClient._request).toHaveBeenCalledWith('GET', '/fee-estimate');
  });

  it('getFeeEstimate with fresh=true appends query param', async () => {
    mockClient._request.mockResolvedValue({ base_fee: 100 });
    await fees.getFeeEstimate({ fresh: true });
    expect(mockClient._request).toHaveBeenCalledWith('GET', '/fee-estimate?fresh=true');
  });

  it('getSurgeStatus calls /fee-estimate/surge', async () => {
    mockClient._request.mockResolvedValue({ is_surge: false });
    await fees.getSurgeStatus();
    expect(mockClient._request).toHaveBeenCalledWith('GET', '/fee-estimate/surge');
  });

  it('getFeeTrends calls /fee-estimate/trends', async () => {
    mockClient._request.mockResolvedValue({ trends: [] });
    await fees.getFeeTrends();
    expect(mockClient._request).toHaveBeenCalledWith('GET', '/fee-estimate/trends');
  });

  it('getFeeEstimate returns typed response', async () => {
    mockClient._request.mockResolvedValue({ base_fee: 100, fee_charged: { p50: '200' } });
    const result = await fees.getFeeEstimate();
    expect(result.base_fee).toBe(100);
    expect(result.fee_charged.p50).toBe('200');
  });
});
