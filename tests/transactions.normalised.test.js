/**
 * Tests for GET /transactions/:id — normalised SDK mapping (feature d).
 *
 * Acceptance criteria:
 *   - Returns live data by calling server.transactions().forAccount(id).
 *   - Supports limit, cursor, and order query params.
 *   - Response follows the normalised shape:
 *       transactionHash, ledger, createdAt, operationCount, memo, successful
 *   - Returns 400 for an invalid account ID.
 *   - Returns 404 when the account does not exist on Horizon.
 *   - cursor in response is the paging_token of the last record.
 *
 * All Stellar SDK calls are mocked — no network calls are made.
 */

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => ({
  ...jest.requireActual("../src/config/stellar"),
  server: {
    loadAccount: jest.fn(),
    transactions: jest.fn(),
    operations: jest.fn(),
  },
  NETWORK: "testnet",
}));

const app = require("../src/index");
const { server } = require("../src/config/stellar");

// ── Constants ──────────────────────────────────────────────────────────────

const ACCOUNT_ID = Keypair.random().publicKey();
const TX_HASH_1  = "a".repeat(64);
const TX_HASH_2  = "b".repeat(64);

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a chainable mock for server.transactions() that returns `records`
 * when .call() is awaited.
 */
function mockTxChain(records) {
  const chain = {
    forAccount:    jest.fn().mockReturnThis(),
    limit:         jest.fn().mockReturnThis(),
    order:         jest.fn().mockReturnThis(),
    cursor:        jest.fn().mockReturnThis(),
    includeFailed: jest.fn().mockReturnThis(),
    transaction:   jest.fn().mockReturnThis(),
    call:          jest.fn().mockResolvedValue({ records }),
  };
  server.transactions.mockReturnValue(chain);
  return chain;
}

/**
 * Build a raw Horizon transaction record.
 */
function makeTx(overrides = {}) {
  return {
    id:              overrides.id           ?? "tx-id-001",
    hash:            overrides.hash         ?? TX_HASH_1,
    ledger:          overrides.ledger       ?? 500,
    ledger_attr:     overrides.ledger_attr  ?? 500,
    created_at:      overrides.created_at   ?? "2024-06-01T12:00:00Z",
    source_account:  overrides.source_account ?? ACCOUNT_ID,
    fee_charged:     overrides.fee_charged  ?? "100",
    max_fee:         overrides.max_fee      ?? "200",
    fee_account:     overrides.fee_account  ?? ACCOUNT_ID,
    operation_count: overrides.operation_count ?? 1,
    memo_type:       overrides.memo_type    ?? "none",
    memo:            overrides.memo         ?? undefined,
    successful:      overrides.successful   ?? true,
    envelope_xdr:    overrides.envelope_xdr ?? "AAAA==",
    paging_token:    overrides.paging_token ?? "pt-001",
    ...overrides,
  };
}

/** Simulate a Horizon 404 for account-not-found. */
function horizonNotFound() {
  const err = new Error("Not found");
  err.response = { status: 404 };
  return err;
}

// ── Setup / teardown ───────────────────────────────────────────────────────

beforeEach(() => jest.clearAllMocks());

// ── Suite ──────────────────────────────────────────────────────────────────

