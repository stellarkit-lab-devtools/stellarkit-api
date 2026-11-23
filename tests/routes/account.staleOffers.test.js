/**
 * tests/routes/account.staleOffers.test.js
 *
 * Unit tests for GET /account/:id/stale-offers price deviation computation.
 *
 * Test scenarios:
 *   1. Offer priced within 5% of market returns stale: false
 *   2. Offer priced more than 5% away returns stale: true
 *   3. ?threshold=10 changes the staleness boundary to 10%
 *   4. Account with no offers returns an empty array
 *   5. priceDeviation is computed correctly as a percentage
 */

"use strict";

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

// Mock the Stellar server before requiring the app
jest.mock("../../src/config/stellar", () => {
  const original = jest.requireActual("../../src/config/stellar");
  return {
    ...original,
    server: {
      loadAccount: jest.fn(),
      offers: jest.fn(),
      orderbook: jest.fn(),
    },
  };
});

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

// Test account
const ACCOUNT_ID = Keypair.random().publicKey();

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /account/:id/stale-offers – price deviation computation", () => {

  describe("offer priced within 5% of market", () => {
    it("returns stale: false when offer price is within 5% of market price", async () => {
      // Mock account exists
      server.loadAccount.mockResolvedValue({
        id: ACCOUNT_ID,
        balances: [],
      });

      // Mock offer with price 1.0
      server.offers.mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({
          records: [
            {
              id: "offer1",
              selling_asset_type: "native",
              buying_asset_type: "credit_alphanum4",
              buying_asset_code: "USDC",
              buying_asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
              price: "1.0",
              price_r: { n: 1, d: 1 },
              amount: "100",
            },
          ],
        }),
      });

      // Mock order book with mid-market price 1.02 (2% deviation)
      server.orderbook.mockReturnValue({
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({
          bids: [{ price: "1.01" }],
          asks: [{ price: "1.03" }],
        }),
      });

      const res = await request(app).get(`/account/${ACCOUNT_ID}/stale-offers`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.offers).toHaveLength(1);
      expect(res.body.data.offers[0].stale).toBe(false);
      expect(res.body.data.offers[0].priceDeviation).toBeLessThan(5);
      expect(res.body.data.staleCount).toBe(0);
    });
  });

  describe("offer priced more than 5% away", () => {
    it("returns stale: true when offer price deviates more than 5%", async () => {
      server.loadAccount.mockResolvedValue({
        id: ACCOUNT_ID,
        balances: [],
      });

      // Mock offer with price 1.0
      server.offers.mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({
          records: [
            {
              id: "offer2",
              selling_asset_type: "native",
              buying_asset_type: "credit_alphanum4",
              buying_asset_code: "USDC",
              buying_asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
              price: "1.0",
              price_r: { n: 1, d: 1 },
              amount: "100",
            },
          ],
        }),
      });

      // Mock order book with mid-market price 1.12 (12% deviation)
      server.orderbook.mockReturnValue({
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({
          bids: [{ price: "1.10" }],
          asks: [{ price: "1.14" }],
        }),
      });

      const res = await request(app).get(`/account/${ACCOUNT_ID}/stale-offers`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.offers).toHaveLength(1);
      expect(res.body.data.offers[0].stale).toBe(true);
      expect(res.body.data.offers[0].priceDeviation).toBeGreaterThan(5);
      expect(res.body.data.staleCount).toBe(1);
    });
  });

  describe("custom threshold via ?threshold=10", () => {
    it("changes the staleness boundary to 10%", async () => {
      server.loadAccount.mockResolvedValue({
        id: ACCOUNT_ID,
        balances: [],
      });

      // Mock offer with price 1.0
      server.offers.mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({
          records: [
            {
              id: "offer3",
              selling_asset_type: "native",
              buying_asset_type: "credit_alphanum4",
              buying_asset_code: "USDC",
              buying_asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
              price: "1.0",
              price_r: { n: 1, d: 1 },
              amount: "100",
            },
          ],
        }),
      });

      // Mock order book with mid-market price 1.08 (8% deviation)
      server.orderbook.mockReturnValue({
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({
          bids: [{ price: "1.07" }],
          asks: [{ price: "1.09" }],
        }),
      });

      const res = await request(app).get(`/account/${ACCOUNT_ID}/stale-offers?threshold=10`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.offers).toHaveLength(1);
      // 8% deviation is less than 10% threshold, so not stale
      expect(res.body.data.offers[0].stale).toBe(false);
      expect(res.body.data.offers[0].priceDeviation).toBeLessThan(10);
      expect(res.body.data.staleCount).toBe(0);
    });

    it("flags offer as stale when deviation exceeds custom threshold", async () => {
      server.loadAccount.mockResolvedValue({
        id: ACCOUNT_ID,
        balances: [],
      });

      server.offers.mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({
          records: [
            {
              id: "offer4",
              selling_asset_type: "native",
              buying_asset_type: "credit_alphanum4",
              buying_asset_code: "USDC",
              buying_asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
              price: "1.0",
              price_r: { n: 1, d: 1 },
              amount: "100",
            },
          ],
        }),
      });

      // Mock order book with mid-market price 1.15 (15% deviation)
      server.orderbook.mockReturnValue({
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({
          bids: [{ price: "1.14" }],
          asks: [{ price: "1.16" }],
        }),
      });

      const res = await request(app).get(`/account/${ACCOUNT_ID}/stale-offers?threshold=10`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.offers[0].stale).toBe(true);
      expect(res.body.data.offers[0].priceDeviation).toBeGreaterThan(10);
      expect(res.body.data.staleCount).toBe(1);
    });
  });

  describe("account with no offers", () => {
    it("returns an empty array when account has no offers", async () => {
      server.loadAccount.mockResolvedValue({
        id: ACCOUNT_ID,
        balances: [],
      });

      server.offers.mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({
          records: [],
        }),
      });

      const res = await request(app).get(`/account/${ACCOUNT_ID}/stale-offers`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.offers).toEqual([]);
      expect(res.body.data.staleCount).toBe(0);
    });
  });

  describe("priceDeviation computation", () => {
    it("computes priceDeviation correctly as a percentage", async () => {
      server.loadAccount.mockResolvedValue({
        id: ACCOUNT_ID,
        balances: [],
      });

      // Offer price: 1.0, Market price: 1.20
      // Expected deviation: |1.0 - 1.20| / 1.20 * 100 = 16.67%
      server.offers.mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({
          records: [
            {
              id: "offer5",
              selling_asset_type: "native",
              buying_asset_type: "credit_alphanum4",
              buying_asset_code: "USDC",
              buying_asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
              price: "1.0",
              price_r: { n: 1, d: 1 },
              amount: "100",
            },
          ],
        }),
      });

      server.orderbook.mockReturnValue({
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({
          bids: [{ price: "1.19" }],
          asks: [{ price: "1.21" }],
        }),
      });

      const res = await request(app).get(`/account/${ACCOUNT_ID}/stale-offers`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.offers).toHaveLength(1);

      const offer = res.body.data.offers[0];
      expect(offer.offerPrice).toBe("1.0000000");
      expect(offer.marketPrice).toBe("1.2000000");
      
      // Verify deviation calculation: |1.0 - 1.20| / 1.20 * 100 ≈ 16.67
      const expectedDeviation = Math.abs(1.0 - 1.20) / 1.20 * 100;
      expect(offer.priceDeviation).toBeCloseTo(expectedDeviation, 1);
      expect(offer.stale).toBe(true);
    });

    it("returns priceDeviation as 0 when offer price equals market price", async () => {
      server.loadAccount.mockResolvedValue({
        id: ACCOUNT_ID,
        balances: [],
      });

      server.offers.mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({
          records: [
            {
              id: "offer6",
              selling_asset_type: "native",
              buying_asset_type: "credit_alphanum4",
              buying_asset_code: "USDC",
              buying_asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
              price: "1.05",
              price_r: { n: 105, d: 100 },
              amount: "100",
            },
          ],
        }),
      });

      // Market price is exactly 1.05
      server.orderbook.mockReturnValue({
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({
          bids: [{ price: "1.04" }],
          asks: [{ price: "1.06" }],
        }),
      });

      const res = await request(app).get(`/account/${ACCOUNT_ID}/stale-offers`);

      expect(res.statusCode).toBe(200);
      const offer = res.body.data.offers[0];
      expect(offer.priceDeviation).toBeCloseTo(0, 1);
      expect(offer.stale).toBe(false);
    });
  });
});
