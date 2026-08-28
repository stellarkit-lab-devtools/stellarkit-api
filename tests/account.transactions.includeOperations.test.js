/**
 * Tests for GET /account/:id/transactions?includeOperations=true
 *
 * Covers:
 *   - includeOperations=true embeds a normalised operations array in each transaction
 *   - Each embedded operation follows the normalised shape (same as
 *     GET /transactions/:id/operations)
 *   - Default behaviour (omitted) is unchanged: no operations field
 *   - includeOperations=false behaves the same as omitted
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
}));

const app = require("../src/index");
const { server } = require("../src/config/stellar");

const accountId = Keypair.random().publicKey();
const txHash1 = "a".repeat(64);
const txHash2 = "b".repeat(64);

function mockTransactions(records) {
  const chain = {
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    includeFailed: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  };
  server.transactions.mockReturnValue(chain);
  return chain;
}

function mockOperationsForTransaction(recordsByHash) {
  const chain = {
    forTransaction: jest.fn((hash) => ({
      call: jest.fn().mockResolvedValue({ records: recordsByHash[hash] || [] }),
    })),
  };
  server.operations.mockReturnValue(chain);
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
    transaction_successful: true,
    source_account: accountId,
    created_at: "2024-01-01T00:00:00Z",
    asset_type: "native",
    amount: "10.0000000",
    from: accountId,
    to: accountId,
    ...overrides,
  };
}

describe("GET /account/:id/transactions?includeOperations=", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    server.loadAccount.mockResolvedValue({ id: accountId, balances: [] });
  });

  it("embeds a normalised operations array when includeOperations=true", async () => {
    const tx = makeTxRecord();
    mockTransactions([tx]);
    mockOperationsForTransaction({
      [txHash1]: [makeOpRecord({ id: "op-1", type: "payment" })],
    });

    const res = await request(app).get(
      `/account/${accountId}/transactions?includeOperations=true`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].operations).toHaveLength(1);
    expect(res.body.data.items[0].operations[0]).toEqual(
      expect.objectContaining({
        id: "op-1",
        type: "payment",
        transactionHash: txHash1,
        sourceAccount: accountId,
        amount: "10.0000000",
      }),
    );
  });

  it("each operation follows the normalised shape for different operation types", async () => {
    const tx = makeTxRecord();
    mockTransactions([tx]);
    mockOperationsForTransaction({
      [txHash1]: [
        makeOpRecord({
          id: "op-create",
          type: "create_account",
          starting_balance: "50.0000000",
          funder: accountId,
          account: accountId,
        }),
        makeOpRecord({
          id: "op-trust",
          type: "change_trust",
          asset_code: "USDC",
          asset_issuer: accountId,
          asset_type: "credit_alphanum4",
          trustor: accountId,
          trustee: accountId,
        }),
      ],
    });

    const res = await request(app).get(
      `/account/${accountId}/transactions?includeOperations=true`,
    );

    expect(res.statusCode).toBe(200);
    const [createOp, trustOp] = res.body.data.items[0].operations;

    expect(createOp).toEqual(
      expect.objectContaining({
        type: "create_account",
        startingBalance: "50.0000000",
        funder: accountId,
        account: accountId,
      }),
    );
    expect(trustOp).toEqual(
      expect.objectContaining({
        type: "change_trust",
        trustor: accountId,
        trustee: accountId,
        asset: expect.objectContaining({ code: "USDC" }),
      }),
    );
  });

  it("does not embed operations when includeOperations is omitted (default behaviour)", async () => {
    const tx = makeTxRecord();
    mockTransactions([tx]);

    const res = await request(app).get(`/account/${accountId}/transactions`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.items[0]).not.toHaveProperty("operations");
    expect(server.operations).not.toHaveBeenCalled();
  });

  it("does not embed operations when includeOperations=false", async () => {
    const tx = makeTxRecord();
    mockTransactions([tx]);

    const res = await request(app).get(
      `/account/${accountId}/transactions?includeOperations=false`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.items[0]).not.toHaveProperty("operations");
    expect(server.operations).not.toHaveBeenCalled();
  });

  it("embeds operations for multiple transactions independently", async () => {
    const tx1 = makeTxRecord({ id: "tx-1", hash: txHash1, paging_token: "pt-1" });
    const tx2 = makeTxRecord({ id: "tx-2", hash: txHash2, paging_token: "pt-2" });
    mockTransactions([tx1, tx2]);
    mockOperationsForTransaction({
      [txHash1]: [makeOpRecord({ id: "op-1", transaction_hash: txHash1 })],
      [txHash2]: [
        makeOpRecord({ id: "op-2a", transaction_hash: txHash2 }),
        makeOpRecord({ id: "op-2b", transaction_hash: txHash2 }),
      ],
    });

    const res = await request(app).get(
      `/account/${accountId}/transactions?includeOperations=true`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.items[0].operations).toHaveLength(1);
    expect(res.body.data.items[1].operations).toHaveLength(2);
  });

  it("returns an empty operations array (not an error) if the operations lookup fails", async () => {
    const tx = makeTxRecord();
    mockTransactions([tx]);
    server.operations.mockReturnValue({
      forTransaction: jest.fn().mockReturnValue({
        call: jest.fn().mockRejectedValue(new Error("network error")),
      }),
    });

    const res = await request(app).get(
      `/account/${accountId}/transactions?includeOperations=true`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.items[0].operations).toEqual([]);
  });
});
