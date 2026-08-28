/**
 * Tests for GET /account/:id/transactions
 *
 * Covers:
 *   - No ?type= param returns all transactions
 *   - Valid ?type= (e.g. "payment") returns only matching transactions
 *   - Invalid ?type= returns 400 with a list of valid types
 *   - 400 for invalid account ID
 *   - Pagination params are forwarded correctly
 */

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

// Mock stellar server before requiring app
jest.mock("../src/config/stellar", () => ({
  ...jest.requireActual("../src/config/stellar"),
  server: {
    loadAccount: jest.fn(),
    transactions: jest.fn(),
    operations: jest.fn(),
  },
}));

const app = require("../src/index");
const { server } = require("../src/config/stellar");

const accountId = Keypair.random().publicKey();
const txHash1 = "a".repeat(64);
const txHash2 = "b".repeat(64);

// ---------- Helpers ----------------------------------------------------------

/**
 * Returns a chainable mock for server.transactions()
 */
function mockTransactions(records) {
  const chain = {
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    includeFailed: jest.fn().mockReturnThis(),
    transaction: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  };
  server.transactions.mockReturnValue(chain);
  return chain;
}

/**
 * Returns a chainable mock for server.operations()
 */
function mockOperations(records) {
  const chain = {
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  };
  server.operations.mockReturnValue(chain);
  return chain;
}

/**
 * Returns a chainable mock for a single transaction lookup by hash.
 * Used when the type-filtered path calls server.transactions().transaction(hash).call()
 */
function mockTransactionLookup(txRecord) {
  const chain = {
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    includeFailed: jest.fn().mockReturnThis(),
    transaction: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue(txRecord),
  };
  server.transactions.mockReturnValue(chain);
  return chain;
}

function makeTxRecord(overrides = {}) {
  return {
    id: overrides.id || "tx-id-1",
    hash: overrides.hash || txHash1,
    ledger: 100,
    ledger_attr: 100,
    created_at: "2024-01-01T00:00:00Z",
    source_account: accountId,
    fee_charged: "100",
    max_fee: "200",
    fee_account: accountId,
    operation_count: 1,
    memo_type: "none",
    memo: null,
    successful: true,
    envelope_xdr: "AAAA",
    paging_token: overrides.paging_token || "pt-1",
    ...overrides,
  };
}

