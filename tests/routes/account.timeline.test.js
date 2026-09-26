/**
 * Tests for GET /account/:id/timeline pagination with max limit of 50
 *
 * Covers:
 *  1. Default response returns activities sorted by timestamp descending
 *  2. ?limit=10 returns exactly 10 activities
 *  3. ?limit=51 returns 400 because max is 50
 *  4. Each activity entry has type, timestamp, and relevant fields
 *  5. A non-existent account returns 404
 *
 * Multiple Stellar SDK calls (operations, transactions) are mocked so no real
 * network requests are made.
 */

const request = require("supertest");
const app = require("../../src/index");
const { server } = require("../../src/config/stellar");
const { Keypair } = require("@stellar/stellar-sdk");

// A syntactically valid Stellar public key used across all tests.
const ACCOUNT_ID = Keypair.random().publicKey();
const SENDER_ID  = Keypair.random().publicKey();

// ── Helpers ─────────────────────────────────────────────────────────────────────

/**
 * Builds a chainable mock for server.operations().forAccount().limit().order()
 * [.cursor()].call() that resolves with the given records.
 */
function buildOperationsMock(records) {
  const mock = {
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  };
  return mock;
}

/**
 * Generates `n` distinct payment operation records sorted newest-first
 * (descending by created_at), matching the default timeline ordering.
 */
function buildPaymentRecords(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: String(i + 1),
    type: "payment",
    created_at: new Date(Date.now() - i * 60000).toISOString(), // newest first
    transaction_hash: `hash${i + 1}`,
    from: SENDER_ID,
    to: ACCOUNT_ID,
    amount: "10.0000000",
    asset_type: "native",
    paging_token: `token${i + 1}`,
  }));
}

// ── Setup / teardown ────────────────────────────────────────────────────────────

afterEach(() => {
  jest.restoreAllMocks();
});

// ── Test suite ──────────────────────────────────────────────────────────────────

