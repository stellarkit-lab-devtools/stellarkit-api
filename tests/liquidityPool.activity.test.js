"use strict";

/**
 * Tests for GET /liquidity-pools/:id/activity
 *
 * Covers:
 *   - each event type: deposit, withdraw, created, removed, revoked
 *   - trade effects are excluded
 *   - ?type= filter (and invalid values → 400)
 *   - meta.partial when the 10-page scan cap is hit before `limit` events
 *   - malformed pool ID → 400
 *   - unknown pool → 404
 */

const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const cacheService = require("../src/services/cache");

jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    server: {
      liquidityPools: jest.fn(),
      trades: jest.fn(),
      effects: jest.fn(),
      operations: jest.fn(),
    },
  };
});

const POOL_ID = "67339253ccd0390f4886b5952d7f8d68f70f61280d908e234190c609c95b6026";
const ACCOUNT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const USDC = `USDC:${ISSUER}`;

function effect(n, type, fields = {}) {
  return {
    id: `000000000000000${n}-0000000001`,
    paging_token: `${n}-1`,
    type,
    account: ACCOUNT,
    created_at: "2026-01-01T00:00:00Z",
    ...fields,
  };
}

const DEPOSIT = effect(101, "liquidity_pool_deposited", {
  reserves_deposited: [
    { asset: "native", amount: "100" },
    { asset: USDC, amount: "12.5" },
  ],
  shares_received: "35.3553391",
});
const WITHDRAW = effect(102, "liquidity_pool_withdrew", {
  reserves_received: [
    { asset: "native", amount: "50.0000000" },
    { asset: USDC, amount: "6.25" },
  ],
  shares_redeemed: "17.5",
});
const CREATED = effect(103, "liquidity_pool_created", { liquidity_pool: { id: POOL_ID } });
const REMOVED = effect(104, "liquidity_pool_removed", { liquidity_pool_id: POOL_ID });
const REVOKED = effect(105, "liquidity_pool_revoked", {
  reserves_revoked: [
    { asset: "native", amount: "1", claimable_balance_id: "00000000abc" },
    { asset: USDC, amount: "2", claimable_balance_id: "00000000def" },
  ],
  shares_revoked: "3",
});
const TRADE = effect(106, "liquidity_pool_trade", { sold: {}, bought: {} });

/**
 * Mock server.effects() so each successive .call() returns the next page.
 * Returns the query object for call assertions.
 */
function mockEffectPages(pages) {
  const query = {
    forLiquidityPool: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn(),
  };
  pages.forEach((records) => query.call.mockResolvedValueOnce({ records }));
  query.call.mockResolvedValue({ records: [] });
  server.effects.mockReturnValue(query);
  return query;
}

function mockOperations() {
  server.operations.mockImplementation(() => ({
    operation: (opId) => ({
      call: jest.fn().mockResolvedValue({ id: opId, transaction_hash: `tx-${opId}` }),
    }),
  }));
}

function mockPoolLookup({ notFound = false } = {}) {
  const call = notFound
    ? jest.fn().mockRejectedValue({ response: { status: 404 } })
    : jest.fn().mockResolvedValue({ id: POOL_ID });
  server.liquidityPools.mockReturnValue({
    liquidityPoolId: jest.fn().mockReturnValue({ call }),
  });
  return call;
}

