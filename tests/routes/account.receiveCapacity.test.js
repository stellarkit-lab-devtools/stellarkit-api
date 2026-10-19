/**
 * tests/routes/account.receiveCapacity.test.js
 *
 * Unit tests for GET /account/:id/receive-capacity
 *
 *   1. A trustline at 0% usage returns remaining equal to limit.
 *   2. A trustline at 100% usage returns remaining "0.0000000".
 *   3. remainingPercent = ((limit - balance) / limit) * 100.
 *   4. Native XLM remaining equals the spendable balance.
 *   5. A non-existent account returns 404.
 *
 * server.loadAccount() is mocked with controlled balance and limit values.
 */

"use strict";

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../../src/config/stellar", () => {
  const original = jest.requireActual("../../src/config/stellar");
  return {
    ...original,
    server: {
      loadAccount: jest.fn(),
    },
  };
});

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

const ACCOUNT_ID = Keypair.random().publicKey();
const ISSUER_ID = Keypair.random().publicKey();

function trustline(code, balance, limit) {
  return {
    asset_type: code.length > 4 ? "credit_alphanum12" : "credit_alphanum4",
    asset_code: code,
    asset_issuer: ISSUER_ID,
    balance,
    limit,
    buying_liabilities: "0.0000000",
    selling_liabilities: "0.0000000",
    is_authorized: true,
  };
}

function mockAccount({ nativeBalance = "100.0000000", subentryCount = 0, trustlines = [] } = {}) {
  server.loadAccount.mockResolvedValue({
    id: ACCOUNT_ID,
    account_id: ACCOUNT_ID,
    subentry_count: subentryCount,
    balances: [
      ...trustlines,
      {
        asset_type: "native",
        balance: nativeBalance,
        buying_liabilities: "0.0000000",
        selling_liabilities: "0.0000000",
      },
    ],
  });
}

function findCapacity(capacities, code) {
  return capacities.find((c) => c.asset.code === code);
}

describe("GET /account/:id/receive-capacity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns remaining equal to limit for a trustline at 0% usage", async () => {
    mockAccount({
      subentryCount: 1,
      trustlines: [trustline("USDC", "0.0000000", "1000.0000000")],
    });

    const res = await request(app).get(`/account/${ACCOUNT_ID}/receive-capacity`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const usdc = findCapacity(res.body.data.capacities, "USDC");
    expect(usdc.asset.issuer).toBe(ISSUER_ID);
    expect(usdc.limit).toBe("1000.0000000");
    expect(usdc.remaining).toBe("1000.0000000");
    expect(usdc.remaining).toBe(usdc.limit);
    expect(usdc.remainingPercent).toBe(100);
  });

  it('returns remaining "0.0000000" for a trustline at 100% usage', async () => {
    mockAccount({
      subentryCount: 1,
      trustlines: [trustline("USDC", "500.0000000", "500.0000000")],
    });

    const res = await request(app).get(`/account/${ACCOUNT_ID}/receive-capacity`);

    expect(res.status).toBe(200);
    const usdc = findCapacity(res.body.data.capacities, "USDC");
    expect(usdc.remaining).toBe("0.0000000");
    expect(usdc.remainingPercent).toBe(0);
  });

  it("computes remainingPercent as ((limit - balance) / limit) * 100", async () => {
    const cases = [
      { code: "AAA", balance: "250.0000000", limit: "1000.0000000" },
      { code: "BBB", balance: "1.0000000", limit: "3.0000000" },
      { code: "CCCCC", balance: "12.3456789", limit: "100.0000000" },
    ];
    mockAccount({
      subentryCount: cases.length,
      trustlines: cases.map((c) => trustline(c.code, c.balance, c.limit)),
    });

    const res = await request(app).get(`/account/${ACCOUNT_ID}/receive-capacity`);

    expect(res.status).toBe(200);
    const { capacities } = res.body.data;

    for (const c of cases) {
      const limit = parseFloat(c.limit);
      const balance = parseFloat(c.balance);
      const expected = Number((((limit - balance) / limit) * 100).toFixed(2));

      const capacity = findCapacity(capacities, c.code);
      expect(capacity.remainingPercent).toBe(expected);
      expect(capacity.remaining).toBe((limit - balance).toFixed(7));
    }

    expect(findCapacity(capacities, "AAA").remainingPercent).toBe(75);
    expect(findCapacity(capacities, "BBB").remainingPercent).toBe(66.67);
    expect(findCapacity(capacities, "CCCCC").remaining).toBe("87.6543211");
  });

  it("computes native XLM remaining as the spendable balance", async () => {
    // Minimum reserve = (2 + 3 subentries) * 0.5 = 2.5 XLM
    mockAccount({
      nativeBalance: "100.0000000",
      subentryCount: 3,
      trustlines: [trustline("USDC", "10.0000000", "1000.0000000")],
    });

    const res = await request(app).get(`/account/${ACCOUNT_ID}/receive-capacity`);

    expect(res.status).toBe(200);
    const xlm = findCapacity(res.body.data.capacities, "XLM");
    expect(xlm.asset).toEqual({ code: "XLM", issuer: null, type: "native" });
    expect(xlm.balance).toBe("100.0000000");
    expect(xlm.limit).toBeNull();
    expect(xlm.remaining).toBe("97.5000000");
    expect(xlm.remainingPercent).toBeNull();
  });

  it("returns 404 for a non-existent account", async () => {
    const error = new Error("Not Found");
    error.response = { status: 404 };
    server.loadAccount.mockRejectedValue(error);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/receive-capacity`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
