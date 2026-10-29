'use strict';

const request = require('supertest');
const express = require('express');

// Mock the Stellar SDK / Horizon server used by the route.
jest.mock('stellar-sdk', () => {
  const actual = jest.requireActual('stellar-sdk');
  return {
    ...actual,
    Server: jest.fn(),
  };
});

const StellarSdk = require('stellar-sdk');

// Build a fresh app with the route mounted for each test.
function buildApp() {
  // Clear module cache so the route picks up the freshly mocked Server.
  jest.resetModules();

  const app = express();
  app.use(express.json());

  // Re-require the route after resetting modules so it uses the mock.
  const route = require('../../src/routes/account');
  app.use('/account', route);

  return app;
}

// Helper to create a Horizon-like transaction record.
function makeTransaction(createdAt) {
  return {
    id: String(Math.random()),
    created_at: createdAt,
    source_account: 'GTEST',
    hash: 'abc',
  };
}

// Helper to configure the mocked Server to return the given transactions.
function mockTransactions(transactions) {
  const call = jest.fn().mockResolvedValue({
    records: transactions,
  });

  StellarSdk.Server.mockImplementation(() => ({
    transactions: () => ({
      forAccount: () => ({
        order: () => ({
          limit: () => ({
            call,
          }),
        }),
      }),
    }),
  }));

  return call;
}

describe('GET /account/:id/transaction-velocity', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('returns the hour with count: 5 for 5 transactions in one hour', async () => {
    const now = new Date();
    // Place all 5 transactions within the same hour bucket.
    const hourStart = new Date(now);
    hourStart.setMinutes(0, 0, 0);
    const base = hourStart.getTime();

    const transactions = [
      makeTransaction(new Date(base + 1 * 60 * 1000).toISOString()),
      makeTransaction(new Date(base + 5 * 60 * 1000).toISOString()),
      makeTransaction(new Date(base + 10 * 60 * 1000).toISOString()),
      makeTransaction(new Date(base + 20 * 60 * 1000).toISOString()),
      makeTransaction(new Date(base + 30 * 60 * 1000).toISOString()),
    ];

    mockTransactions(transactions);

    const app = buildApp();
    const res = await request(app).get('/account/GTEST/transaction-velocity');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.hourlyBreakdown)).toBe(true);

    const targetHour = hourStart.toISOString();
    const entry = res.body.hourlyBreakdown.find(
      (h) => h.hour === targetHour || h.hour === hourStart.getHours()
    );

    expect(entry).toBeDefined();
    expect(entry.count).toBe(5);
  });

  test('returns 24 entries all with count: 0 when there are no transactions in the last 24 hours', async () => {
    mockTransactions([]);

    const app = buildApp();
    const res = await request(app).get('/account/GTEST/transaction-velocity');

    expect(res.status).toBe(200);
    expect(res.body.hourlyBreakdown).toHaveLength(24);
    res.body.hourlyBreakdown.forEach((entry) => {
      expect(entry.count).toBe(0);
    });
  });

  test('peakHour identifies the hour with the highest count', async () => {
    const now = new Date();
    const hourStart = new Date(now);
    hourStart.setMinutes(0, 0, 0);
    const base = hourStart.getTime();

    // 3 transactions in the current hour, 1 in the previous hour.
    const transactions = [
      makeTransaction(new Date(base + 1 * 60 * 1000).toISOString()),
      makeTransaction(new Date(base + 2 * 60 * 1000).toISOString()),
      makeTransaction(new Date(base + 3 * 60 * 1000).toISOString()),
      makeTransaction(new Date(base - 60 * 60 * 1000).toISOString()),
    ];

    mockTransactions(transactions);

    const app = buildApp();
    const res = await request(app).get('/account/GTEST/transaction-velocity');

    expect(res.status).toBe(200);
    expect(res.body.peakHour).toBeDefined();

    const peakEntry = res.body.hourlyBreakdown.find(
      (h) => h.hour === res.body.peakHour || h.hour === hourStart.getHours()
    );

    expect(peakEntry).toBeDefined();
    expect(peakEntry.count).toBe(3);

    // The peak hour should be the one with the maximum count.
    const maxCount = Math.max(
      ...res.body.hourlyBreakdown.map((h) => h.count)
    );
    expect(peakEntry.count).toBe(maxCount);
  });

  test('velocityScore is 0 for a completely inactive account', async () => {
    mockTransactions([]);

    const app = buildApp();
    const res = await request(app).get('/account/GTEST/transaction-velocity');

    expect(res.status).toBe(200);
    expect(res.body.velocityScore).toBe(0);
  });
});