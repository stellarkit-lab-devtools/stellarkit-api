/**
 * tests/routes/account.netFlow.test.js
 *
 * Unit tests for GET /account/:id/net-flow
 *
 *   1. Only inbound payments  → positive net for each asset.
 *   2. Only outbound payments → negative net for each asset.
 *   3. ?days=7 only counts payments from the last 7 days.
 *   4. ?days=91 returns HTTP 400.
 *   5. No payment history     → empty flows array.
 *
 * server.payments() is mocked with controlled direction/amount data.
 */

"use strict";

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../../src/config/stellar", () => {
  const original = jest.requireActual("../../src/config/stellar");
  return {
    ...original,
    server: {
      payments: jest.fn(),
    },
  };
});

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

const ACCOUNT_ID = Keypair.random().publicKey();
const OTHER_ID = Keypair.random().publicKey();
const USDC_ISSUER = Keypair.random().publicKey();

const DAY_MS = 24 * 60 * 60 * 1000;
let tokenSeq = 0;

function payment({ direction, amount, daysAgo = 1, asset = "native" }) {
  const isNative = asset === "native";
  return {
    type: "payment",
    transaction_successful: true,
    created_at: new Date(Date.now() - daysAgo * DAY_MS).toISOString(),
    paging_token: `token_${++tokenSeq}`,
    asset_type: isNative ? "native" : "credit_alphanum4",
    asset_code: isNative ? undefined : "USDC",
    asset_issuer: isNative ? undefined : USDC_ISSUER,
    amount,
    from: direction === "in" ? OTHER_ID : ACCOUNT_ID,
    to: direction === "in" ? ACCOUNT_ID : OTHER_ID,
  };
}

function mockPayments(records) {
  server.payments.mockReturnValue({
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  });
}

function findFlow(flows, code) {
  return flows.find((f) => f.asset.code === code);
}

describe("GET /account/:id/net-flow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns positive net for each asset when the account only receives payments", async () => {
    mockPayments([
      payment({ direction: "in", amount: "100.0000000" }),
      payment({ direction: "in", amount: "50.0000000" }),
      payment({ direction: "in", amount: "25.0000000", asset: "USDC" }),
    ]);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/net-flow`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const { flows } = res.body.data;
    expect(flows).toHaveLength(2);

    const xlm = findFlow(flows, "XLM");
    expect(xlm.inbound).toBe("150.0000000");
    expect(xlm.outbound).toBe("0.0000000");
    expect(xlm.net).toBe("150.0000000");

    const usdc = findFlow(flows, "USDC");
    expect(usdc.asset.issuer).toBe(USDC_ISSUER);
    expect(usdc.net).toBe("25.0000000");

    for (const f of flows) expect(parseFloat(f.net)).toBeGreaterThan(0);
  });

  it("returns negative net for each asset when the account only sends payments", async () => {
    mockPayments([
      payment({ direction: "out", amount: "40.0000000" }),
      payment({ direction: "out", amount: "10.0000000", asset: "USDC" }),
    ]);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/net-flow`);

    expect(res.status).toBe(200);
    const { flows } = res.body.data;
    expect(flows).toHaveLength(2);

    const xlm = findFlow(flows, "XLM");
    expect(xlm.inbound).toBe("0.0000000");
    expect(xlm.outbound).toBe("40.0000000");
    expect(xlm.net).toBe("-40.0000000");

    expect(findFlow(flows, "USDC").net).toBe("-10.0000000");

    for (const f of flows) expect(parseFloat(f.net)).toBeLessThan(0);
  });

  it("?days=7 only counts payments from the last 7 days", async () => {
    mockPayments([
      payment({ direction: "in", amount: "500.0000000", daysAgo: 20 }),
      payment({ direction: "out", amount: "300.0000000", daysAgo: 10 }),
      payment({ direction: "in", amount: "30.0000000", daysAgo: 5 }),
      payment({ direction: "out", amount: "5.0000000", daysAgo: 1 }),
    ]);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/net-flow?days=7`);

    expect(res.status).toBe(200);
    expect(res.body.data.period.days).toBe(7);

    const { flows } = res.body.data;
    expect(flows).toHaveLength(1);
    expect(flows[0].inbound).toBe("30.0000000");
    expect(flows[0].outbound).toBe("5.0000000");
    expect(flows[0].net).toBe("25.0000000");
  });

  it("?days=91 returns 400", async () => {
    mockPayments([]);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/net-flow?days=91`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(server.payments).not.toHaveBeenCalled();
  });

  it("returns an empty flows array when the account has no payment history", async () => {
    mockPayments([]);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/net-flow`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.flows).toEqual([]);
  });
});
