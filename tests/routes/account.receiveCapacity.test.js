"use strict";

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

const ACCOUNT_ID = Keypair.random().publicKey();
const USDC_ISSUER = Keypair.random().publicKey();
const EURC_ISSUER = Keypair.random().publicKey();

const SEVEN_DECIMALS = /^\d+\.\d{7}$/;

function mockAccount(overrides = {}) {
  return jest.spyOn(server, "loadAccount").mockResolvedValue({
    id: ACCOUNT_ID,
    subentry_count: 2,
    balances: [
      {
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: USDC_ISSUER,
        balance: "250.0000000",
        limit: "1000.0000000",
        buying_liabilities: "50.0000000",
        selling_liabilities: "0.0000000",
      },
      {
        asset_type: "credit_alphanum4",
        asset_code: "EURC",
        asset_issuer: EURC_ISSUER,
        balance: "100.0000000",
        limit: "100.0000000",
        buying_liabilities: "0.0000000",
        selling_liabilities: "0.0000000",
      },
      {
        asset_type: "native",
        balance: "100.0000000",
        buying_liabilities: "0.0000000",
        selling_liabilities: "1.0000000",
      },
    ],
    ...overrides,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /account/:id/receive-capacity", () => {
  it("returns remaining capacity per trustline, net of buying liabilities", async () => {
    mockAccount();

    const res = await request(app).get(`/account/${ACCOUNT_ID}/receive-capacity`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accountId).toBe(ACCOUNT_ID);

    const usdc = res.body.data.capacity.find((c) => c.asset.code === "USDC");
    expect(usdc).toEqual({
      asset: { code: "USDC", issuer: USDC_ISSUER, type: "credit_alphanum4" },
      limit: "1000.0000000",
      balance: "250.0000000",
      remaining: "700.0000000",
      remainingPercent: "70.00",
    });

    const eurc = res.body.data.capacity.find((c) => c.asset.code === "EURC");
    expect(eurc.remaining).toBe("0.0000000");
    expect(eurc.remainingPercent).toBe("0.00");
  });

  it("includes native XLM first, bounded by the int64 ceiling, with spendable balance", async () => {
    mockAccount();

    const res = await request(app).get(`/account/${ACCOUNT_ID}/receive-capacity`);

    const [xlm] = res.body.data.capacity;
    expect(xlm.asset).toEqual({ code: "XLM", issuer: null, type: "native" });
    expect(xlm.limit).toBe("922337203685.4775807");
    expect(xlm.balance).toBe("100.0000000");
    expect(xlm.remaining).toBe("922337203585.4775807");
    // 100 - (2 + 2 subentries) * 0.5 reserve - 1 selling liabilities
    expect(xlm.spendableBalance).toBe("97.0000000");
  });

  it("formats every amount as a seven-decimal string", async () => {
    mockAccount();

    const res = await request(app).get(`/account/${ACCOUNT_ID}/receive-capacity`);

    for (const entry of res.body.data.capacity) {
      expect(entry.limit).toMatch(SEVEN_DECIMALS);
      expect(entry.balance).toMatch(SEVEN_DECIMALS);
      expect(entry.remaining).toMatch(SEVEN_DECIMALS);
      expect(entry.remainingPercent).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it("excludes liquidity pool shares", async () => {
    mockAccount({
      balances: [
        { asset_type: "native", balance: "10.0000000" },
        {
          asset_type: "liquidity_pool_shares",
          liquidity_pool_id: "abcd",
          balance: "5.0000000",
          limit: "922337203685.4775807",
        },
      ],
    });

    const res = await request(app).get(`/account/${ACCOUNT_ID}/receive-capacity`);

    expect(res.status).toBe(200);
    expect(res.body.data.capacity).toHaveLength(1);
    expect(res.body.data.capacity[0].asset.code).toBe("XLM");
  });

  it("returns 404 when the account does not exist", async () => {
    const notFound = new Error("Not Found");
    notFound.response = { status: 404 };
    jest.spyOn(server, "loadAccount").mockRejectedValue(notFound);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/receive-capacity`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
