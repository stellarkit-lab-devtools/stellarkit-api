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
    claimant: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  });
}

describe("Account Claimable Balances API", () => {
  const accountId = Keypair.random().publicKey();

  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  describe("GET /account/:id/claimable-balances", () => {
    it("returns paginated claimable balances with normalized shape", async () => {
      const mockRecords = [
        {
          id: "000000001",
          asset: "native",
          amount: "100.0000000",
          sponsor: "GSPONSOR1",
          created_at: "2024-01-01T00:00:00Z",
          paging_token: "paging-token-1",
          claimants: [
            { destination: accountId, predicate: { unconditional: true } }
          ]
        }
      ];

      mockClaimableBalances(mockRecords);

      const res = await request(app).get(`/account/${accountId}/claimable-balances`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({
        balanceId: "000000001",
        amount: "100.0000000",
        sponsor: "GSPONSOR1",
        createdAt: "2024-01-01T00:00:00Z",
      });
      expect(res.body.meta).toMatchObject({
        count: 1,
        limit: 20,
        hasMore: false,
      });
    });

    it("normalizes native XLM asset correctly", async () => {
      mockClaimableBalances([
        {
          id: "balance-1",
          asset: "native",
          amount: "50.0000000",
          sponsor: "GSPONSOR",
          created_at: "2024-01-01T00:00:00Z",
          paging_token: "pt-1",
          claimants: [{ destination: accountId, predicate: { unconditional: true } }],
        },
      ]);

      const res = await request(app).get(`/account/${accountId}/claimable-balances`);

      const asset = res.body.data[0].asset;
      expect(asset.code).toBe("XLM");
      expect(asset.issuer).toBeNull();
      expect(asset.type).toBe("native");
    });

    it("normalizes credit asset correctly", async () => {
      mockClaimableBalances([
        {
          id: "balance-2",
          asset: `USDC:GBBD47UZQ5XKLQN4V5CSTBKLWV6N3ZRWMVVQGQ3YRRY2AAAA64BVH4I`,
          amount: "123.4560000",
          sponsor: "GSPONSOR",
          created_at: "2024-01-01T00:00:00Z",
          paging_token: "pt-2",
          claimants: [{ destination: accountId, predicate: { unconditional: true } }],
        },
      ]);

      const res = await request(app).get(`/account/${accountId}/claimable-balances`);

      const asset = res.body.data[0].asset;
      expect(asset.code).toBe("USDC");
      expect(asset.issuer).toBe("GBBD47UZQ5XKLQN4V5CSTBKLWV6N3ZRWMVVQGQ3YRRY2AAAA64BVH4I");
      expect(asset.type).toBe("credit_alphanum4");
    });

    it("formats amount as seven-decimal string", async () => {
      mockClaimableBalances([
        {
          id: "balance-3",
          asset: "native",
          amount: "42.5",
          sponsor: "GSPONSOR",
          created_at: "2024-01-01T00:00:00Z",
          paging_token: "pt-3",
          claimants: [{ destination: accountId, predicate: { unconditional: true } }],
        },
      ]);

      const res = await request(app).get(`/account/${accountId}/claimable-balances`);

      expect(res.body.data[0].amount).toBe("42.5000000");
    });

    it("supports limit parameter", async () => {
      const records = Array.from({ length: 50 }, (_, i) => ({
        id: `balance-${i}`,
        asset: "native",
        amount: "100.0000000",
        sponsor: "GSPONSOR",
        created_at: "2024-01-01T00:00:00Z",
        paging_token: `pt-${i}`,
        claimants: [{ destination: accountId, predicate: { unconditional: true } }],
      }));

      mockClaimableBalances(records);

      const res = await request(app).get(`/account/${accountId}/claimable-balances?limit=50`);

      expect(res.body.data).toHaveLength(50);
      expect(res.body.meta.limit).toBe(50);
      expect(res.body.meta.hasMore).toBe(false);
    });

    it("supports cursor parameter", async () => {
      mockClaimableBalances([
        {
          id: "balance-10",
          asset: "native",
          amount: "100.0000000",
          sponsor: "GSPONSOR",
          created_at: "2024-01-01T00:00:00Z",
          paging_token: "pt-10",
          claimants: [{ destination: accountId, predicate: { unconditional: true } }],
        },
      ]);

      const res = await request(app).get(`/account/${accountId}/claimable-balances?cursor=cursor-token`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(server.claimableBalances).toHaveBeenCalled();
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
          id: "balance-1",
          asset: "native",
          amount: "100.0000000",
          sponsor: "GSPONSOR",
          created_at: "2024-01-01T00:00:00Z",
          paging_token: "pt-1",
          claimants: [{ destination: accountId, predicate: { unconditional: true } }],
        },
      ]);

      const res = await request(app).get(`/account/${accountId}/claimable-balances`);

      expect(res.statusCode).toBe(200);
      expect(res.headers["x-cache"]).toBe("MISS");
      expect(res.body.data).toHaveLength(1);
    });

    it("returns X-Cache: HIT on second request within TTL", async () => {
      mockClaimableBalances([
        {
          id: "balance-1",
          asset: "native",
          amount: "100.0000000",
          sponsor: "GSPONSOR",
          created_at: "2024-01-01T00:00:00Z",
          paging_token: "pt-1",
          claimants: [{ destination: accountId, predicate: { unconditional: true } }],
        },
      ]);

      await request(app).get(`/account/${accountId}/claimable-balances`);
      const res = await request(app).get(`/account/${accountId}/claimable-balances`);

      expect(res.headers["x-cache"]).toBe("HIT");
      expect(server.claimableBalances).toHaveBeenCalledTimes(1);
    });

    it("bypasses cache with ?fresh=true and returns MISS", async () => {
      mockClaimableBalances([
        {
          id: "balance-1",
          asset: "native",
          amount: "100.0000000",
          sponsor: "GSPONSOR",
          created_at: "2024-01-01T00:00:00Z",
          paging_token: "pt-1",
          claimants: [{ destination: accountId, predicate: { unconditional: true } }],
        },
      ]);

      await request(app).get(`/account/${accountId}/claimable-balances`);
      const res = await request(app).get(`/account/${accountId}/claimable-balances?fresh=true`);

      expect(res.headers["x-cache"]).toBe("MISS");
      expect(server.claimableBalances).toHaveBeenCalledTimes(2);
    });

    it("caches responses separately per account ID", async () => {
      const otherAccountId = Keypair.random().publicKey();

      server.claimableBalances.mockReturnValue({
        claimant: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        cursor: jest.fn().mockReturnThis(),
        call: jest.fn().mockImplementation(() => {
          // Return different data for different accounts
          if (server.claimableBalances().claimant.mock.calls[0][0] === accountId) {
            return Promise.resolve({
              records: [
                {
                  id: "balance-for-account1",
                  asset: "native",
                  amount: "100.0000000",
                  sponsor: "GSPONSOR",
                  created_at: "2024-01-01T00:00:00Z",
                  paging_token: "pt-1",
                  claimants: [{ destination: accountId, predicate: { unconditional: true } }],
                },
              ],
            });
          } else {
            return Promise.resolve({
              records: [
                {
                  id: "balance-for-account2",
                  asset: "native",
                  amount: "200.0000000",
                  sponsor: "GSPONSOR",
                  created_at: "2024-01-02T00:00:00Z",
                  paging_token: "pt-2",
                  claimants: [{ destination: otherAccountId, predicate: { unconditional: true } }],
                },
              ],
            });
          }
        }),
      });

      await request(app).get(`/account/${accountId}/claimable-balances`);
      const res = await request(app).get(`/account/${otherAccountId}/claimable-balances`);

      expect(res.headers["x-cache"]).toBe("MISS");
      expect(res.body.data[0].balanceId).toBe("balance-for-account2");
    });
  });
});