describe("GET /transactions/:id — normalised mapping", () => {

  // ── Live data call ────────────────────────────────────────────────────────

  describe("SDK call", () => {
    it("calls server.transactions().forAccount(id)", async () => {
      const chain = mockTxChain([makeTx()]);

      await request(app).get(`/transactions/${ACCOUNT_ID}`);

      expect(server.transactions).toHaveBeenCalled();
      expect(chain.forAccount).toHaveBeenCalledWith(ACCOUNT_ID);
    });

    it("calls includeFailed(false)", async () => {
      const chain = mockTxChain([]);

      await request(app).get(`/transactions/${ACCOUNT_ID}`);

      expect(chain.includeFailed).toHaveBeenCalledWith(false);
    });

    it("returns 200 with success: true", async () => {
      mockTxChain([makeTx()]);

      const res = await request(app).get(`/transactions/${ACCOUNT_ID}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ── Normalised shape ──────────────────────────────────────────────────────

  describe("normalised response shape", () => {
    it("maps transactionHash from tx.hash", async () => {
      mockTxChain([makeTx({ hash: TX_HASH_1 })]);

      const res = await request(app).get(`/transactions/${ACCOUNT_ID}`);

      expect(res.body.data.items[0].transactionHash).toBe(TX_HASH_1);
    });

    it("maps ledger correctly (numeric value)", async () => {
      mockTxChain([makeTx({ ledger: 42_000 })]);

      const res = await request(app).get(`/transactions/${ACCOUNT_ID}`);

      expect(res.body.data.items[0].ledger).toBe(42_000);
    });

    it("maps ledger_attr when ledger is not a number", async () => {
      mockTxChain([makeTx({ ledger: undefined, ledger_attr: 99_999 })]);

      const res = await request(app).get(`/transactions/${ACCOUNT_ID}`);

      expect(res.body.data.items[0].ledger).toBe(99_999);
    });

    it("maps createdAt as an ISO 8601 string", async () => {
      mockTxChain([makeTx({ created_at: "2024-01-15T08:30:00Z" })]);

      const res = await request(app).get(`/transactions/${ACCOUNT_ID}`);

      expect(res.body.data.items[0].createdAt).toBe("2024-01-15T08:30:00.000Z");
    });

    it("maps operationCount from tx.operation_count", async () => {
      mockTxChain([makeTx({ operation_count: 3 })]);

      const res = await request(app).get(`/transactions/${ACCOUNT_ID}`);

      expect(res.body.data.items[0].operationCount).toBe(3);
    });

    it("maps memo to null when absent", async () => {
      mockTxChain([makeTx({ memo: undefined })]);

      const res = await request(app).get(`/transactions/${ACCOUNT_ID}`);

      expect(res.body.data.items[0].memo).toBeNull();
    });

    it("maps memo to its string value when present", async () => {
      mockTxChain([makeTx({ memo: "hello world" })]);

      const res = await request(app).get(`/transactions/${ACCOUNT_ID}`);

      expect(res.body.data.items[0].memo).toBe("hello world");
    });

    it("maps successful: true", async () => {
      mockTxChain([makeTx({ successful: true })]);

      const res = await request(app).get(`/transactions/${ACCOUNT_ID}`);

      expect(res.body.data.items[0].successful).toBe(true);
    });

    it("maps successful: false", async () => {
      mockTxChain([makeTx({ successful: false })]);

      const res = await request(app).get(`/transactions/${ACCOUNT_ID}`);

      expect(res.body.data.items[0].successful).toBe(false);
    });

    it("includes all six required normalised fields on every record", async () => {
      mockTxChain([makeTx()]);

      const res = await request(app).get(`/transactions/${ACCOUNT_ID}`);
      const item = res.body.data.items[0];

      expect(item).toHaveProperty("transactionHash");
      expect(item).toHaveProperty("ledger");
      expect(item).toHaveProperty("createdAt");
      expect(item).toHaveProperty("operationCount");
      expect(item).toHaveProperty("memo");
      expect(item).toHaveProperty("successful");
    });

    it("also exposes feeSummary on each record", async () => {
      mockTxChain([makeTx({ fee_charged: "200", operation_count: 2 })]);

      const res = await request(app).get(`/transactions/${ACCOUNT_ID}`);
      const { feeSummary } = res.body.data.items[0];

      expect(feeSummary).toBeDefined();
      expect(feeSummary.chargedInStroops).toBe(200);
      expect(feeSummary.perOperationInStroops).toBe(100);
      expect(typeof feeSummary.chargedInXLM).toBe("string");
    });

    it("response wrapper has items, total, limit, cursor", async () => {
      mockTxChain([makeTx()]);

      const res = await request(app).get(`/transactions/${ACCOUNT_ID}`);
      const { data } = res.body;

      expect(data).toHaveProperty("items");
      expect(data).toHaveProperty("total");
      expect(data).toHaveProperty("limit");
      expect(data).toHaveProperty("cursor");
    });

    it("total equals the number of items returned", async () => {
      mockTxChain([makeTx(), makeTx({ id: "tx-2", hash: TX_HASH_2, paging_token: "pt-2" })]);

      const res = await request(app).get(`/transactions/${ACCOUNT_ID}`);

      expect(res.body.data.total).toBe(2);
      expect(res.body.data.items).toHaveLength(2);
    });
  });

  // ── Pagination params ─────────────────────────────────────────────────────

  describe("pagination params", () => {
    it("forwards the limit param to the SDK query", async () => {
      const chain = mockTxChain([]);

      await request(app).get(`/transactions/${ACCOUNT_ID}?limit=5`);

      expect(chain.limit).toHaveBeenCalledWith(5);
    });

    it("forwards order=asc to the SDK query", async () => {
      const chain = mockTxChain([]);

      await request(app).get(`/transactions/${ACCOUNT_ID}?order=asc`);

      expect(chain.order).toHaveBeenCalledWith("asc");
    });

    it("defaults to order=desc when not specified", async () => {
      const chain = mockTxChain([]);

      await request(app).get(`/transactions/${ACCOUNT_ID}`);

      expect(chain.order).toHaveBeenCalledWith("desc");
    });

    it("forwards the cursor param to the SDK query", async () => {
      const chain = mockTxChain([]);

      await request(app).get(`/transactions/${ACCOUNT_ID}?cursor=pt-abc`);

      expect(chain.cursor).toHaveBeenCalledWith("pt-abc");
    });

    it("cursor in response is the paging_token of the last record", async () => {
      mockTxChain([
        makeTx({ paging_token: "pt-first" }),
        makeTx({ id: "tx-2", hash: TX_HASH_2, paging_token: "pt-last" }),
      ]);

      const res = await request(app).get(`/transactions/${ACCOUNT_ID}`);

      expect(res.body.data.cursor).toBe("pt-last");
    });

    it("cursor in response is null when no records returned", async () => {
      mockTxChain([]);

      const res = await request(app).get(`/transactions/${ACCOUNT_ID}`);

      expect(res.body.data.cursor).toBeNull();
    });

    it("does not call cursor() on the chain when no cursor query param", async () => {
      const chain = mockTxChain([]);

      await request(app).get(`/transactions/${ACCOUNT_ID}`);

      expect(chain.cursor).not.toHaveBeenCalled();
    });
  });

  // ── Validation errors ──────────────────────────────────────────────────────

  describe("input validation", () => {
    it("returns 400 for an invalid (non-G) account ID", async () => {
      const res = await request(app).get("/transactions/NOT_VALID");

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("InvalidAccountId");
    });

    it("returns 400 for an invalid limit value", async () => {
      const res = await request(app).get(`/transactions/${ACCOUNT_ID}?limit=0`);

      expect(res.statusCode).toBe(400);
    });

    it("returns 400 for an invalid order value", async () => {
      const res = await request(app).get(`/transactions/${ACCOUNT_ID}?order=sideways`);

      expect(res.statusCode).toBe(400);
    });
  });

  // ── Account-not-found ──────────────────────────────────────────────────────

  describe("account not found", () => {
    it("returns 404 when Horizon responds with a 404 for the account", async () => {
      // The transactions chain itself raises a 404
      const chain = {
        forAccount:    jest.fn().mockReturnThis(),
        limit:         jest.fn().mockReturnThis(),
        order:         jest.fn().mockReturnThis(),
        cursor:        jest.fn().mockReturnThis(),
        includeFailed: jest.fn().mockReturnThis(),
        call:          jest.fn().mockRejectedValue(horizonNotFound()),
      };
      server.transactions.mockReturnValue(chain);

      const res = await request(app).get(`/transactions/${ACCOUNT_ID}`);

      expect(res.statusCode).toBe(404);
      expect(res.body.error.type).toBe("AccountNotFound");
    });
  });

  // ── Empty result set ───────────────────────────────────────────────────────

  describe("empty result set", () => {
    it("returns 200 with an empty items array", async () => {
      mockTxChain([]);

      const res = await request(app).get(`/transactions/${ACCOUNT_ID}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.items).toHaveLength(0);
      expect(res.body.data.total).toBe(0);
      expect(res.body.data.cursor).toBeNull();
    });
  });
});