describe("GET /liquidity-pools/:id/activity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
    mockOperations();
    mockPoolLookup();
  });

  describe("event types", () => {
    let events;

    beforeEach(async () => {
      mockEffectPages([[DEPOSIT, TRADE, WITHDRAW, CREATED, REMOVED, REVOKED]]);
      const res = await request(app).get(`/liquidity-pools/${POOL_ID}/activity`);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.poolId).toBe(POOL_ID);
      events = res.body.data.events;
    });

    it("excludes trade effects", () => {
      expect(events).toHaveLength(5);
      expect(events.map((e) => e.type)).toEqual([
        "deposit",
        "withdraw",
        "created",
        "removed",
        "revoked",
      ]);
    });

    it("normalises deposit events", () => {
      expect(events[0]).toEqual({
        type: "deposit",
        account: ACCOUNT,
        reservesDeposited: [
          { asset: { code: "XLM", issuer: null, type: "native" }, amount: "100.0000000" },
          {
            asset: { code: "USDC", issuer: ISSUER, type: "credit_alphanum4" },
            amount: "12.5000000",
          },
        ],
        reservesReceived: null,
        sharesReceived: "35.3553391",
        sharesRedeemed: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        transactionHash: "tx-101",
      });
    });

    it("normalises withdraw events", () => {
      expect(events[1]).toMatchObject({
        type: "withdraw",
        reservesDeposited: null,
        reservesReceived: [
          { asset: { code: "XLM", issuer: null, type: "native" }, amount: "50.0000000" },
          {
            asset: { code: "USDC", issuer: ISSUER, type: "credit_alphanum4" },
            amount: "6.2500000",
          },
        ],
        sharesReceived: null,
        sharesRedeemed: "17.5000000",
        transactionHash: "tx-102",
      });
    });

    it("normalises created events", () => {
      expect(events[2]).toEqual({
        type: "created",
        account: ACCOUNT,
        reservesDeposited: null,
        reservesReceived: null,
        sharesReceived: null,
        sharesRedeemed: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        transactionHash: "tx-103",
      });
    });

    it("normalises removed events", () => {
      expect(events[3]).toMatchObject({
        type: "removed",
        account: ACCOUNT,
        reservesDeposited: null,
        reservesReceived: null,
        transactionHash: "tx-104",
      });
    });

    it("normalises revoked events", () => {
      expect(events[4]).toMatchObject({
        type: "revoked",
        reservesReceived: [
          { asset: { code: "XLM", issuer: null, type: "native" }, amount: "1.0000000" },
          {
            asset: { code: "USDC", issuer: ISSUER, type: "credit_alphanum4" },
            amount: "2.0000000",
          },
        ],
        sharesRedeemed: "3.0000000",
        transactionHash: "tx-105",
      });
    });
  });

  describe("?type= filter", () => {
    it("returns only events of the requested type", async () => {
      mockEffectPages([[DEPOSIT, WITHDRAW, CREATED, DEPOSIT]]);
      const res = await request(app).get(`/liquidity-pools/${POOL_ID}/activity?type=deposit`);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.events).toHaveLength(2);
      expect(res.body.data.events.every((e) => e.type === "deposit")).toBe(true);
      expect(res.body.meta.type).toEqual(["deposit"]);
    });

    it("returns 400 for an unknown type (including trade)", async () => {
      mockEffectPages([[DEPOSIT]]);
      const res = await request(app).get(`/liquidity-pools/${POOL_ID}/activity?type=trade`);
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe("scan cap", () => {
    it("sets meta.partial when 10 pages are scanned before limit events are found", async () => {
      const fullTradePage = (page) =>
        Array.from({ length: 200 }, (_, i) =>
          effect(page * 1000 + i + 1, "liquidity_pool_trade")
        );
      const pages = Array.from({ length: 10 }, (_, p) => fullTradePage(p + 1));
      pages[3][7] = DEPOSIT; // one matching event buried in page 4

      const query = mockEffectPages(pages);
      const res = await request(app).get(`/liquidity-pools/${POOL_ID}/activity?limit=5`);

      expect(res.statusCode).toBe(200);
      expect(query.call).toHaveBeenCalledTimes(10);
      expect(res.body.data.events).toHaveLength(1);
      expect(res.body.meta.partial).toBe(true);
      expect(res.body.meta.pagesScanned).toBe(10);
      expect(res.body.meta.nextCursor).toBe(pages[9][199].paging_token);
    });

    it("is not partial when history ends before the cap", async () => {
      mockEffectPages([[DEPOSIT, TRADE]]);
      const res = await request(app).get(`/liquidity-pools/${POOL_ID}/activity?limit=5`);
      expect(res.body.meta.partial).toBe(false);
      expect(res.body.meta.nextCursor).toBeNull();
    });

    it("is not partial when limit events are found", async () => {
      mockEffectPages([[DEPOSIT, WITHDRAW, CREATED]]);
      const res = await request(app).get(`/liquidity-pools/${POOL_ID}/activity?limit=2`);
      expect(res.body.data.events).toHaveLength(2);
      expect(res.body.meta.partial).toBe(false);
      expect(res.body.meta.nextCursor).toBe(WITHDRAW.paging_token);
    });
  });

  describe("errors", () => {
    it("returns 400 for a malformed pool ID", async () => {
      const res = await request(app).get("/liquidity-pools/not-a-pool/activity");
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(server.effects).not.toHaveBeenCalled();
    });

    it("returns 400 for a 63-character ID", async () => {
      const res = await request(app).get(`/liquidity-pools/${POOL_ID.slice(1)}/activity`);
      expect(res.statusCode).toBe(400);
    });

    it("returns 404 when Horizon reports the pool as unknown", async () => {
      const query = mockEffectPages([]);
      query.call.mockReset();
      query.call.mockRejectedValue({ response: { status: 404 } });
      const res = await request(app).get(`/liquidity-pools/${POOL_ID}/activity`);
      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("returns 404 when there is no effect history and the pool lookup fails", async () => {
      mockEffectPages([[]]);
      mockPoolLookup({ notFound: true });
      const res = await request(app).get(`/liquidity-pools/${POOL_ID}/activity`);
      expect(res.statusCode).toBe(404);
    });
  });
});
