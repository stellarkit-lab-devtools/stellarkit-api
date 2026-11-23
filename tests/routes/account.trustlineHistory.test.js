const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../../src/config/stellar", () => {
  const originalModule = jest.requireActual("../../src/config/stellar");
  return {
    ...originalModule,
    server: {
      loadAccount: jest.fn(),
      effects: jest.fn(),
      operations: jest.fn(),
    },
  };
});

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");
const cacheService = require("../../src/services/cache");

const ACCOUNT = Keypair.random().publicKey();
const USDC_ISSUER = Keypair.random().publicKey();
const EURT_ISSUER = Keypair.random().publicKey();

let tokenCounter = 0;
function effect(type, overrides = {}) {
  tokenCounter += 1;
  const token = `${1000 + tokenCounter}-1`;
  return {
    id: token,
    paging_token: token,
    account: ACCOUNT,
    type,
    asset_type: "credit_alphanum4",
    asset_code: "USDC",
    asset_issuer: USDC_ISSUER,
    created_at: "2024-03-01T12:00:00Z",
    transaction_hash: `tx-${token}`,
    ...overrides,
  };
}

function filler(count) {
  return Array.from({ length: count }, () => effect("account_credited", { amount: "1.0000000" }));
}

/** Mocks server.effects() so successive .call()s return the given pages. */
function mockEffectPages(pages) {
  const call = jest.fn();
  pages.forEach((records) => call.mockResolvedValueOnce({ records }));
  call.mockResolvedValue({ records: [] });
  const builder = {
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call,
  };
  server.effects.mockReturnValue(builder);
  return builder;
}

beforeEach(() => {
  jest.clearAllMocks();
  cacheService.flush();
  server.loadAccount.mockResolvedValue({ id: ACCOUNT, account_id: ACCOUNT });
});

