const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const { Keypair } = require("@stellar/stellar-sdk");
const cacheService = require("../src/services/cache");

jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    server: {
      effects: jest.fn(),
    },
  };
});

function mockEffects(records) {
  server.effects.mockReturnValue({
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    type: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  });
}

describe("GET /account/:id/effects", () => {
  const accountId = Keypair.random().publicKey();

  const mockRecords = [
    {
      id: "000000001-0001",
      paging_token: "000000001-0001",
      account: accountId,
      type: "account_credited",
      created_at: "2024-01-01T00:00:00Z",
      transaction_hash: "abc123",
      asset: "XLM",
      amount: "100.0000000",
      balance: "100.0000000",
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  it("returns paginated effects for a valid account", async () => {
    mockEffects(mockRecords);

    const res = await request(app).get(`/account/${accountId}/effects`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0]).toMatchObject({
      id: "000000001-0001",
      type: "account_credited",
      account: accountId,
      amount: "100.0000000",
    });
    expect(res.headers["x-cache"]).toBe("MISS");
  });

  describe("type filter", () => {
    it("returns only effects matching ?type=account_credited", async () => {
      mockEffects([
        {
          id: "000000001-0001",
          paging_token: "000000001-0001",
          account: accountId,
          type: "account_credited",
          created_at: "2024-01-01T00:00:00Z",
          transaction_hash: "abc123",
          asset: "XLM",
          amount: "100.0000000",
        },
      ]);

      const res = await request(app).get(
        `/account/${accountId}/effects?type=account_credited`
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items.every((e) => e.type === "account_credited")).toBe(true);

      const builder = server.effects.mock.results[0].value;
      expect(builder.type).toHaveBeenCalledWith("account_credited");
    });

    it("returns 400 with valid types listed for an unrecognised type", async () => {
      const res = await request(app).get(
        `/account/${accountId}/effects?type=not_a_real_effect`
      );

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
      expect(res.body.error.message).toContain("Unrecognised effect type");
      for (const validType of ["account_credited", "trustline_created", "trade"]) {
        expect(res.body.error.message).toContain(validType);
      }
      expect(server.effects).not.toHaveBeenCalled();
    });

    it("returns all effect types when type param is omitted", async () => {
      mockEffects([
        {
          id: "000000001-0001",
          paging_token: "000000001-0001",
          account: accountId,
          type: "account_credited",
          created_at: "2024-01-01T00:00:00Z",
        },
        {
          id: "000000002-0001",
          paging_token: "000000002-0001",
          account: accountId,
          type: "trustline_created",
          created_at: "2024-01-02T00:00:00Z",
        },
      ]);

      const res = await request(app).get(`/account/${accountId}/effects`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.items).toHaveLength(2);
      expect(res.body.data.items.map((e) => e.type).sort()).toEqual([
        "account_credited",
        "trustline_created",
      ]);

      const builder = server.effects.mock.results[0].value;
      expect(builder.type).not.toHaveBeenCalled();
    });
  });

  describe("cache", () => {
    it("returns X-Cache: MISS on first request", async () => {
      mockEffects(mockRecords);

      const res = await request(app).get(`/account/${accountId}/effects`);

      expect(res.headers["x-cache"]).toBe("MISS");
    });

    it("returns X-Cache: HIT on second request within TTL", async () => {
      mockEffects(mockRecords);

      await request(app).get(`/account/${accountId}/effects`);
      const res = await request(app).get(`/account/${accountId}/effects`);

      expect(res.headers["x-cache"]).toBe("HIT");
      expect(server.effects).toHaveBeenCalledTimes(1);
    });

    it("bypasses cache with ?fresh=true and returns MISS", async () => {
      mockEffects(mockRecords);

      await request(app).get(`/account/${accountId}/effects`);
      const res = await request(app).get(
        `/account/${accountId}/effects?fresh=true`
      );

      expect(res.headers["x-cache"]).toBe("MISS");
      expect(server.effects).toHaveBeenCalledTimes(2);
    });

    it("caches separately per pagination params", async () => {
      mockEffects(mockRecords);

      await request(app).get(`/account/${accountId}/effects?limit=10`);
      const res = await request(app).get(`/account/${accountId}/effects?limit=20`);

      expect(res.headers["x-cache"]).toBe("MISS");
      expect(server.effects).toHaveBeenCalledTimes(2);
    });

    it("caches separately per account ID", async () => {
      const otherAccountId = Keypair.random().publicKey();

      mockEffects(mockRecords);
      await request(app).get(`/account/${accountId}/effects`);

      mockEffects([
        {
          ...mockRecords[0],
          id: "000000002-0001",
          paging_token: "000000002-0001",
          account: otherAccountId,
        },
      ]);

      const res = await request(app).get(`/account/${otherAccountId}/effects`);

      expect(res.headers["x-cache"]).toBe("MISS");
      expect(res.body.data.items[0].id).toBe("000000002-0001");
    });
  });
});
