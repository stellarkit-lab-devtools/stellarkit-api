'use strict';

const request = require('supertest');
const StellarSdk = require('@stellar/stellar-sdk');

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    Horizon: {
      Server: jest.fn(),
    },
  };
});

const BASE_RESERVE = 0.5;

function buildAccount({ id, sponsorships = [] }) {
  const account = new StellarSdk.Account(id, '1');
  account.sponsoring = sponsorships;
  return account;
}

function mockLoadAccount(accountOrError) {
  const serverInstance = {
    loadAccount: jest.fn(),
  };
  if (accountOrError instanceof Error) {
    serverInstance.loadAccount.mockRejectedValue(accountOrError);
  } else {
    serverInstance.loadAccount.mockResolvedValue(accountOrError);
  }
  StellarSdk.Horizon.Server.mockImplementation(() => serverInstance);
  return serverInstance;
}

let app;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  app = require('../../src/app');
});

describe('GET /account/:id/sponsorship-costs', () => {
  test('account sponsoring 3 trustlines returns totalLockedXLM equal to 3 x base reserve', async () => {
    const accountId = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
    const account = buildAccount({
      id: accountId,
      sponsorships: [
        { type: 'trustline', sponsor: 'GSPONSOR1', amount: BASE_RESERVE },
        { type: 'trustline', sponsor: 'GSPONSOR2', amount: BASE_RESERVE },
        { type: 'trustline', sponsor: 'GSPONSOR3', amount: BASE_RESERVE },
      ],
    });
    mockLoadAccount(account);

    const res = await request(app).get(`/account/${accountId}/sponsorship-costs`);

    expect(res.status).toBe(200);
    expect(res.body.totalSponsoring).toBe(3);
    expect(res.body.totalLockedXLM).toBe('1.5000000');
  });

  test('account sponsoring nothing returns totalSponsoring: 0 and totalLockedXLM: "0.0000000"', async () => {
    const accountId = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    const account = buildAccount({ id: accountId, sponsorships: [] });
    mockLoadAccount(account);

    const res = await request(app).get(`/account/${accountId}/sponsorship-costs`);

    expect(res.status).toBe(200);
    expect(res.body.totalSponsoring).toBe(0);
    expect(res.body.totalLockedXLM).toBe('0.0000000');
  });

  test('breakdown correctly groups entries by type', async () => {
    const accountId = 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
    const account = buildAccount({
      id: accountId,
      sponsorships: [
        { type: 'trustline', sponsor: 'GSPONSOR1', amount: BASE_RESERVE },
        { type: 'trustline', sponsor: 'GSPONSOR2', amount: BASE_RESERVE },
        { type: 'signer', sponsor: 'GSPONSOR3', amount: BASE_RESERVE },
        { type: 'data_entry', sponsor: 'GSPONSOR4', amount: BASE_RESERVE },
      ],
    });
    mockLoadAccount(account);

    const res = await request(app).get(`/account/${accountId}/sponsorship-costs`);

    expect(res.status).toBe(200);
    expect(res.body.totalSponsoring).toBe(4);
    expect(res.body.totalLockedXLM).toBe('2.0000000');
    expect(res.body.breakdown).toBeDefined();
    expect(res.body.breakdown.trustline).toBeDefined();
    expect(res.body.breakdown.trustline.count).toBe(2);
    expect(res.body.breakdown.trustline.lockedXLM).toBe('1.0000000');
    expect(res.body.breakdown.signer).toBeDefined();
    expect(res.body.breakdown.signer.count).toBe(1);
    expect(res.body.breakdown.signer.lockedXLM).toBe('0.5000000');
    expect(res.body.breakdown.data_entry).toBeDefined();
    expect(res.body.breakdown.data_entry.count).toBe(1);
    expect(res.body.breakdown.data_entry.lockedXLM).toBe('0.5000000');
  });

  test('non-existent account returns 404', async () => {
    const accountId = 'GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
    const notFoundError = new Error('Account not found');
    notFoundError.response = { status: 404 };
    notFoundError.name = 'NotFoundError';
    mockLoadAccount(notFoundError);

    const res = await request(app).get(`/account/${accountId}/sponsorship-costs`);

    expect(res.status).toBe(404);
  });
});