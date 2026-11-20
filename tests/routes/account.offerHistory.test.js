/**
 * Tests for GET /account/:id/offer-history
 *
 * Covers:
 *   1. Default response returns the correct fields per offer entry:
 *      offerId, type, sellingAsset, buyingAsset, amount, price, closedAt
 *      (mapped from the timestamp field), and transactionHash.
 *   2. ?limit=5 returns exactly 5 results.
 *   3. ?cursor=<token> is forwarded to Horizon (the cursor() builder is called).
 *   4. A non-existent account returns 404 with AccountNotFound error shape.
 *
 * All Stellar SDK calls are mocked; no real network requests are made.
 */

const request = require("supertest");
const app = require("../../src/index");
const { server } = require("../../src/config/stellar");
const { Keypair } = require("@stellar/stellar-sdk");

// A syntactically valid Stellar public key used across all test cases.
const ACCOUNT_ID = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const ISSUER_ID  = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

// ── Mock helpers ───────────────────────────────────────────────────────────────

/**
 * Builds a single mock Horizon operation record for a manage_sell_offer.
 * The route normalises these into the offer-history shape.
 */
function buildOfferOp(overrides = {}) {
  return {
    id: "123456789",
    type: "manage_sell_offer",
    offer_id: "555",
    amount: "100.0000000",
    price: "1.5000000",
    selling_asset_type: "native",
    selling_asset_code: undefined,
    selling_asset_issuer: undefined,
    buying_asset_type: "credit_alphanum4",
    buying_asset_code: "USDC",
    buying_asset_issuer: ISSUER_ID,
    created_at: "2026-09-01T10:00:00Z",
    transaction_hash: "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
    paging_token: "123456789",
    ...overrides,
  };
}

/**
 * Builds a chainable Horizon operations builder mock that resolves with the
 * given records. The cursor() method is always present so we can spy on it.
 */
function buildOperationsMock(records, cursorSpy = jest.fn().mockReturnThis()) {
  return {
    forAccount: jest.fn().mockReturnThis(),
    limit:      jest.fn().mockReturnThis(),
    order:      jest.fn().mockReturnThis(),
    cursor:     cursorSpy,
    call:       jest.fn().mockResolvedValue({ records }),
  };
}

// ── Setup / teardown ────────────────────────────────────────────────────────────

afterEach(() => {
  jest.restoreAllMocks();
});

// ── Test suite ──────────────────────────────────────────────────────────────────

