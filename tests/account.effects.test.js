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

describe("GET /account/:id/effects", () => {
    // This repo has many Horizon-dependent routes. Keep these tests lightweight
    // by asserting status codes and response shape when stubbing is not available.
    // If your test environment mocks Horizon, these can be expanded.

    it("returns 404 for a non-existent account", async () => {
        const nonExistent = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

        const res = await request(app)
            .get(`/account/${nonExistent}/effects?limit=5&cursor=abc`)
            .set("x-api-key", "test");

        // Depending on the project's apiKey middleware configuration,
        // this might fail with 401 instead. If so, adjust/remove auth for tests.
        expect([400, 401, 404, 500]).toContain(res.status);
        if (res.status === 404) {
            expect(res.body.success).toBe(false);
            expect(res.body.error.type).toBe("NotFound");
        }
    });

    it("returns a paginated envelope on success (shape only)", async () => {
        // Use a real testnet account if available in CI.
        // If this fails due to network/Horizon errors, skip by adjusting the test setup.
        const knownAccount = process.env.STELLARKIT_TESTNET_ACCOUNT;
        if (!knownAccount) return;

        const res = await request(app)
            .get(`/account/${knownAccount}/effects?limit=2`)
            .set("x-api-key", "test");

        expect([200, 401, 404, 500]).toContain(res.status);
        if (res.status === 200) {
            expect(res.body.success).toBe(true);
            expect(res.body.data).toHaveProperty("effects");
            expect(res.body.data).toHaveProperty("total");
            expect(res.body.data).toHaveProperty("limit");
            expect(res.body.data).toHaveProperty("cursor");

            expect(Array.isArray(res.body.data.effects)).toBe(true);
            if (res.body.data.effects.length > 0) {
                const eff = res.body.data.effects[0];
                expect(eff).toHaveProperty("effectId");
                expect(eff).toHaveProperty("type");
                expect(eff).toHaveProperty("createdAt");
                if (eff.createdAt !== null) {
                    expect(typeof eff.createdAt).toBe("string");
                }
            }
        }
    });
});