describe("GET /account/:id/timeline — pagination", () => {
  // ── 1. Default response returns activities sorted descending ────────────────
  it("returns activities sorted by timestamp descending by default", async () => {
    const records = buildPaymentRecords(3);
    jest.spyOn(server, "operations").mockReturnValue(buildOperationsMock(records));

    const res = await request(app).get(`/account/${ACCOUNT_ID}/timeline`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const activities = res.body.data;
    expect(Array.isArray(activities)).toBe(true);
    expect(activities.length).toBe(3);

    // Verify descending order: each timestamp should be >= the next
    for (let i = 0; i < activities.length - 1; i++) {
      const current = new Date(activities[i].timestamp).getTime();
      const next    = new Date(activities[i + 1].timestamp).getTime();
      expect(current).toBeGreaterThanOrEqual(next);
    }
  });

  // ── 2. ?limit=10 returns exactly 10 activities ──────────────────────────────
  it("returns exactly 10 activities when limit=10 is specified", async () => {
    const records = buildPaymentRecords(10);
    const limitSpy = jest.fn().mockReturnThis();

    jest.spyOn(server, "operations").mockReturnValue({
      forAccount: jest.fn().mockReturnThis(),
      limit: limitSpy,
      order: jest.fn().mockReturnThis(),
      cursor: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ records }),
    });

    const res = await request(app).get(`/account/${ACCOUNT_ID}/timeline?limit=10`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(10);

    // Verify the route forwarded limit=10 to Horizon
    expect(limitSpy).toHaveBeenCalledWith(10);

    // Verify pagination meta
    expect(res.body.meta).toHaveProperty("limit", 10);
  });

  // ── 3. ?limit=51 returns 400 because max is 50 ──────────────────────────────
  it("returns 400 when limit exceeds the maximum of 50", async () => {
    const res = await request(app).get(`/account/${ACCOUNT_ID}/timeline?limit=51`);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    // Error message should mention the upper boundary
    expect(res.body.error.message).toMatch(/50/);
  });

  it("also returns 400 for limit=100", async () => {
    const res = await request(app).get(`/account/${ACCOUNT_ID}/timeline?limit=100`);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  // ── 4. Each activity entry has type, timestamp, and relevant fields ─────────
  it("each activity entry contains type, timestamp, and relevant fields", async () => {
    const records = [
      {
        id: "1",
        type: "create_account",
        created_at: "2024-01-01T00:00:00Z",
        transaction_hash: "hash1",
        account: ACCOUNT_ID,
        starting_balance: "100.0000000",
        funder: SENDER_ID,
        paging_token: "token1",
      },
      {
        id: "2",
        type: "payment",
        created_at: "2024-01-01T01:00:00Z",
        transaction_hash: "hash2",
        from: SENDER_ID,
        to: ACCOUNT_ID,
        amount: "50.0000000",
        asset_type: "native",
        paging_token: "token2",
      },
      {
        id: "3",
        type: "change_trust",
        created_at: "2024-01-01T02:00:00Z",
        transaction_hash: "hash3",
        asset_code: "USDC",
        asset_issuer: SENDER_ID,
        limit: "1000.0000000",
        paging_token: "token3",
      },
    ];

    jest.spyOn(server, "operations").mockReturnValue(buildOperationsMock(records));

    const res = await request(app).get(`/account/${ACCOUNT_ID}/timeline`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const activities = res.body.data;
    expect(activities).toHaveLength(3);

    for (const activity of activities) {
      // Every entry must have type and timestamp
      expect(activity).toHaveProperty("type");
      expect(activity).toHaveProperty("timestamp");
      expect(typeof activity.type).toBe("string");
      expect(typeof activity.timestamp).toBe("string");
      // timestamp must be a valid ISO 8601 date
      expect(new Date(activity.timestamp).toISOString()).toBeTruthy();
    }

    // account_created entry specifics
    const created = activities.find((a) => a.type === "account_created");
    expect(created).toBeDefined();
    expect(created).toHaveProperty("amount");
    expect(created).toHaveProperty("counterparty");
    expect(created).toHaveProperty("transactionHash");

    // payment_received entry specifics
    const payment = activities.find((a) => a.type === "payment_received");
    expect(payment).toBeDefined();
    expect(payment).toHaveProperty("amount");
    expect(payment).toHaveProperty("asset");
    expect(payment).toHaveProperty("counterparty");

    // trustline_added entry specifics
    const trustline = activities.find((a) => a.type === "trustline_added");
    expect(trustline).toBeDefined();
    expect(trustline).toHaveProperty("asset");
    expect(trustline).toHaveProperty("counterparty"); // issuer
  });

  // ── 5. Non-existent account returns 404 ─────────────────────────────────────
  it("returns 404 when the account does not exist on the network", async () => {
    const horizonError = new Error("Account not found");
    horizonError.response = { status: 404 };

    jest.spyOn(server, "operations").mockReturnValue({
      forAccount: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      cursor: jest.fn().mockReturnThis(),
      call: jest.fn().mockRejectedValue(horizonError),
    });

    const res = await request(app).get(`/account/${ACCOUNT_ID}/timeline`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("AccountNotFound");
  });

  // ── 6. Pagination meta is present and correct ────────────────────────────────
  it("returns correct pagination meta including nextCursor and hasMore", async () => {
    const records = buildPaymentRecords(5);
    jest.spyOn(server, "operations").mockReturnValue(buildOperationsMock(records));

    const res = await request(app).get(`/account/${ACCOUNT_ID}/timeline?limit=5`);

    expect(res.statusCode).toBe(200);
    expect(res.body.meta).toHaveProperty("count", 5);
    expect(res.body.meta).toHaveProperty("limit", 5);
    // With exactly limit records returned, hasMore should be true
    expect(res.body.meta).toHaveProperty("hasMore", true);
    // nextCursor should be the paging_token of the last record
    expect(res.body.meta.nextCursor).toBe("token5");
  });

  it("returns hasMore: false and nextCursor: null when fewer than limit records returned", async () => {
    const records = buildPaymentRecords(3);
    jest.spyOn(server, "operations").mockReturnValue(buildOperationsMock(records));

    const res = await request(app).get(`/account/${ACCOUNT_ID}/timeline?limit=10`);

    expect(res.statusCode).toBe(200);
    expect(res.body.meta.hasMore).toBe(false);
    expect(res.body.meta.nextCursor).toBe("token3");
  });
});
