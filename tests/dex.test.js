const DexModule = require('../sdk/dex.js');

const mockClient = {
  _request: jest.fn()
};

beforeEach(() => mockClient._request.mockClear());

describe('DexModule - serializeAsset', () => {
  let dex;
  beforeEach(() => { dex = new DexModule(mockClient); });

  it('accepts plain string asset', async () => {
    mockClient._request.mockResolvedValue({ bid: '1.0', ask: '1.1', spread: '0.1' });
    await dex.getSpread('XLM', 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN');
    expect(mockClient._request).toHaveBeenCalledWith('GET', expect.stringContaining('XLM'));
  });

  it('serializes object asset to CODE:ISSUER format', async () => {
    mockClient._request.mockResolvedValue({ bid: '1.0', ask: '1.1', spread: '0.1' });
    await dex.getSpread({ code: 'USDC', issuer: 'GA5Z' }, 'XLM');
    expect(mockClient._request).toHaveBeenCalledWith('GET', expect.stringContaining('USDC%3AGA5Z'));
  });

  it('getSpread calls /dex/spread', async () => {
    mockClient._request.mockResolvedValue({});
    await dex.getSpread('XLM', 'USDC:ISSUER');
    expect(mockClient._request).toHaveBeenCalledWith('GET', expect.stringContaining('/dex/spread'));
  });

  it('getImbalance calls /dex/imbalance', async () => {
    mockClient._request.mockResolvedValue({});
    await dex.getImbalance('XLM', 'USDC:ISSUER');
    expect(mockClient._request).toHaveBeenCalledWith('GET', expect.stringContaining('/dex/imbalance'));
  });

  it('getArbitrage calls /dex/arbitrage', async () => {
    mockClient._request.mockResolvedValue({});
    await dex.getArbitrage('USDC', 'GA5Z');
    expect(mockClient._request).toHaveBeenCalledWith('GET', expect.stringContaining('/dex/arbitrage'));
  });

  it('getOrderBook calls /dex/orderbook', async () => {
    mockClient._request.mockResolvedValue({ bids: [], asks: [] });
    await dex.getOrderBook('XLM', 'USDC:ISSUER');
    expect(mockClient._request).toHaveBeenCalledWith('GET', expect.stringContaining('/dex/orderbook'));
  });
});
