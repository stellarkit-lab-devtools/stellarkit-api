"use strict";

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

const VALID_ACCOUNT = Keypair.random().publicKey();

jest.mock("../src/config/stellar", () => {
  const actual = jest.requireActual("../src/config/stellar");
  return {
    ...actual,
    server: {
      loadAccount: jest.fn(),
      payments: jest.fn(),
      operations: jest.fn(),
      offers: jest.fn(),
      transactions: jest.fn(),
      ledgers: jest.fn().mockReturnValue({
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: [] }),
      }),
      feeStats: jest.fn().mockResolvedValue({
        fee_charged: { min: "100", p10: "100", p50: "200", p95: "500", p99: "1000", max: "5000" },
        last_ledger_base_fee: "100",
        ledger_capacity_usage: "0.5",
      }),
    },
    fetchAccountCreation: jest.fn(),
  };
});

const app = require("../src/index");
const { server } = require("../src/config/stellar");

function chainResolve(records) {
  return {
    forAccount: () => chainResolve(records),
    limit: () => chainResolve(records),
    order: () => chainResolve(records),
    cursor: () => chainResolve(records),
    call: jest.fn().mockResolvedValue({ records }),
  };
}

function chainReject(err) {
  return {
    forAccount: () => chainReject(err),
    limit: () => chainReject(err),
    order: () => chainReject(err),
    cursor: () => chainReject(err),
    call: jest.fn().mockRejectedValue(err),
  };
}

describe("GET /account/:id/payments", () => {
  afterEach(() => jest.restoreAllMocks());

  it("returns normalised payment entries", async () => {
    server.payments.mockReturnValue(
      chainResolve([
        {
          id: "12345",
          type: "payment",
          from: VALID_ACCOUNT,
          to: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
          asset_code: "USDC",
          asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
          asset_type: "credit_alphanum4",
          amount: "100.0000000",
          created_at: "2024-01-15T12:00:00Z",
          transaction_hash: "abc123def456",
          paging_token: "pt1",
        },
      ])
    );

    const res = await request(app).get(`/account/${VALID_ACCOUNT}/payments`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const { payments, total, limit, cursor } = res.body.data;
    expect(payments).toHaveLength(1);
    expect(total).toBe(1);
    expect(typeof limit).toBe("number");
    expect(cursor).toBe("pt1");

    const p = payments[0];
    expect(p.paymentId).toBe("12345");
    expect(p.from).toBe(VALID_ACCOUNT);
    expect(p.to).toBe("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
    expect(p.asset).toBe("USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN");
    expect(p.amount).toBe("100.0000000");
    expect(p.createdAt).toBeDefined();
    expect(p.transactionHash).toBe("abc123def456");
  });

  it("returns XLM asset without issuer for native payments", async () => {
    server.payments.mockReturnValue(
      chainResolve([
        {
          id: "67890",
          type: "payment",
          from: VALID_ACCOUNT,
          to: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
          asset_type: "native",
          amount: "50.0000000",
          created_at: "2024-01-16T12:00:00Z",
          transaction_hash: "xyz789",
          paging_token: "pt2",
        },
      ])
    );

    const res = await request(app).get(`/account/${VALID_ACCOUNT}/payments`);
    expect(res.statusCode).toBe(200);
    const p = res.body.data.payments[0];
    expect(p.asset).toBe("XLM");
  });

  it("handles create_account operations", async () => {
    server.payments.mockReturnValue(
      chainResolve([
        {
          id: "11111",
          type: "create_account",
          funder: VALID_ACCOUNT,
          account: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
          starting_balance: "10.0000000",
          created_at: "2024-01-17T12:00:00Z",
          transaction_hash: "create123",
          paging_token: "pt3",
        },
      ])
    );

    const res = await request(app).get(`/account/${VALID_ACCOUNT}/payments`);
    expect(res.statusCode).toBe(200);
    const p = res.body.data.payments[0];
    expect(p.paymentId).toBe("11111");
    expect(p.from).toBe(VALID_ACCOUNT);
    expect(p.to).toBe("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
    expect(p.asset).toBe("XLM");
    expect(p.amount).toBe("10.0000000");
    expect(p.transactionHash).toBe("create123");
  });

  it("returns empty payments array for account with no payments", async () => {
    server.payments.mockReturnValue(chainResolve([]));

    const res = await request(app).get(`/account/${VALID_ACCOUNT}/payments`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.payments).toEqual([]);
    expect(res.body.data.total).toBe(0);
    expect(res.body.data.cursor).toBeNull();
  });

  it("supports limit and cursor query params", async () => {
    server.payments.mockReturnValue(
      chainResolve([
        {
          id: "22222",
          type: "payment",
          from: VALID_ACCOUNT,
          to: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
          asset_type: "native",
          amount: "5.0000000",
          created_at: "2024-01-18T12:00:00Z",
          transaction_hash: "page123",
          paging_token: "pt4",
        },
      ])
    );

    const res = await request(app).get(
      `/account/${VALID_ACCOUNT}/payments?limit=1&cursor=pt0`
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.data.payments).toHaveLength(1);
  });

  it("returns 404 for non-existent account", async () => {
    server.payments.mockReturnValue(
      chainReject({ response: { status: 404 } })
    );

    const res = await request(app).get(`/account/${VALID_ACCOUNT}/payments`);
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("AccountNotFound");
  });

  it("returns 400 for invalid account ID", async () => {
    const res = await request(app).get("/account/INVALID/payments");
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
