'use strict';

const request = require('supertest');

// Mock the Stellar config module so we can control the orderbook response.
jest.mock('../../config/stellar', () => {
  const call = jest.fn();
  const limit = jest.fn(() => ({ call }));
  const orderbook = jest.fn(() => ({ limit }));
  return {
    server: {
      orderbook,
    },
    __mocks: { orderbook, limit, call },
  };
});

const stellarConfig = require('../../config/stellar');
const app = require('../../app');

const { orderbook, limit, call } = stellarConfig.__mocks;

/**
 * Helper to build a controlled orderbook response.
 * bids/asks are arrays of [price, amount] string pairs as returned by Stellar.
 */
function buildOrderbook({ bids = [], asks = [] } = {}) {
  return {
    bids: bids.map(([price, amount]) => ({ price, amount })),
    asks: asks.map(([price, amount]) => ({ price, amount })),
  };
}

describe('GET /dex/price-impact/:sellAsset/:buyAsset', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Re-wire the chain after clearing.
    limit.mockImplementation(() => ({ call }));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns a low priceImpactPercent for a small trade on a deep order book', async () => {
    // Deep book: large amounts at each price level.
    const deepBook = buildOrderbook({
      bids: [
        ['1.00', '1000000'],
        ['0.99', '1000000'],
        ['0.98', '1000000'],
      ],
      asks: [
        ['1.01', '1000000'],
        ['1.02', '1000000'],
        ['1.03', '1000000'],
      ],
    });
    call.mockResolvedValue(deepBook);

    const res = await request(app)
      .get('/dex/price-impact/XLM/USDC')
      .query({ amount: '10' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('priceImpactPercent');
    expect(typeof res.body.priceImpactPercent).toBe('number');
    expect(res.body.priceImpactPercent).toBeGreaterThanOrEqual(0);
    // Small trade against deep liquidity should have a very low impact.
    expect(res.body.priceImpactPercent).toBeLessThan(1);
    expect(res.body.warning).toBeFalsy();
    expect(orderbook).toHaveBeenCalledWith('XLM', 'USDC');
  });

  it('returns a high priceImpactPercent with a warning for a large trade on a thin order book', async () => {
    // Thin book: tiny amounts at each price level.
    const thinBook = buildOrderbook({
      bids: [
        ['1.00', '1'],
        ['0.90', '1'],
      ],
      asks: [
        ['1.10', '1'],
        ['1.50', '1'],
      ],
    });
    call.mockResolvedValue(thinBook);

    const res = await request(app)
      .get('/dex/price-impact/XLM/USDC')
      .query({ amount: '1000' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('priceImpactPercent');
    expect(typeof res.body.priceImpactPercent).toBe('number');
    // Large trade against thin liquidity should have a high impact.
    expect(res.body.priceImpactPercent).toBeGreaterThan(5);
    expect(res.body.warning).toBeTruthy();
  });

  it('returns 400 when the amount query param is missing', async () => {
    const res = await request(app).get('/dex/price-impact/XLM/USDC');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    // Should not have hit the orderbook at all.
    expect(orderbook).not.toHaveBeenCalled();
  });

  it('returns 400 when the amount query param is non-numeric', async () => {
    const res = await request(app)
      .get('/dex/price-impact/XLM/USDC')
      .query({ amount: 'not-a-number' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(orderbook).not.toHaveBeenCalled();
  });

  it('returns an OrderBookEmpty error when no order book exists', async () => {
    call.mockResolvedValue(buildOrderbook({ bids: [], asks: [] }));

    const res = await request(app)
      .get('/dex/price-impact/XLM/USDC')
      .query({ amount: '10' });

    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = JSON.stringify(res.body);
    expect(body).toMatch(/OrderBookEmpty/);
  });
});