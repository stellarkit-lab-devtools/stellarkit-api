'use strict';

const request = require('supertest');
const StellarSdk = require('@stellar/stellar-sdk');

const app = require('../../src/app');

const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;

/**
 * Build a real, signed transaction envelope XDR for the given operations.
 *
 * @param {Array} operations - Stellar SDK operations to include.
 * @returns {string} base64-encoded transaction envelope XDR.
 */
function buildTransactionXdr(operations) {
  const sourceKeypair = StellarSdk.Keypair.random();
  const sourceAccount = new StellarSdk.Account(sourceKeypair.publicKey(), '0');

  const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  operations.forEach((operation) => transaction.addOperation(operation));

  transaction.setTimeout(30);

  const built = transaction.build();
  built.sign(sourceKeypair);

  return built.toEnvelope().toXDR('base64');
}

describe('POST /utils/decode-transaction', () => {
  describe('payment operation', () => {
    it('decodes a payment operation with type, destination, asset, and amount', async () => {
      const destinationKeypair = StellarSdk.Keypair.random();
      const destination = destinationKeypair.publicKey();
      const amount = '12.5000000';

      const xdr = buildTransactionXdr([
        StellarSdk.Operation.payment({
          destination,
          asset: StellarSdk.Asset.native(),
          amount,
        }),
      ]);

      const response = await request(app)
        .post('/utils/decode-transaction')
        .send({ xdr })
        .expect(200);

      expect(response.body).toBeDefined();

      const operations = response.body.operations || response.body.operation;
      const operation = Array.isArray(operations) ? operations[0] : operations;

      expect(operation).toBeDefined();
      expect(operation.type).toBe('payment');
      expect(operation.destination).toBe(destination);
      expect(operation.asset).toBeDefined();
      expect(operation.amount).toBeDefined();
      expect(String(operation.amount)).toBe(amount);
    });
  });

  describe('create account operation', () => {
    it('decodes a createAccount operation with type and startingBalance', async () => {
      const destinationKeypair = StellarSdk.Keypair.random();
      const destination = destinationKeypair.publicKey();
      const startingBalance = '100.0000000';

      const xdr = buildTransactionXdr([
        StellarSdk.Operation.createAccount({
          destination,
          startingBalance,
        }),
      ]);

      const response = await request(app)
        .post('/utils/decode-transaction')
        .send({ xdr })
        .expect(200);

      expect(response.body).toBeDefined();

      const operations = response.body.operations || response.body.operation;
      const operation = Array.isArray(operations) ? operations[0] : operations;

      expect(operation).toBeDefined();
      expect(operation.type).toBe('createAccount');
      expect(operation.startingBalance).toBeDefined();
      expect(String(operation.startingBalance)).toBe(startingBalance);
    });
  });

  describe('validation', () => {
    it('returns 400 for an invalid base64 string', async () => {
      const response = await request(app)
        .post('/utils/decode-transaction')
        .send({ xdr: 'this-is-not-valid-base64-xdr!!!' })
        .expect(400);

      expect(response.body).toBeDefined();
    });

    it('returns 400 for an empty body', async () => {
      const response = await request(app)
        .post('/utils/decode-transaction')
        .send({})
        .expect(400);

      expect(response.body).toBeDefined();
    });
  });
});