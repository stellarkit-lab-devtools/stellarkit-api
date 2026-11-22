"use strict";

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

const ASSET_CODE = "USDC";
const ASSET_ISSUER = Keypair.random().publicKey();
const BURNER_A = Keypair.random().publicKey();
const BURNER_B = Keypair.random().publicKey();
const BURNER_C = Keypair.random().publicKey();

function burnPayment({
  amount,
  burnerAddress = BURNER_A,
  daysAgo = 0,
  txHash = "abc123",
}) {
  const timestamp = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return {
    type: "payment",
    from: burnerAddress,
    to: ASSET_ISSUER,
    amount,
    asset_type: "credit_alphanum4",
    asset_code: ASSET_CODE,
    asset_issuer: ASSET_ISSUER,
    transaction_successful: true,
    created_at: timestamp.toISOString(),
    transaction_hash: txHash,
    paging_token: `${txHash}-paging`,
  };
}

function mockPayments(records) {
  jest.spyOn(server, "payments").mockReturnValue({
    forAsset: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /asset/:code/:issuer/burn-history", () => {
  it("returns total lifetime burned amount and 7d burn rate", async () => {
    mockPayments([
      burnPayment({ amount: "10.0000000", burnerAddress: BURNER_A, daysAgo: 1, txHash: "tx1" }),
      burnPayment({ amount: "20.0000000", burnerAddress: BURNER_B, daysAgo: 2, txHash: "tx2" }),
      burnPayment({ amount: "5.0000000", burnerAddress: BURNER_C, daysAgo: 3, txHash: "tx3" }),
    ]);

    const res = await request(app).get(
      `/asset/${ASSET_CODE}/${ASSET_ISSUER}/burn-history`,
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.code).toBe(ASSET_CODE);
    expect(res.body.data.issuer).toBe(ASSET_ISSUER);
    expect(res.body.data.totalBurned).toBe("35.0000000");
    expect(res.body.data.burnRate7d).toBe("5.0000000");
  });

  it("returns empty events array when no burns have occurred", async () => {
    mockPayments([]);

    const res = await request(app).get(
      `/asset/${ASSET_CODE}/${ASSET_ISSUER}/burn-history`,
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalBurned).toBe("0.0000000");
    expect(res.body.data.burnRate7d).toBe("0.0000000");
    expect(res.body.data.events).toEqual([]);
  });

  it("returns burn events with timestamp, amount, burnerAddress, and txHash", async () => {
    mockPayments([
      burnPayment({ amount: "10.0000000", burnerAddress: BURNER_A, daysAgo: 1, txHash: "tx1" }),
      burnPayment({ amount: "5.0000000", burnerAddress: BURNER_B, daysAgo: 2, txHash: "tx2" }),
    ]);

    const res = await request(app).get(
      `/asset/${ASSET_CODE}/${ASSET_ISSUER}/burn-history`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.events).toHaveLength(2);

    const [event1, event2] = res.body.data.events;
    expect(event1.amount).toBe("10.0000000");
    expect(event1.burnerAddress).toBe(BURNER_A);
    expect(event1.txHash).toBe("tx1");
    expect(event1.timestamp).toBeTruthy();

    expect(event2.amount).toBe("5.0000000");
    expect(event2.burnerAddress).toBe(BURNER_B);
    expect(event2.txHash).toBe("tx2");
  });

  it("supports ?limit= pagination parameter", async () => {
    mockPayments([
      burnPayment({ amount: "1.0000000", burnerAddress: BURNER_A, daysAgo: 1, txHash: "tx1" }),
      burnPayment({ amount: "2.0000000", burnerAddress: BURNER_B, daysAgo: 2, txHash: "tx2" }),
      burnPayment({ amount: "3.0000000", burnerAddress: BURNER_C, daysAgo: 3, txHash: "tx3" }),
    ]);

    const res = await request(app).get(
      `/asset/${ASSET_CODE}/${ASSET_ISSUER}/burn-history?limit=2`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.events).toHaveLength(2);
    expect(res.body.data.totalBurned).toBe("6.0000000");
  });

  it("returns 400 for an invalid issuer address", async () => {
    const paymentsSpy = jest.spyOn(server, "payments");

    const res = await request(app).get(
      `/asset/${ASSET_CODE}/INVALID_ISSUER/burn-history`,
    );

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("InvalidAsset");
    expect(paymentsSpy).not.toHaveBeenCalled();
  });

  it("calculates burnRate7d as average daily burn over the last 7 days", async () => {
    mockPayments([
      burnPayment({ amount: "7.0000000", burnerAddress: BURNER_A, daysAgo: 1, txHash: "tx1" }),
      burnPayment({ amount: "14.0000000", burnerAddress: BURNER_B, daysAgo: 2, txHash: "tx2" }),
      burnPayment({ amount: "999.0000000", burnerAddress: BURNER_C, daysAgo: 10, txHash: "tx3" }),
    ]);

    const res = await request(app).get(
      `/asset/${ASSET_CODE}/${ASSET_ISSUER}/burn-history`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.totalBurned).toBe("1020.0000000");
    expect(res.body.data.burnRate7d).toBe("3.0000000");
  });
});