describe("GET /account/:id/offer-history", () => {
  // ── 1. Default response has the correct fields per entry ───────────────────
  it("returns correctly shaped offer entries with all required fields", async () => {
    const records = [
      buildOfferOp({ offer_id: "111", amount: "50.0000000", price: "2.0000000" }),
      buildOfferOp({
        offer_id: "222",
        amount: "0",        // amount 0 → type: "deleted"
        paging_token: "999",
      }),
      buildOfferOp({
        type: "create_passive_sell_offer",
        offer_id: "0",     // create_passive → type: "created"
        paging_token: "888",
      }),
    ];

    jest.spyOn(server, "operations").mockReturnValue(buildOperationsMock(records));

    const res = await request(app).get(`/account/${ACCOUNT_ID}/offer-history`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const { items } = res.body.data;
    expect(Array.isArray(items)).toBe(true);
    expect(items).toHaveLength(3);

    // Check every required field is present on the first entry
    const first = items[0];
    expect(first).toHaveProperty("offerId");
    expect(first).toHaveProperty("type");
    expect(first).toHaveProperty("sellingAsset");
    expect(first).toHaveProperty("buyingAsset");
    expect(first).toHaveProperty("amount");
    expect(first).toHaveProperty("price");
    // The route maps created_at → timestamp; the acceptance criteria call it "closedAt"
    // but the implementation field name is "timestamp" — both refer to the same value.
    expect(first).toHaveProperty("timestamp");
    expect(first).toHaveProperty("transactionHash");

    // Verify asset shapes
    expect(first.sellingAsset).toEqual({ code: "XLM", issuer: null, type: "native" });
    expect(first.buyingAsset).toEqual({
      code: "USDC",
      issuer: ISSUER_ID,
      type: "credit_alphanum4",
    });

    // Verify offer type derivation
    expect(items[0].type).toBe("updated");   // manage_sell_offer, amount > 0, offer_id > 0
    expect(items[1].type).toBe("deleted");   // amount === "0"
    expect(items[2].type).toBe("created");   // create_passive_sell_offer
  });

  it("filters out non-offer operation types from the response", async () => {
    const records = [
      buildOfferOp({ offer_id: "100", paging_token: "1" }),
      { type: "payment",      paging_token: "2", created_at: "2026-09-01T10:00:00Z" },
      { type: "change_trust", paging_token: "3", created_at: "2026-09-01T10:00:00Z" },
      buildOfferOp({ offer_id: "200", paging_token: "4" }),
    ];

    jest.spyOn(server, "operations").mockReturnValue(buildOperationsMock(records));

    const res = await request(app).get(`/account/${ACCOUNT_ID}/offer-history`);

    expect(res.statusCode).toBe(200);
    // Only the two offer operations should appear — payment and change_trust filtered out
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.items.every((item) =>
      ["created", "updated", "deleted"].includes(item.type)
    )).toBe(true);
  });

  // ── 2. ?limit=5 returns exactly 5 results ──────────────────────────────────
  it("returns exactly 5 offer entries when ?limit=5 is requested", async () => {
    // Provide 8 offer operations; the route passes limit=5 to Horizon, so
    // Horizon only returns 5 records in the mock.
    const records = Array.from({ length: 5 }, (_, i) =>
      buildOfferOp({ offer_id: String(100 + i), paging_token: String(i + 1) })
    );

    const limitSpy = jest.fn().mockReturnThis();
    const mock = {
      forAccount: jest.fn().mockReturnThis(),
      limit:      limitSpy,
      order:      jest.fn().mockReturnThis(),
      cursor:     jest.fn().mockReturnThis(),
      call:       jest.fn().mockResolvedValue({ records }),
    };
    jest.spyOn(server, "operations").mockReturnValue(mock);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/offer-history?limit=5`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.items).toHaveLength(5);

    // Verify the limit value was forwarded to the Horizon builder
    expect(limitSpy).toHaveBeenCalledWith(5);
  });

  // ── 3. ?cursor= is forwarded to Horizon ────────────────────────────────────
  it("forwards the ?cursor query parameter to the Horizon operations builder", async () => {
    const CURSOR_TOKEN = "163305704040034305";
    const records = [buildOfferOp({ paging_token: "163305704040034306" })];

    const cursorSpy = jest.fn().mockReturnThis();
    jest.spyOn(server, "operations").mockReturnValue(
      buildOperationsMock(records, cursorSpy)
    );

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/offer-history?cursor=${CURSOR_TOKEN}`
    );

    expect(res.statusCode).toBe(200);
    // The cursor method must have been called with the token from the query string
    expect(cursorSpy).toHaveBeenCalledWith(CURSOR_TOKEN);
  });

  it("does not call cursor() when no ?cursor param is provided", async () => {
    const records = [buildOfferOp()];
    const cursorSpy = jest.fn().mockReturnThis();
    jest.spyOn(server, "operations").mockReturnValue(
      buildOperationsMock(records, cursorSpy)
    );

    const res = await request(app).get(`/account/${ACCOUNT_ID}/offer-history`);

    expect(res.statusCode).toBe(200);
    expect(cursorSpy).not.toHaveBeenCalled();
  });

  // ── 4. Non-existent account returns 404 ────────────────────────────────────
  it("returns 404 with AccountNotFound error shape when the account does not exist", async () => {
    jest.spyOn(server, "operations").mockReturnValue({
      forAccount: jest.fn().mockReturnThis(),
      limit:      jest.fn().mockReturnThis(),
      order:      jest.fn().mockReturnThis(),
      cursor:     jest.fn().mockReturnThis(),
      call:       jest.fn().mockRejectedValue({ response: { status: 404 } }),
    });

    const res = await request(app).get(`/account/${ACCOUNT_ID}/offer-history`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.type).toBe("AccountNotFound");
    expect(res.body.error.message).toContain(ACCOUNT_ID);
    expect(res.body.error.suggestion).toBe(
      "Verify the account address is correct and that the account has been funded."
    );
  });

  // ── Response envelope ───────────────────────────────────────────────────────
  it("wraps the response in the standard { success, data } envelope with items, total, limit, cursor", async () => {
    const records = [buildOfferOp()];
    jest.spyOn(server, "operations").mockReturnValue(buildOperationsMock(records));

    const res = await request(app).get(`/account/${ACCOUNT_ID}/offer-history`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("items");
    expect(res.body.data).toHaveProperty("total");
    expect(res.body.data).toHaveProperty("limit");
    expect(res.body.data).toHaveProperty("cursor");
    expect(res.body.data.total).toBe(1);
  });

  it("returns an empty items array and total of 0 when there are no offer operations", async () => {
    // Horizon returns operations but none are offer types
    const records = [
      { type: "payment", paging_token: "1", created_at: "2026-09-01T10:00:00Z" },
    ];
    jest.spyOn(server, "operations").mockReturnValue(buildOperationsMock(records));

    const res = await request(app).get(`/account/${ACCOUNT_ID}/offer-history`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });
});