describe("GET /account/:id/trustline-history", () => {
  describe("event types", () => {
    it("maps every trustline effect to its lifecycle type", async () => {
      mockEffectPages([
        [
          effect("trustline_created", { limit: "1000.0000000" }),
          effect("trustline_updated", { limit: "500" }),
          effect("trustline_authorized", { asset_issuer: undefined, account: USDC_ISSUER, trustor: ACCOUNT }),
          effect("trustline_deauthorized", { asset_issuer: undefined, account: USDC_ISSUER, trustor: ACCOUNT }),
          effect("trustline_authorized_to_maintain_liabilities", {
            asset_issuer: undefined,
            account: USDC_ISSUER,
            trustor: ACCOUNT,
          }),
          effect("trustline_removed", { limit: "0.0000000" }),
          ...filler(2),
        ],
      ]);

      const res = await request(app).get(`/account/${ACCOUNT}/trustline-history`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.map((e) => e.type)).toEqual([
        "created",
        "limit_updated",
        "authorized",
        "deauthorized",
        "authorized_to_maintain_liabilities",
        "removed",
      ]);

      const [created, updated, authorized] = res.body.data;
      expect(created).toEqual({
        type: "created",
        asset: { code: "USDC", issuer: USDC_ISSUER, type: "credit_alphanum4" },
        limit: "1000.0000000",
        timestamp: "2024-03-01T12:00:00.000Z",
        transactionHash: expect.stringMatching(/^tx-/),
      });
      expect(updated.limit).toBe("500.0000000");
      expect(authorized.asset.issuer).toBe(USDC_ISSUER);
      expect(authorized.limit).toBeNull();
      expect(res.body.meta.partial).toBe(false);
      expect(res.body.meta.hasMore).toBe(false);
    });

    it("derives authorisation events from trustline_flags_updated", async () => {
      mockEffectPages([
        [
          effect("trustline_flags_updated", { authorized_flag: true }),
          effect("trustline_flags_updated", {
            authorized_flag: false,
            authorized_to_maintain_liabilites_flag: true,
          }),
          effect("trustline_flags_updated", { authorized_flag: false }),
          effect("trustline_flags_updated", { clawback_enabled_flag: true }),
        ],
      ]);

      const res = await request(app).get(`/account/${ACCOUNT}/trustline-history`);

      expect(res.status).toBe(200);
      expect(res.body.data.map((e) => e.type)).toEqual([
        "authorized",
        "authorized_to_maintain_liabilities",
        "deauthorized",
      ]);
    });

    it.each([
      ["created", "trustline_created"],
      ["removed", "trustline_removed"],
      ["limit_updated", "trustline_updated"],
      ["authorized", "trustline_authorized"],
      ["deauthorized", "trustline_deauthorized"],
      ["authorized_to_maintain_liabilities", "trustline_authorized_to_maintain_liabilities"],
    ])("?type=%s returns only %s events", async (type, horizonType) => {
      mockEffectPages([
        [
          effect("trustline_created"),
          effect("trustline_removed"),
          effect("trustline_updated"),
          effect("trustline_authorized"),
          effect("trustline_deauthorized"),
          effect("trustline_authorized_to_maintain_liabilities"),
        ],
      ]);

      const res = await request(app).get(`/account/${ACCOUNT}/trustline-history?type=${type}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].type).toBe(type);
      expect(horizonType).toContain("trustline_");
    });

    it("rejects an unknown ?type= with 400", async () => {
      const res = await request(app).get(`/account/${ACCOUNT}/trustline-history?type=frozen`);
      expect(res.status).toBe(400);
      expect(server.effects).not.toHaveBeenCalled();
    });
  });

  describe("asset filter", () => {
    it("?asset=CODE:ISSUER returns only that asset's events", async () => {
      mockEffectPages([
        [
          effect("trustline_created"),
          effect("trustline_created", { asset_code: "EURT", asset_issuer: EURT_ISSUER }),
          effect("trustline_removed", { asset_code: "EURT", asset_issuer: EURT_ISSUER }),
        ],
      ]);

      const res = await request(app).get(
        `/account/${ACCOUNT}/trustline-history?asset=EURT:${EURT_ISSUER}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      res.body.data.forEach((e) => {
        expect(e.asset).toEqual({ code: "EURT", issuer: EURT_ISSUER, type: "credit_alphanum4" });
      });
    });

    it("combines ?type= and ?asset=", async () => {
      mockEffectPages([
        [
          effect("trustline_created"),
          effect("trustline_created", { asset_code: "EURT", asset_issuer: EURT_ISSUER }),
          effect("trustline_removed", { asset_code: "EURT", asset_issuer: EURT_ISSUER }),
        ],
      ]);

      const res = await request(app).get(
        `/account/${ACCOUNT}/trustline-history?asset=EURT:${EURT_ISSUER}&type=removed`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].type).toBe("removed");
    });

    it("rejects a malformed ?asset= with 400", async () => {
      const res = await request(app).get(`/account/${ACCOUNT}/trustline-history?asset=USDC`);
      expect(res.status).toBe(400);
    });
  });

  describe("pagination and scan cap", () => {
    it("returns hasMore and a nextCursor when more events exist than the limit", async () => {
      const page = [effect("trustline_created"), effect("trustline_updated"), effect("trustline_removed")];
      mockEffectPages([page]);

      const res = await request(app).get(`/account/${ACCOUNT}/trustline-history?limit=2`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta.hasMore).toBe(true);
      expect(res.body.meta.nextCursor).toBe(page[1].paging_token);
      expect(res.body.meta.partial).toBe(false);
    });

    it("forwards the cursor and order to Horizon", async () => {
      const builder = mockEffectPages([[effect("trustline_created")]]);

      await request(app).get(`/account/${ACCOUNT}/trustline-history?cursor=12345&order=asc`);

      expect(builder.cursor).toHaveBeenCalledWith("12345");
      expect(builder.order).toHaveBeenCalledWith("asc");
      expect(builder.limit).toHaveBeenCalledWith(200);
    });

    it("scans further pages until enough events are found", async () => {
      const builder = mockEffectPages([
        [...filler(199), effect("trustline_created")],
        [effect("trustline_removed")],
      ]);

      const res = await request(app).get(`/account/${ACCOUNT}/trustline-history`);

      expect(res.status).toBe(200);
      expect(builder.call).toHaveBeenCalledTimes(2);
      expect(res.body.data.map((e) => e.type)).toEqual(["created", "removed"]);
      expect(res.body.meta.pagesScanned).toBe(2);
      expect(res.body.meta.partial).toBe(false);
    });

    it("stops after 10 pages and sets meta.partial when the cap is hit", async () => {
      const pages = Array.from({ length: 12 }, () => filler(200));
      pages[0][5] = effect("trustline_created");
      const builder = mockEffectPages(pages);

      const res = await request(app).get(`/account/${ACCOUNT}/trustline-history?limit=5`);

      expect(res.status).toBe(200);
      expect(builder.call).toHaveBeenCalledTimes(10);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.partial).toBe(true);
      expect(res.body.meta.hasMore).toBe(true);
      expect(res.body.meta.pagesScanned).toBe(10);
      expect(res.body.meta.nextCursor).toBe(pages[9][199].paging_token);
    });
  });

  describe("edge cases", () => {
    it("returns an empty list for an account with no trustlines", async () => {
      mockEffectPages([filler(3)]);

      const res = await request(app).get(`/account/${ACCOUNT}/trustline-history`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta).toMatchObject({
        count: 0,
        hasMore: false,
        partial: false,
        nextCursor: null,
      });
      expect(res.headers.link).toBeUndefined();
    });

    it("resolves transactionHash from the parent operation when the effect omits it", async () => {
      mockEffectPages([[effect("trustline_created", { transaction_hash: undefined, paging_token: "777-2" })]]);
      server.operations.mockReturnValue({
        operation: jest.fn().mockReturnValue({
          call: jest.fn().mockResolvedValue({ id: "777", transaction_hash: "resolved-hash" }),
        }),
      });

      const res = await request(app).get(`/account/${ACCOUNT}/trustline-history`);

      expect(res.status).toBe(200);
      expect(res.body.data[0].transactionHash).toBe("resolved-hash");
    });

    it("returns 404 for an unknown account", async () => {
      server.loadAccount.mockRejectedValue({ response: { status: 404 } });

      const res = await request(app).get(`/account/${ACCOUNT}/trustline-history`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(server.effects).not.toHaveBeenCalled();
    });

    it("returns 400 for an invalid account ID", async () => {
      const res = await request(app).get("/account/not-an-account/trustline-history");
      expect(res.status).toBe(400);
    });
  });
});
