"use strict";

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

const ASSET_CODE = "USDC";
const ASSET_ISSUER = Keypair.random().publicKey();
const TRADER_A = Keypair.random().publicKey();
const TRADER_B = Keypair.random().publicKey();
const TRADER_C = Keypair.random().publicKey();
const TRADER_D = Keypair.random().publicKey();

function trade({ baseAmount, baseAccount, counterAccount, hoursAgo }) {
  return {
    base_asset_type: "credit_alphanum4",
    base_asset_code: ASSET_CODE,
    base_asset_issuer: ASSET_ISSUER,
    counter_asset_type: "native",
    counter_asset_code: undefined,
    counter_asset_issuer: undefined,
    base_amount: baseAmount,
    counter_amount: "1.0000000",
    base_account: baseAccount,
    counter_account: counterAccount,
    ledger_close_time: new Date(
      Date.now() - hoursAgo * 60 * 60 * 1000,
    ).toISOString(),
  };
}

function mockTrades(records) {
  jest.spyOn(server, "trades").mockReturnValue({
    forAsset: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /asset/:code/:issuer/trading-volume", () => {
  it("returns correct 24-hour volume and trade count", async () => {
    mockTrades([
      trade({
        baseAmount: "1.2500000",
        baseAccount: TRADER_A,
        counterAccount: TRADER_B,
        hoursAgo: 1,
      }),
      trade({
        baseAmount: "2.5000000",
        baseAccount: TRADER_A,
        counterAccount: TRADER_C,
        hoursAgo: 2,
      }),
      trade({
        baseAmount: "3.0000000",
        baseAccount: TRADER_D,
        counterAccount: TRADER_B,
        hoursAgo: 3,
      }),
      trade({
        baseAmount: "999.0000000",
        baseAccount: TRADER_A,
        counterAccount: TRADER_D,
        hoursAgo: 25,
      }),
    ]);

    const res = await request(app).get(
      `/asset/${ASSET_CODE}/${ASSET_ISSUER}/trading-volume`,
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.volume24h).toBe("6.7500000");
    expect(res.body.data.tradeCount24h).toBe(3);
  });

  it("returns zero values when the asset has no recent trades", async () => {
    mockTrades([
      trade({
        baseAmount: "999.0000000",
        baseAccount: TRADER_A,
        counterAccount: TRADER_B,
        hoursAgo: 25,
      }),
    ]);

    const res = await request(app).get(
      `/asset/${ASSET_CODE}/${ASSET_ISSUER}/trading-volume`,
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.volume24h).toBe("0.0000000");
    expect(res.body.data.tradeCount24h).toBe(0);
    expect(res.body.data.uniqueTraders24h).toBe(0);
  });

  it("counts distinct trader addresses rather than total trades", async () => {
    mockTrades([
      trade({
        baseAmount: "1.0000000",
        baseAccount: TRADER_A,
        counterAccount: TRADER_B,
        hoursAgo: 1,
      }),
      trade({
        baseAmount: "1.0000000",
        baseAccount: TRADER_A,
        counterAccount: TRADER_C,
        hoursAgo: 2,
      }),
      trade({
        baseAmount: "1.0000000",
        baseAccount: TRADER_D,
        counterAccount: TRADER_B,
        hoursAgo: 3,
      }),
    ]);

    const res = await request(app).get(
      `/asset/${ASSET_CODE}/${ASSET_ISSUER}/trading-volume`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.tradeCount24h).toBe(3);
    expect(res.body.data.uniqueTraders24h).toBe(4);
  });

  it("returns 400 for an invalid issuer address", async () => {
    const tradesSpy = jest.spyOn(server, "trades");

    const res = await request(app).get(
      `/asset/${ASSET_CODE}/INVALID_ISSUER/trading-volume`,
    );

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("InvalidAsset");
    expect(tradesSpy).not.toHaveBeenCalled();
  });
});