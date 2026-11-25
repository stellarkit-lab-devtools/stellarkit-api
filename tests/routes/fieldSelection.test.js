'use strict';

const request = require('supertest');
const app = require('../../src/index');

// Mock Stellar SDK
jest.mock('../../src/config/stellar', () => {
  const mockServer = {
    loadAccount: jest.fn(),
    transactions: jest.fn(),
    payments: jest.fn(),
    trades: jest.fn(),
  };

  return {
    server: mockServer,
    __mockServer: mockServer,
  };
});

const { server } = require('../../src/config/stellar');

describe('Field Selection Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /account/:id/transactions with ?fields=', () => {
    const accountId = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJKIVZQC6MXYFPTZE2V37ZGQDDG';

    beforeEach(() => {
      // Mock account exists
      server.loadAccount.mockResolvedValue({
        id: accountId,
        sequence: '123'
      });

      // Mock transactions response
      const mockTransactions = {
        records: [
          {
            id: 'tx1',
            hash: 'abc123',
            ledger: 12345,
            created_at: '2024-01-15T10:30:00Z',
            source_account: accountId,
            fee_charged: '100',
            max_fee: '1000',
            fee_account: accountId,
            operation_count: 1,
            memo_type: 'none',
            successful: true,
            envelope_xdr: 'xdr123'
          },
          {
            id: 'tx2',
            hash: 'def456',
            ledger: 12346,
            created_at: '2024-01-15T10:31:00Z',
            source_account: accountId,
            fee_charged: '200',
            max_fee: '2000',
            fee_account: accountId,
            operation_count: 2,
            memo_type: 'text',
            memo: 'test memo',
            successful: true,
            envelope_xdr: 'xdr456'
          }
        ]
      };

      const transactionsCall = jest.fn().mockResolvedValue(mockTransactions);
      const transactionsCursor = jest.fn(() => ({ call: transactionsCall }));
      const transactionsOrder = jest.fn(() => ({ cursor: transactionsCursor, call: transactionsCall }));
      const transactionsLimit = jest.fn(() => ({ order: transactionsOrder, cursor: transactionsCursor, call: transactionsCall }));
      const transactionsForAccount = jest.fn(() => ({ limit: transactionsLimit }));

      server.transactions.mockReturnValue({
        forAccount: transactionsForAccount
      });
    });

    it('returns only requested top-level fields', async () => {
      const res = await request(app)
        .get(`/account/${accountId}/transactions`)
        .query({ fields: 'hash,createdAt' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);

      // Should only have requested fields
      expect(res.body.data[0]).toHaveProperty('hash');
      expect(res.body.data[0]).toHaveProperty('createdAt');
      expect(res.body.data[0]).not.toHaveProperty('ledger');
      expect(res.body.data[0]).not.toHaveProperty('sourceAccount');
      expect(res.body.data[0]).not.toHaveProperty('fee');

      expect(res.body.data[0].hash).toBe('abc123');
    });

    it('returns nested fields using dot notation', async () => {
      const res = await request(app)
        .get(`/account/${accountId}/transactions`)
        .query({ fields: 'hash,fee.charged' });

      expect(res.status).toBe(200);
      expect(res.body.data[0]).toHaveProperty('hash');
      expect(res.body.data[0]).toHaveProperty('fee');
      expect(res.body.data[0].fee).toHaveProperty('charged');
      expect(res.body.data[0].fee).not.toHaveProperty('max');
      expect(res.body.data[0].fee).not.toHaveProperty('chargedInXLM');
    });

    it('returns 400 for unknown fields', async () => {
      const res = await request(app)
        .get(`/account/${accountId}/transactions`)
        .query({ fields: 'hash,unknownField' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe('InvalidFields');
      expect(res.body.error.message).toContain('unknownField');
      expect(res.body.error.message).toContain('Valid fields');
    });

    it('returns 400 for empty fields parameter', async () => {
      const res = await request(app)
        .get(`/account/${accountId}/transactions`)
        .query({ fields: '' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe('InvalidFields');
      expect(res.body.error.message).toContain('cannot be empty');
    });

    it('combines fields with limit and cursor parameters', async () => {
      const res = await request(app)
        .get(`/account/${accountId}/transactions`)
        .query({
          fields: 'hash,ledger',
          limit: 10,
          cursor: '12345-1'
        });

      expect(res.status).toBe(200);
      expect(res.body.data[0]).toHaveProperty('hash');
      expect(res.body.data[0]).toHaveProperty('ledger');
      expect(res.body.data[0]).not.toHaveProperty('createdAt');
      expect(res.body.data[0]).not.toHaveProperty('fee');
    });

    it('preserves meta object when using field selection', async () => {
      const res = await request(app)
        .get(`/account/${accountId}/transactions`)
        .query({ fields: 'hash' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('meta');
      expect(res.body.meta).toHaveProperty('count');
      expect(res.body.meta).toHaveProperty('limit');
      // Meta should be untouched by field selection
    });

    it('returns all fields when fields parameter is omitted', async () => {
      const res = await request(app)
        .get(`/account/${accountId}/transactions`);

      expect(res.status).toBe(200);
      expect(res.body.data[0]).toHaveProperty('hash');
      expect(res.body.data[0]).toHaveProperty('ledger');
      expect(res.body.data[0]).toHaveProperty('createdAt');
      expect(res.body.data[0]).toHaveProperty('fee');
      expect(res.body.data[0]).toHaveProperty('sourceAccount');
    });
  });

  describe('GET /account/:id/payments with ?fields=', () => {
    const accountId = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJKIVZQC6MXYFPTZE2V37ZGQDDG';

    beforeEach(() => {
      // Mock payments response
      const mockPayments = {
        records: [
          {
            id: 'p1',
            type: 'payment',
            from: 'GABC123',
            to: accountId,
            asset_type: 'credit_alphanum4',
            asset_code: 'USDC',
            asset_issuer: 'GXYZ789',
            amount: '100.0000000',
            transaction_hash: 'tx1',
            created_at: '2024-01-15T10:30:00Z'
          },
          {
            id: 'p2',
            type: 'create_account',
            account: accountId,
            funder: 'GDEF456',
            starting_balance: '10.0000000',
            transaction_hash: 'tx2',
            created_at: '2024-01-15T10:31:00Z'
          }
        ]
      };

      const paymentsCall = jest.fn().mockResolvedValue(mockPayments);
      const paymentsCursor = jest.fn(() => ({ call: paymentsCall }));
      const paymentsOrder = jest.fn(() => ({ cursor: paymentsCursor, call: paymentsCall }));
      const paymentsLimit = jest.fn(() => ({ order: paymentsOrder, cursor: paymentsCursor, call: paymentsCall }));
      const paymentsForAccount = jest.fn(() => ({ limit: paymentsLimit }));

      server.payments.mockReturnValue({
        forAccount: paymentsForAccount
      });
    });

    it('returns only requested top-level fields for payments', async () => {
      const res = await request(app)
        .get(`/account/${accountId}/payments`)
        .query({ fields: 'from,to,amount' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();

      // Check that only requested fields are present
      if (res.body.data.length > 0) {
        const payment = res.body.data[0];
        expect(payment).toHaveProperty('from');
        expect(payment).toHaveProperty('to');
        expect(payment).toHaveProperty('amount');
        expect(payment).not.toHaveProperty('transactionHash');
        expect(payment).not.toHaveProperty('createdAt');
      }
    });

    it('returns nested asset fields using dot notation', async () => {
      const res = await request(app)
        .get(`/account/${accountId}/payments`)
        .query({ fields: 'amount,asset.code,asset.issuer' });

      expect(res.status).toBe(200);

      if (res.body.data.length > 0) {
        const payment = res.body.data[0];
        expect(payment).toHaveProperty('amount');
        expect(payment).toHaveProperty('asset');
        expect(payment.asset).toHaveProperty('code');
        expect(payment.asset).toHaveProperty('issuer');
        expect(payment.asset).not.toHaveProperty('type');
      }
    });

    it('returns 400 for unknown payment fields', async () => {
      const res = await request(app)
        .get(`/account/${accountId}/payments`)
        .query({ fields: 'amount,invalidField' });

      expect(res.status).toBe(400);
      expect(res.body.error.type).toBe('InvalidFields');
    });
  });

  describe('GET /account/:id/trades with ?fields=', () => {
    const accountId = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJKIVZQC6MXYFPTZE2V37ZGQDDG';

    beforeEach(() => {
      server.loadAccount.mockResolvedValue({
        id: accountId,
        sequence: '123'
      });

      // Mock trades response
      const mockTrades = {
        records: [
          {
            id: 't1',
            ledger_close_time: '2024-01-15T10:30:00Z',
            base_asset_type: 'native',
            base_amount: '1000.0000000',
            counter_asset_type: 'credit_alphanum4',
            counter_asset_code: 'USDC',
            counter_asset_issuer: 'GABC123',
            counter_amount: '100.0000000',
            price: { n: 1, d: 10 },
            base_is_seller: true
          }
        ]
      };

      const tradesCall = jest.fn().mockResolvedValue(mockTrades);
      const tradesCursor = jest.fn(() => ({ call: tradesCall }));
      const tradesOrder = jest.fn(() => ({ cursor: tradesCursor, call: tradesCall }));
      const tradesLimit = jest.fn(() => ({ order: tradesOrder, cursor: tradesCursor, call: tradesCall }));
      const tradesForAccount = jest.fn(() => ({ limit: tradesLimit }));

      server.trades.mockReturnValue({
        forAccount: tradesForAccount
      });
    });

    it('returns only requested top-level fields for trades', async () => {
      const res = await request(app)
        .get(`/account/${accountId}/trades`)
        .query({ fields: 'id,baseAmount,counterAmount' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      if (res.body.data && res.body.data.length > 0) {
        const trade = res.body.data[0];
        expect(trade).toHaveProperty('id');
        expect(trade).toHaveProperty('baseAmount');
        expect(trade).toHaveProperty('counterAmount');
        expect(trade).not.toHaveProperty('price');
        expect(trade).not.toHaveProperty('ledgerCloseTime');
      }
    });

    it('returns nested asset fields for trades', async () => {
      const res = await request(app)
        .get(`/account/${accountId}/trades`)
        .query({ fields: 'baseAsset.code,counterAsset.code,price' });

      expect(res.status).toBe(200);

      if (res.body.data && res.body.data.length > 0) {
        const trade = res.body.data[0];
        expect(trade).toHaveProperty('baseAsset');
        expect(trade).toHaveProperty('counterAsset');
        expect(trade).toHaveProperty('price');
      }
    });

    it('returns 400 for unknown trade fields', async () => {
      const res = await request(app)
        .get(`/account/${accountId}/trades`)
        .query({ fields: 'price,nonExistentField' });

      expect(res.status).toBe(400);
      expect(res.body.error.type).toBe('InvalidFields');
    });
  });

  describe('Field selection with caching', () => {
    const accountId = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJKIVZQC6MXYFPTZE2V37ZGQDDG';

    beforeEach(() => {
      server.loadAccount.mockResolvedValue({
        id: accountId,
        sequence: '123'
      });

      const mockTransactions = {
        records: [
          {
            id: 'tx1',
            hash: 'abc123',
            ledger: 12345,
            created_at: '2024-01-15T10:30:00Z',
            source_account: accountId,
            fee_charged: '100',
            max_fee: '1000',
            fee_account: accountId,
            operation_count: 1,
            memo_type: 'none',
            successful: true,
            envelope_xdr: 'xdr123'
          }
        ]
      };

      const transactionsCall = jest.fn().mockResolvedValue(mockTransactions);
      const transactionsCursor = jest.fn(() => ({ call: transactionsCall }));
      const transactionsOrder = jest.fn(() => ({ cursor: transactionsCursor, call: transactionsCall }));
      const transactionsLimit = jest.fn(() => ({ order: transactionsOrder, cursor: transactionsCursor, call: transactionsCall }));
      const transactionsForAccount = jest.fn(() => ({ limit: transactionsLimit }));

      server.transactions.mockReturnValue({
        forAccount: transactionsForAccount
      });
    });

    it('applies field selection after cache lookup', async () => {
      // First request - cache MISS
      const res1 = await request(app)
        .get(`/account/${accountId}/transactions`)
        .query({ fields: 'hash,ledger' });

      expect(res1.status).toBe(200);
      expect(res1.body.data[0]).toHaveProperty('hash');
      expect(res1.body.data[0]).toHaveProperty('ledger');
      expect(res1.body.data[0]).not.toHaveProperty('createdAt');

      // Second request with different fields - should work even if cached
      const res2 = await request(app)
        .get(`/account/${accountId}/transactions`)
        .query({ fields: 'hash,createdAt' });

      expect(res2.status).toBe(200);
      expect(res2.body.data[0]).toHaveProperty('hash');
      expect(res2.body.data[0]).toHaveProperty('createdAt');
      expect(res2.body.data[0]).not.toHaveProperty('ledger');
    });
  });

  describe('Multiple nested fields selection', () => {
    const accountId = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJKIVZQC6MXYFPTZE2V37ZGQDDG';

    beforeEach(() => {
      server.loadAccount.mockResolvedValue({
        id: accountId,
        sequence: '123'
      });

      const mockTransactions = {
        records: [
          {
            id: 'tx1',
            hash: 'abc123',
            ledger: 12345,
            created_at: '2024-01-15T10:30:00Z',
            source_account: accountId,
            fee_charged: '100',
            max_fee: '1000',
            fee_account: accountId,
            operation_count: 1,
            memo_type: 'none',
            successful: true,
            envelope_xdr: 'xdr123'
          }
        ]
      };

      const transactionsCall = jest.fn().mockResolvedValue(mockTransactions);
      const transactionsCursor = jest.fn(() => ({ call: transactionsCall }));
      const transactionsOrder = jest.fn(() => ({ cursor: transactionsCursor, call: transactionsCall }));
      const transactionsLimit = jest.fn(() => ({ order: transactionsOrder, cursor: transactionsCursor, call: transactionsCall }));
      const transactionsForAccount = jest.fn(() => ({ limit: transactionsLimit }));

      server.transactions.mockReturnValue({
        forAccount: transactionsForAccount
      });
    });

    it('selects multiple nested fields from same object', async () => {
      const res = await request(app)
        .get(`/account/${accountId}/transactions`)
        .query({ fields: 'hash,fee.charged,fee.max' });

      expect(res.status).toBe(200);
      expect(res.body.data[0]).toHaveProperty('hash');
      expect(res.body.data[0]).toHaveProperty('fee');
      expect(res.body.data[0].fee).toHaveProperty('charged');
      expect(res.body.data[0].fee).toHaveProperty('max');
      expect(res.body.data[0].fee).not.toHaveProperty('chargedInXLM');
    });
  });
});