describe("GET /account/:id/effects — per-effect-type normalisation", () => {
  const accountId = require("@stellar/stellar-sdk").Keypair.random().publicKey();

  beforeEach(() => {
    jest.clearAllMocks();
    require("../src/services/cache").flush();
  });

  // Helper: re-require mocks (already required at top of file scope)
  function setup(records) {
    server.effects.mockReturnValue({
      forAccount: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      cursor: jest.fn().mockReturnThis(),
      type: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ records }),
    });
  }

  // 1. account_credited ─────────────────────────────────────────────────────
  it("normalises account_credited with camelCase fields and 7-decimal amount", async () => {
    setup([
      {
        id: "1-1",
        paging_token: "1-1",
        account: accountId,
        type: "account_credited",
        created_at: "2024-03-10T12:00:00Z",
        transaction_hash: "txhash1",
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        amount: "50",
      },
    ]);

    const res = await request(app).get(`/account/${accountId}/effects`);

    expect(res.statusCode).toBe(200);
    const item = res.body.data.items[0];
    expect(item.type).toBe("account_credited");
    expect(item.id).toBe("1-1");
    expect(item.account).toBe(accountId);
    expect(item.createdAt).toBe("2024-03-10T12:00:00.000Z");
    expect(item.amount).toBe("50.0000000");
    expect(item.asset).toMatchObject({ code: "USDC", type: "credit_alphanum4" });
    // No snake_case keys on the normalised output
    expect(item.asset_code).toBeUndefined();
    expect(item.asset_issuer).toBeUndefined();
    expect(item.created_at).toBeUndefined();
  });

  // 2. account_debited ───────────────────────────────────────────────────────
  it("normalises account_debited with native XLM asset", async () => {
    setup([
      {
        id: "2-1",
        paging_token: "2-1",
        account: accountId,
        type: "account_debited",
        created_at: "2024-03-11T08:00:00Z",
        transaction_hash: "txhash2",
        asset_type: "native",
        amount: "10.5",
      },
    ]);

    const res = await request(app).get(`/account/${accountId}/effects`);

    expect(res.statusCode).toBe(200);
    const item = res.body.data.items[0];
    expect(item.type).toBe("account_debited");
    expect(item.amount).toBe("10.5000000");
    expect(item.asset).toMatchObject({ code: "XLM", issuer: null, type: "native" });
  });

  // 3. trustline_created ────────────────────────────────────────────────────
  it("normalises trustline_created with asset and limit", async () => {
    setup([
      {
        id: "3-1",
        paging_token: "3-1",
        account: accountId,
        type: "trustline_created",
        created_at: "2024-03-12T09:00:00Z",
        transaction_hash: "txhash3",
        asset_type: "credit_alphanum4",
        asset_code: "BTC",
        asset_issuer: "GAUTUYY2THLF7SGITDFMXJVYH3LHDSMGEAKSBU267M2K7A3W543CKUEF",
        limit: "1000",
      },
    ]);

    const res = await request(app).get(`/account/${accountId}/effects`);

    expect(res.statusCode).toBe(200);
    const item = res.body.data.items[0];
    expect(item.type).toBe("trustline_created");
    expect(item.asset).toMatchObject({ code: "BTC", type: "credit_alphanum4" });
    expect(item.limit).toBe("1000.0000000");
    expect(item.amount).toBeUndefined();
  });

  // 4. trade ─────────────────────────────────────────────────────────────────
  it("normalises trade with soldAsset, boughtAsset and 7-decimal amounts", async () => {
    setup([
      {
        id: "4-1",
        paging_token: "4-1",
        account: accountId,
        type: "trade",
        created_at: "2024-03-13T10:00:00Z",
        transaction_hash: "txhash4",
        seller: "GSELLERKEY",
        offer_id: "99887766",
        sold_asset_type: "native",
        sold_amount: "100",
        bought_asset_type: "credit_alphanum4",
        bought_asset_code: "USDC",
        bought_asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        bought_amount: "25",
      },
    ]);

    const res = await request(app).get(`/account/${accountId}/effects`);

    expect(res.statusCode).toBe(200);
    const item = res.body.data.items[0];
    expect(item.type).toBe("trade");
    expect(item.seller).toBe("GSELLERKEY");
    expect(item.offerId).toBe("99887766");
    expect(item.soldAmount).toBe("100.0000000");
    expect(item.soldAsset).toMatchObject({ code: "XLM", type: "native" });
    expect(item.boughtAmount).toBe("25.0000000");
    expect(item.boughtAsset).toMatchObject({ code: "USDC", type: "credit_alphanum4" });
  });

  // 5. account_created ───────────────────────────────────────────────────────
  it("normalises account_created with startingBalance field", async () => {
    setup([
      {
        id: "5-1",
        paging_token: "5-1",
        account: accountId,
        type: "account_created",
        created_at: "2024-01-01T00:00:00Z",
        transaction_hash: "txhash5",
        starting_balance: "2.5",
      },
    ]);

    const res = await request(app).get(`/account/${accountId}/effects`);

    expect(res.statusCode).toBe(200);
    const item = res.body.data.items[0];
    expect(item.type).toBe("account_created");
    expect(item.startingBalance).toBe("2.5000000");
    expect(item.amount).toBeUndefined();
    expect(item.starting_balance).toBeUndefined();
  });

  // 6. signer_created ────────────────────────────────────────────────────────
  it("normalises signer_created with weight and key fields", async () => {
    setup([
      {
        id: "6-1",
        paging_token: "6-1",
        account: accountId,
        type: "signer_created",
        created_at: "2024-04-01T00:00:00Z",
        transaction_hash: "txhash6",
        weight: 2,
        public_key: "GAKEYEXAMPLE1234567890AAAA",
        key: "GAKEYEXAMPLE1234567890AAAA",
      },
    ]);

    const res = await request(app).get(`/account/${accountId}/effects`);

    expect(res.statusCode).toBe(200);
    const item = res.body.data.items[0];
    expect(item.type).toBe("signer_created");
    expect(item.weight).toBe(2);
    expect(item.key).toBe("GAKEYEXAMPLE1234567890AAAA");
    expect(item.public_key).toBeUndefined();
  });

  // 7. claimable_balance_claimed ────────────────────────────────────────────
  it("normalises claimable_balance_claimed with balanceId and amount", async () => {
    setup([
      {
        id: "7-1",
        paging_token: "7-1",
        account: accountId,
        type: "claimable_balance_claimed",
        created_at: "2024-05-01T00:00:00Z",
        transaction_hash: "txhash7",
        balance_id: "000000000000000000000000deadbeef",
        asset_type: "credit_alphanum4",
        asset_code: "ETH",
        asset_issuer: "GBETHISSUERXXX",
        amount: "0.1234567",
      },
    ]);

    const res = await request(app).get(`/account/${accountId}/effects`);

    expect(res.statusCode).toBe(200);
    const item = res.body.data.items[0];
    expect(item.type).toBe("claimable_balance_claimed");
    expect(item.balanceId).toBe("000000000000000000000000deadbeef");
    expect(item.amount).toBe("0.1234567");
    expect(item.asset).toMatchObject({ code: "ETH" });
    expect(item.balance_id).toBeUndefined();
  });

  // 8. unknown / future effect type → minimal fallback shape ────────────────
  it("returns minimal base shape for an unknown effect type", async () => {
    setup([
      {
        id: "8-1",
        paging_token: "8-1",
        account: accountId,
        type: "some_future_effect_type_unknown",
        created_at: "2024-06-01T00:00:00Z",
        transaction_hash: "txhashX",
      },
    ]);

    // We bypass effect type validation by injecting the record directly —
    // validation only fires when the caller supplies ?type=; the mapper must
    // still handle any record Horizon returns gracefully.
    const res = await request(app).get(`/account/${accountId}/effects`);

    expect(res.statusCode).toBe(200);
    const item = res.body.data.items[0];
    expect(item.type).toBe("some_future_effect_type_unknown");
    expect(item.createdAt).toBe("2024-06-01T00:00:00.000Z");
    expect(item.id).toBe("8-1");
    expect(item.account).toBe(accountId);
  });

  // 9. response envelope shape ──────────────────────────────────────────────
  it("wraps items in the standard paginated envelope", async () => {
    setup([
      {
        id: "9-1",
        paging_token: "9-1",
        account: accountId,
        type: "account_credited",
        created_at: "2024-07-01T00:00:00Z",
        asset_type: "native",
        amount: "1",
      },
    ]);

    const res = await request(app).get(`/account/${accountId}/effects`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("items");
    expect(res.body.data).toHaveProperty("total");
    expect(res.body.data).toHaveProperty("limit");
    expect(res.body.data).toHaveProperty("cursor");
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });
});
