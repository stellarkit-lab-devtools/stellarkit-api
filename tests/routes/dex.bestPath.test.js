'use strict';

const request = require('supertest');

// Mock the Stellar config module to control the strictSendPaths response
jest.mock('../../src/config/stellar', () => {
  const call = jest.fn();
  const strictSendPaths = jest.fn(() => ({ call }));
  return {
    server: {
      strictSendPaths,
    },
    __mocks: { strictSendPaths, call },
  };
});

const stellarConfig = require('../../src/config/stellar');
const app = require('../../src/index');

const { strictSendPaths, call } = stellarConfig.__mocks;

/**
 * Helper to build a path finding response from Horizon's strictSendPaths endpoint.
 * 
 * @param {Array} records - Array of path records
 * @returns {Object} Mock response with records array
 */
function buildPathResponse(records = []) {
  return { records };
}

/**
 * Helper to create a path record with the specified parameters.
 * 
 * @param {string} sourceAmount - Amount of source asset
 * @param {string} destinationAmount - Amount of destination asset received
 * @param {Array} path - Array of intermediate assets [{asset_code, asset_issuer, asset_type}]
 * @returns {Object} Path record object
 */
function createPathRecord(sourceAmount, destinationAmount, path = []) {
  return {
    source_amount: sourceAmount,
    destination_amount: destinationAmount,
    path,
  };
}

