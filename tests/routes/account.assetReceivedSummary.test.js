"use strict";

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

const ACCOUNT_ID = Keypair.random().publicKey();
const SENDER_ONE = Keypair.random().publicKey();
const SENDER_TWO = Keypair.random().publicKey();
const SENDER_THREE = Keypair.random().publicKey();
const USDC_ISSUER = Keypair.random().publicKey();
const EURC_ISSUER = Keypair.random().publicKey();

const ISSUERS = { USDC: USDC_ISSUER, EURC: EURC_ISSUER };

let pagingToken = 0;

function payment({
  type = "payment",
  from = SENDER_ONE,
  to = ACCOUNT_ID,
  amount,
  asset = "native",
  createdAt = "2024-01-01T00:00:00Z",
  successful = true,
}) {
  pagingToken += 1;
  const isNative = asset === "native";
  return {
    type,
    from,
    to,
    amount,
    funder: type === "create_account" ? from : undefined,
    account: type === "create_account" ? to : undefined,
    starting_balance: type === "create_account" ? amount : undefined,
    asset_type: isNative ? "native" : "credit_alphanum4",
    asset_code: isNative ? undefined : asset,
    asset_issuer: isNative ? undefined : ISSUERS[asset],
    transaction_successful: successful,
    created_at: createdAt,
    paging_token: String(pagingToken),
  };
}

function mockPayments(records) {
  jest.spyOn(server, "payments").mockReturnValue({
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  });
}

function getSummary() {
  return request(app).get(`/account/${ACCOUNT_ID}/asset-received-summary`);
}

beforeEach(() => {
  jest.spyOn(server, "loadAccount").mockResolvedValue({ id: ACCOUNT_ID });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /account/:id/asset-received-summary", () => {
  it("returns one summary entry with the correct totalReceived for 3 inbound USDC payments", async () => {
    mockPayments([
      payment({ asset: "USDC", amount: "10.0000000", createdAt: "2024-01-01T00:00:00Z" }),
      payment({ asset: "USDC", amount: "25.5000000", createdAt: "2024-01-02T00:00:00Z" }),
      payment({ asset: "USDC", amount: "4.2500000", createdAt: "2024-01-03T00:00:00Z" }),
    ]);

    const res = await getSummary();

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accountId).toBe(ACCOUNT_ID);
    expect(res.body.data.summary).toHaveLength(1);
    expect(res.body.data.summary[0]).toMatchObject({
      asset: { code: "USDC", issuer: USDC_ISSUER, type: "credit_alphanum4" },
      totalReceived: "39.7500000",
      firstReceivedAt: "2024-01-01T00:00:00.000Z",
      lastReceivedAt: "2024-01-03T00:00:00.000Z",
    });
  });

  it("counts distinct senders in senderCount, not total payments", async () => {
    mockPayments([
      payment({ from: SENDER_ONE, asset: "USDC", amount: "1.0000000" }),
      payment({ from: SENDER_ONE, asset: "USDC", amount: "1.0000000" }),
      payment({ from: SENDER_TWO, asset: "USDC", amount: "1.0000000" }),
      payment({ from: SENDER_ONE, asset: "USDC", amount: "1.0000000" }),
      payment({ from: SENDER_TWO, asset: "USDC", amount: "1.0000000" }),
    ]);

    const res = await getSummary();

    expect(res.status).toBe(200);
    expect(res.body.data.summary).toHaveLength(1);
    expect(res.body.data.summary[0].totalReceived).toBe("5.0000000");
    expect(res.body.data.summary[0].senderCount).toBe(2);
  });

  it("sorts results by totalReceived descending", async () => {
    mockPayments([
      payment({ asset: "native", amount: "50.0000000" }),
      payment({ from: SENDER_TWO, asset: "EURC", amount: "500.0000000" }),
      payment({ from: SENDER_THREE, asset: "USDC", amount: "5.0000000" }),
      payment({ asset: "USDC", amount: "95.0000000" }),
    ]);

    const res = await getSummary();

    expect(res.status).toBe(200);
    const summary = res.body.data.summary;
    expect(summary.map((entry) => entry.asset.code)).toEqual(["EURC", "USDC", "XLM"]);
    expect(summary.map((entry) => entry.totalReceived)).toEqual([
      "500.0000000",
      "100.0000000",
      "50.0000000",
    ]);
  });

  it("returns an empty summary array for an account with no inbound payments", async () => {
    mockPayments([
      // Outbound only — must not appear in the inbound summary.
      payment({ from: ACCOUNT_ID, to: SENDER_ONE, asset: "USDC", amount: "10.0000000" }),
      payment({ from: ACCOUNT_ID, to: SENDER_TWO, amount: "3.0000000" }),
    ]);

    const res = await getSummary();

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.summary).toEqual([]);
  });

  it("returns 404 for a non-existent account", async () => {
    const notFound = new Error("Not Found");
    notFound.response = { status: 404 };
    server.loadAccount.mockRejectedValue(notFound);
    jest.spyOn(server, "payments");

    const res = await getSummary();

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(server.payments).not.toHaveBeenCalled();
  });

  it("ignores failed transactions and counts create_account funding as XLM received", async () => {
    mockPayments([
      payment({ type: "create_account", from: SENDER_TWO, amount: "3.0000000" }),
      payment({ asset: "native", amount: "4.0000000" }),
      payment({ asset: "USDC", amount: "100.0000000", successful: false }),
    ]);

    const res = await getSummary();

    expect(res.status).toBe(200);
    expect(res.body.data.summary).toHaveLength(1);
    expect(res.body.data.summary[0]).toMatchObject({
      asset: { code: "XLM", type: "native" },
      totalReceived: "7.0000000",
      senderCount: 2,
    });
  });
});