function makeOpRecord(overrides = {}) {
  return {
    id: "op-1",
    type: overrides.type || "payment",
    transaction_hash: overrides.transaction_hash || txHash1,
    paging_token: overrides.paging_token || "pt-op-1",
    created_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

// ---------- Tests ------------------------------------------------------------

describe("GET /account/:id/transactions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default account exists
    server.loadAccount.mockResolvedValue({ id: accountId, balances: [] });
  });

  // ── No filter ──────────────────────────────────────────────────────────────

  describe("no ?type= param", () => {
    it("returns 200 with all transactions", async () => {
      const tx = makeTxRecord();
      mockTransactions([tx]);

      const res = await request(app).get(`/account/${accountId}/transactions`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].hash).toBe(tx.hash);
    });

    it("returns an empty list when the account has no transactions", async () => {
      mockTransactions([]);

      const res = await request(app).get(`/account/${accountId}/transactions`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.items).toHaveLength(0);
      expect(res.body.data.cursor).toBeNull();
    });

    it("uses the includeFailed(false) flag", async () => {
      const chain = mockTransactions([]);

      await request(app).get(`/account/${accountId}/transactions`);

      expect(chain.includeFailed).toHaveBeenCalledWith(false);
    });

    it("respects limit and order query params", async () => {
      const chain = mockTransactions([]);

      await request(app).get(
        `/account/${accountId}/transactions?limit=5&order=asc`
      );

      expect(chain.limit).toHaveBeenCalledWith(5);
      expect(chain.order).toHaveBeenCalledWith("asc");
    });

    it("forwards cursor when provided", async () => {
      const chain = mockTransactions([]);

      await request(app).get(
        `/account/${accountId}/transactions?cursor=pt-abc`
      );

      expect(chain.cursor).toHaveBeenCalledWith("pt-abc");
    });

    it("includes a feeSummary shape on each transaction", async () => {
      mockTransactions([makeTxRecord({ fee_charged: "200", operation_count: 2 })]);

      const res = await request(app).get(`/account/${accountId}/transactions`);

      const tx = res.body.data.items[0];
      expect(tx.feeSummary).toBeDefined();
      expect(tx.feeSummary.chargedInStroops).toBe(200);
      expect(typeof tx.feeSummary.chargedInXLM).toBe("string");
      expect(tx.feeSummary.perOperationInStroops).toBe(100);
    });

    it("sets cursor from the last record's paging_token", async () => {
      const tx1 = makeTxRecord({ paging_token: "pt-1" });
      const tx2 = makeTxRecord({ id: "tx-2", hash: txHash2, paging_token: "pt-2" });
      mockTransactions([tx1, tx2]);

      const res = await request(app).get(`/account/${accountId}/transactions`);

      expect(res.body.data.cursor).toBe("pt-2");
    });
  });

  // ── Valid ?type= filter ────────────────────────────────────────────────────

  describe("valid ?type= param", () => {
    it("returns 200 and filters to matching transactions for type=payment", async () => {
      // operations endpoint returns two ops: one payment, one change_trust
      const paymentOp = makeOpRecord({ type: "payment", transaction_hash: txHash1, paging_token: "pt-op-1" });
      const trustOp = makeOpRecord({ type: "change_trust", transaction_hash: txHash2, paging_token: "pt-op-2" });
      mockOperations([paymentOp, trustOp]);

      // Transaction lookup for the payment op's hash
      mockTransactionLookup(makeTxRecord({ hash: txHash1 }));

      const res = await request(app).get(
        `/account/${accountId}/transactions?type=payment`
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].hash).toBe(txHash1);
      expect(res.body.data.filter).toEqual({ type: "payment" });
    });

    it("returns empty items array when no ops of the given type exist", async () => {
      mockOperations([
        makeOpRecord({ type: "change_trust", transaction_hash: txHash1 }),
      ]);

      const res = await request(app).get(
        `/account/${accountId}/transactions?type=payment`
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.data.items).toHaveLength(0);
    });

    it("deduplicates transactions when the same tx hash appears multiple times", async () => {
      // Two payment ops inside the same transaction
      const op1 = makeOpRecord({ type: "payment", transaction_hash: txHash1, paging_token: "pt-1" });
      const op2 = makeOpRecord({ type: "payment", transaction_hash: txHash1, paging_token: "pt-2" });
      mockOperations([op1, op2]);
      mockTransactionLookup(makeTxRecord({ hash: txHash1 }));

      const res = await request(app).get(
        `/account/${accountId}/transactions?type=payment`
      );

      // Should only appear once even though two ops matched
      expect(res.body.data.items).toHaveLength(1);
    });

    it("normalizes the type value to lowercase", async () => {
      mockOperations([]);

      const res = await request(app).get(
        `/account/${accountId}/transactions?type=PAYMENT`
      );

      // "PAYMENT" normalises to "payment" — should succeed (not 400)
      expect(res.statusCode).toBe(200);
      expect(res.body.data.filter.type).toBe("payment");
    });

    it("works for type=change_trust", async () => {
      const op = makeOpRecord({ type: "change_trust", transaction_hash: txHash2, paging_token: "pt-1" });
      mockOperations([op]);
      mockTransactionLookup(makeTxRecord({ hash: txHash2 }));

      const res = await request(app).get(
        `/account/${accountId}/transactions?type=change_trust`
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.filter.type).toBe("change_trust");
    });

    it("works for type=create_account", async () => {
      const op = makeOpRecord({ type: "create_account", transaction_hash: txHash1, paging_token: "pt-1" });
      mockOperations([op]);
      mockTransactionLookup(makeTxRecord({ hash: txHash1 }));

      const res = await request(app).get(
        `/account/${accountId}/transactions?type=create_account`
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.data.filter.type).toBe("create_account");
    });
  });

  // ── Invalid ?type= param ───────────────────────────────────────────────────

  describe("invalid ?type= param", () => {
    it("returns 400 for a completely unknown type", async () => {
      const res = await request(app).get(
        `/account/${accountId}/transactions?type=banana`
      );

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("includes a message mentioning the invalid type", async () => {
      const res = await request(app).get(
        `/account/${accountId}/transactions?type=banana`
      );

      expect(res.body.error.message).toMatch(/banana/i);
    });

    it("includes the list of valid types in the response", async () => {
      const res = await request(app).get(
        `/account/${accountId}/transactions?type=invalid_type`
      );

      expect(res.statusCode).toBe(400);
      // The valid type list should be present somewhere in the response
      const body = JSON.stringify(res.body);
      expect(body).toMatch(/payment/);
      expect(body).toMatch(/change_trust/);
    });

    it("returns a ValidationError type in the error object", async () => {
      const res = await request(app).get(
        `/account/${accountId}/transactions?type=not_real`
      );

      expect(res.body.error.type).toBe("ValidationError");
    });

    it("returns 400 for whitespace-only type", async () => {
      const res = await request(app).get(
        `/account/${accountId}/transactions?type=   `
      );

      expect(res.statusCode).toBe(400);
    });

    it("returns 400 for type=manage_offer (close but not exact)", async () => {
      const res = await request(app).get(
        `/account/${accountId}/transactions?type=manage_offer`
      );

      // "manage_offer" is not a valid type — "manage_sell_offer" is
      expect(res.statusCode).toBe(400);
    });
  });

  // ── Invalid account ID ─────────────────────────────────────────────────────

  describe("invalid account ID", () => {
    it("returns 400 for a malformed account ID", async () => {
      const res = await request(app).get(
        "/account/NOT_A_VALID_KEY/transactions"
      );

      expect(res.statusCode).toBe(400);
      expect(res.body.error.type).toBe("InvalidAccountId");
    });

    it("returns 400 even when a valid type is supplied", async () => {
      const res = await request(app).get(
        "/account/BADKEY/transactions?type=payment"
      );

      expect(res.statusCode).toBe(400);
      expect(res.body.error.type).toBe("InvalidAccountId");
    });
  });
});