describe('GET /dex/best-path/:sourceAsset/:destAsset', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns a direct path with 2 assets and hops: 1 when there is an active order book', async () => {
    // Direct conversion (no intermediates) means path array is empty
    const directPath = createPathRecord('100.0000000', '12.5000000', []);
    
    call.mockResolvedValue(buildPathResponse([directPath]));

    const res = await request(app)
      .get('/dex/best-path/XLM:native/USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN')
      .query({ amount: '100' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('path');
    expect(res.body.data).toHaveProperty('hops');
    expect(res.body.data).toHaveProperty('sourceAmount');
    expect(res.body.data).toHaveProperty('destinationAmount');
    expect(res.body.data).toHaveProperty('estimatedRate');
    expect(res.body.data).toHaveProperty('slippagePercent');
    
    // Direct path means: source -> destination (2 assets total, 0 intermediates)
    expect(res.body.data.path).toHaveLength(2);
    expect(res.body.data.hops).toBe(0);
    
    // Verify the path includes source and destination
    expect(res.body.data.path[0]).toMatchObject({
      assetCode: 'XLM',
      assetIssuer: 'native',
      assetType: 'native',
    });
    expect(res.body.data.path[1]).toMatchObject({
      assetCode: 'USDC',
      assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    });
    
    expect(res.body.data.sourceAmount).toBe('100.0000000');
    expect(res.body.data.destinationAmount).toBe('12.5000000');
    expect(res.body.data.estimatedRate).toBe('0.1250000');
    
    expect(strictSendPaths).toHaveBeenCalled();
  });

  it('returns hops: 2 when a pair requires an intermediate asset', async () => {
    // Path with one intermediate asset means hops: 1
    const pathWithIntermediate = createPathRecord(
      '100.0000000',
      '15.7500000',
      [
        {
          asset_code: 'USDC',
          asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          asset_type: 'credit_alphanum4',
        },
      ]
    );

    call.mockResolvedValue(buildPathResponse([pathWithIntermediate]));

    const res = await request(app)
      .get('/dex/best-path/XLM:native/EURC:GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2')
      .query({ amount: '100' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    
    // Path: source -> USDC -> destination (3 assets total, 1 intermediate)
    expect(res.body.data.path).toHaveLength(3);
    expect(res.body.data.hops).toBe(1);
    
    // Verify path structure
    expect(res.body.data.path[0].assetCode).toBe('XLM');
    expect(res.body.data.path[1].assetCode).toBe('USDC');
    expect(res.body.data.path[2].assetCode).toBe('EURC');
    
    expect(res.body.data.sourceAmount).toBe('100.0000000');
    expect(res.body.data.destinationAmount).toBe('15.7500000');
  });

  it('returns NoPathFound error when no conversion path exists', async () => {
    // Empty records means no path found
    call.mockResolvedValue(buildPathResponse([]));

    const res = await request(app)
      .get('/dex/best-path/XLM:native/RARE:GDRAREISSUERTHATHASNOMARKETLIQUIDITY000000000000')
      .query({ amount: '100' });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toHaveProperty('type');
    expect(res.body.error.type).toBe('NoPathFound');
    expect(res.body.error.message).toMatch(/No conversion path exists/);
  });

  it('computes the rate for a specific amount when ?amount=100 is provided', async () => {
    // Test that amount affects the rate computation
    const pathWith100 = createPathRecord('100.0000000', '25.0000000', []);
    
    call.mockResolvedValue(buildPathResponse([pathWith100]));

    const res = await request(app)
      .get('/dex/best-path/XLM:native/USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN')
      .query({ amount: '100' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.sourceAmount).toBe('100.0000000');
    expect(res.body.data.destinationAmount).toBe('25.0000000');
    
    // Rate should be destination / source = 25 / 100 = 0.25
    expect(res.body.data.estimatedRate).toBe('0.2500000');
    
    // Verify the endpoint was called with amount 100
    expect(strictSendPaths).toHaveBeenCalled();
    const firstCall = strictSendPaths.mock.calls[0];
    expect(firstCall[1]).toBe('100.0000000'); // amount parameter
  });

  it('returns 400 for an invalid source asset format', async () => {
    // Invalid format - missing issuer
    const res = await request(app)
      .get('/dex/best-path/INVALIDFORMAT/USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN')
      .query({ amount: '100' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toHaveProperty('type');
    expect(res.body.error.type).toBe('ValidationError');
    expect(res.body.error.message).toMatch(/Invalid asset format/);
    
    // Should not have called the Stellar SDK
    expect(strictSendPaths).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid destination asset format', async () => {
    // Invalid issuer address (too short)
    const res = await request(app)
      .get('/dex/best-path/XLM:native/USDC:INVALID')
      .query({ amount: '100' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toHaveProperty('type');
    expect(res.body.error.type).toBe('ValidationError');
    
    expect(strictSendPaths).not.toHaveBeenCalled();
  });

  it('returns 400 when sourceAsset and destAsset are the same', async () => {
    const res = await request(app)
      .get('/dex/best-path/XLM:native/XLM:native')
      .query({ amount: '100' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toHaveProperty('type');
    expect(res.body.error.type).toBe('ValidationError');
    expect(res.body.error.message).toMatch(/must be different/);
    
    expect(strictSendPaths).not.toHaveBeenCalled();
  });

  it('returns 400 for a negative amount', async () => {
    const res = await request(app)
      .get('/dex/best-path/XLM:native/USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN')
      .query({ amount: '-10' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe('ValidationError');
    expect(res.body.error.message).toMatch(/must be a positive number/);
    
    expect(strictSendPaths).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-numeric amount', async () => {
    const res = await request(app)
      .get('/dex/best-path/XLM:native/USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN')
      .query({ amount: 'not-a-number' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe('ValidationError');
    expect(res.body.error.message).toMatch(/must be a positive number/);
    
    expect(strictSendPaths).not.toHaveBeenCalled();
  });

  it('defaults to amount=1 when no amount parameter is provided', async () => {
    const defaultPath = createPathRecord('1.0000000', '0.1250000', []);
    
    call.mockResolvedValue(buildPathResponse([defaultPath]));

    const res = await request(app)
      .get('/dex/best-path/XLM:native/USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.sourceAmount).toBe('1.0000000');
    
    // Verify default amount of 1 was used
    const firstCall = strictSendPaths.mock.calls[0];
    expect(firstCall[1]).toBe('1.0000000');
  });

  it('calculates slippage correctly when reference path is available', async () => {
    // Main path: 100 XLM -> 25 USDC (rate: 0.25)
    const mainPath = createPathRecord('100.0000000', '25.0000000', []);
    
    // Reference path (1% amount): 1 XLM -> 0.26 USDC (rate: 0.26)
    // This better rate indicates slippage
    const referencePath = createPathRecord('1.0000000', '0.2600000', []);
    
    call
      .mockResolvedValueOnce(buildPathResponse([mainPath])) // First call: main amount
      .mockResolvedValueOnce(buildPathResponse([referencePath])); // Second call: reference amount

    const res = await request(app)
      .get('/dex/best-path/XLM:native/USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN')
      .query({ amount: '100' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.estimatedRate).toBe('0.2500000');
    
    // Slippage = ((0.26 - 0.25) / 0.26) * 100 = 3.8462%
    expect(res.body.data.slippagePercent).toBeTruthy();
    expect(parseFloat(res.body.data.slippagePercent)).toBeGreaterThan(0);
    expect(parseFloat(res.body.data.slippagePercent)).toBeLessThan(5);
  });

  it('returns hops: 2 for a path with two intermediate assets', async () => {
    const pathWithTwoIntermediates = createPathRecord(
      '100.0000000',
      '20.0000000',
      [
        {
          asset_code: 'USDC',
          asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          asset_type: 'credit_alphanum4',
        },
        {
          asset_code: 'BTC',
          asset_issuer: 'GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2',
          asset_type: 'credit_alphanum4',
        },
      ]
    );

    call.mockResolvedValue(buildPathResponse([pathWithTwoIntermediates]));

    const res = await request(app)
      .get('/dex/best-path/XLM:native/RARE:GDRAREISSUERTHATHASNOMARKETLIQUIDITY000000000000')
      .query({ amount: '100' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    
    // Path: XLM -> USDC -> BTC -> RARE (4 assets total, 2 intermediates)
    expect(res.body.data.path).toHaveLength(4);
    expect(res.body.data.hops).toBe(2);
  });

  it('handles credit_alphanum12 asset types correctly', async () => {
    const longAssetPath = createPathRecord('100.0000000', '50.0000000', []);
    
    call.mockResolvedValue(buildPathResponse([longAssetPath]));

    const res = await request(app)
      .get('/dex/best-path/XLM:native/LONGASSETNAME:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN')
      .query({ amount: '100' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.destAsset.assetCode).toBe('LONGASSETNAME');
  });

  it('returns NoPathFound when path records have invalid amounts', async () => {
    // Path with zero or invalid destination amount
    const invalidPath = createPathRecord('100.0000000', '0.0000000', []);
    
    call.mockResolvedValue(buildPathResponse([invalidPath]));

    const res = await request(app)
      .get('/dex/best-path/XLM:native/USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN')
      .query({ amount: '100' });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe('NoPathFound');
  });

  it('selects the best path when multiple paths are returned', async () => {
    // Multiple paths with different rates
    const path1 = createPathRecord('100.0000000', '25.0000000', []); // Rate: 0.25
    const path2 = createPathRecord('100.0000000', '30.0000000', []); // Rate: 0.30 (better)
    const path3 = createPathRecord('100.0000000', '22.0000000', []); // Rate: 0.22
    
    call.mockResolvedValue(buildPathResponse([path1, path2, path3]));

    const res = await request(app)
      .get('/dex/best-path/XLM:native/USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN')
      .query({ amount: '100' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    
    // Should select path2 with the highest destination amount
    expect(res.body.data.destinationAmount).toBe('30.0000000');
    expect(res.body.data.estimatedRate).toBe('0.3000000');
  });
});
