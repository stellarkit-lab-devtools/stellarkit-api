const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const { Keypair } = require("@stellar/stellar-sdk");
const cacheService = require("../src/services/cache");

// Mock Horizon server
jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    server: {
      claimableBalances: jest.fn(),
    },
  };
});

function mockClaimableBalances(records) {
  server.claimableBalances.mockReturnValue({
    forClaimant: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  });
}

describe("Account Claimable Balances Eligibility API", () => {
  const accountId = Keypair.random().publicKey();

  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  describe("GET /account/:id/claimable-balances", () => {
    it("categorizes claimable balances correctly", async () => {
      const now = Math.floor(Date.now() / 1000);
      
      const mockRecords = [
        {
          id: "000000001",
          asset: "XLM",
          amount: "100.0000000",
          claimants: [
            { destination: accountId, predicate: { unconditional: true } }
          ]
        },
        {
          id: "000000002",
          asset: "XLM",
          amount: "200.0000000",
          claimants: [
            { destination: accountId, predicate: { abs_after: (now + 3600).toString() } }
          ]
        },
        {
          id: "000000003",
          asset: "XLM",
          amount: "300.0000000",
          claimants: [
            { destination: accountId, predicate: { abs_before: (now - 3600).toString() } }
          ]
        }
      ];

      server.claimableBalances.mockReturnValue({
        forClaimant: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: mockRecords })
      });

      const res = await request(app).get(`/account/${accountId}/claimable-balances`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.eligible).toHaveLength(1);
      expect(res.body.data.eligible[0].id).toBe("000000001");
      expect(res.body.data.notYetClaimable).toHaveLength(1);
      expect(res.body.data.notYetClaimable[0].id).toBe("000000002");
      expect(res.body.data.expired).toHaveLength(1);
      expect(res.body.data.expired[0].id).toBe("000000003");
    });

    it("handles complex predicates (AND)", async () => {
      const now = Math.floor(Date.now() / 1000);
      const mockRecords = [
        {
          id: "000000004",
          asset: "USDC",
          amount: "50.0000000",
          claimants: [
            { 
              destination: accountId, 
              predicate: { 
                and: [
                  { abs_after: new Date((now - 1000) * 1000).toISOString() },
                  { abs_before: new Date((now + 1000) * 1000).toISOString() }
                ] 
              } 
            }
          ]
        }
      ];

      server.claimableBalances.mockReturnValue({
        forClaimant: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: mockRecords })
      });

      const res = await request(app).get(`/account/${accountId}/claimable-balances`);
      expect(res.body.data.eligible).toHaveLength(1);
    });

    it("validates account ID", async () => {
      const res = await request(app).get("/account/INVALID/claimable-balances");
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /account/:id/claimable-balances — cache", () => {
    it("returns X-Cache: MISS on first request", async () => {
      mockClaimableBalances([
        {
          id: "000000001",
          asset: "XLM",
          amount: "100.0000000",
          claimants: [{ destination: accountId, predicate: { unconditional: true } }],
        },
      ]);

      const res = await request(app).get(`/account/${accountId}/claimable-balances`);

      expect(res.statusCode).toBe(200);
      expect(res.headers["x-cache"]).toBe("MISS");
      expect(res.body.data.eligible).toHaveLength(1);
    });

    it("returns X-Cache: HIT on second request within TTL", async () => {
      mockClaimableBalances([
        {
          id: "000000001",
          asset: "XLM",
          amount: "100.0000000",
          claimants: [{ destination: accountId, predicate: { unconditional: true } }],
        },
      ]);

      await request(app).get(`/account/${accountId}/claimable-balances`);
      const res = await request(app).get(`/account/${accountId}/claimable-balances`);

      expect(res.statusCode).toBe(200);
      expect(res.headers["x-cache"]).toBe("HIT");
      expect(res.body.data.eligible).toHaveLength(1);
      expect(server.claimableBalances).toHaveBeenCalledTimes(1);
    });

    it("bypasses cache with ?fresh=true and returns MISS", async () => {
      mockClaimableBalances([
        {
          id: "000000001",
          asset: "XLM",
          amount: "100.0000000",
          claimants: [{ destination: accountId, predicate: { unconditional: true } }],
        },
      ]);

      await request(app).get(`/account/${accountId}/claimable-balances`);
      const res = await request(app).get(
        `/account/${accountId}/claimable-balances?fresh=true`
      );

      expect(res.statusCode).toBe(200);
      expect(res.headers["x-cache"]).toBe("MISS");
      expect(server.claimableBalances).toHaveBeenCalledTimes(2);
    });

    it("caches responses separately per account ID", async () => {
      const otherAccountId = Keypair.random().publicKey();

      mockClaimableBalances([
        {
          id: "000000001",
          asset: "XLM",
          amount: "100.0000000",
          claimants: [{ destination: accountId, predicate: { unconditional: true } }],
        },
      ]);

      await request(app).get(`/account/${accountId}/claimable-balances`);

      mockClaimableBalances([
        {
          id: "000000002",
          asset: "USDC",
          amount: "50.0000000",
          claimants: [{ destination: otherAccountId, predicate: { unconditional: true } }],
        },
      ]);

      const res = await request(app).get(`/account/${otherAccountId}/claimable-balances`);

      expect(res.headers["x-cache"]).toBe("MISS");
      expect(res.body.data.eligible[0].id).toBe("000000002");
    });
  });
});
