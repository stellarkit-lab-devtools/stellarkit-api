"use strict";

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");
const cacheService = require("../../src/services/cache");

const ACCOUNT_ID = Keypair.random().publicKey();
const RECIPIENT_ONE = Keypair.random().publicKey();
const RECIPIENT_TWO = Keypair.random().publicKey();
const RECIPIENT_THREE = Keypair.random().publicKey();
const USDC_ISSUER = Keypair.random().publicKey();
const EURC_ISSUER = Keypair.random().publicKey();

const ISSUERS = { USDC: USDC_ISSUER, EURC: EURC_ISSUER };

let pagingToken = 0;

function payment({
  type = "payment",
  from = ACCOUNT_ID,
  to = RECIPIENT_ONE,
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

function getSummary(fresh = false) {
  let url = `/account/${ACCOUNT_ID}/asset-sent-summary`;
  if (fresh) url += "?fresh=true";
  return request(app).get(url);
}

beforeEach(() => {
  jest.spyOn(server, "loadAccount").mockResolvedValue({ id: ACCOUNT_ID });
  cacheService.flush();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /account/:id/asset-sent-summary — caching behaviour", () => {
  it("first request returns X-Cache: MISS", async () => {
    mockPayments([
      payment({ asset: "USDC", amount: "10.0000000", to: RECIPIENT_ONE }),
      payment({ asset: "USDC", amount: "25.5000000", to: RECIPIENT_TWO }),
      payment({ asset: "USDC", amount: "4.2500000", to: RECIPIENT_THREE }),
    ]);

    const res = await getSummary();

    expect(res.status).toBe(200);
    expect(res.get("X-Cache")).toBe("MISS");
    expect(res.body.success).toBe(true);
    expect(res.body.data.accountId).toBe(ACCOUNT_ID);
    expect(res.body.data.summary).toHaveLength(1);
    expect(res.body.data.summary[0].totalSent).toBe("39.7500000");
  });

  it("repeated request returns X-Cache: HIT", async () => {
    mockPayments([
      payment({ asset: "USDC", amount: "10.0000000", to: RECIPIENT_ONE }),
      payment({ asset: "USDC", amount: "25.5000000", to: RECIPIENT_TWO }),
      payment({ asset: "USDC", amount: "4.2500000", to: RECIPIENT_THREE }),
    ]);

    const res1 = await getSummary();
    expect(res1.get("X-Cache")).toBe("MISS");
    const data1 = res1.body.data;

    // Clear mocks and make a second request
    jest.clearAllMocks();
    server.loadAccount.mockResolvedValue({ id: ACCOUNT_ID });

    const res2 = await getSummary();
    expect(res2.status).toBe(200);
    expect(res2.get("X-Cache")).toBe("HIT");
    expect(res2.body.data).toEqual(data1);
  });

  it("?fresh=true forces a live recalculation returning X-Cache: MISS", async () => {
    mockPayments([
      payment({ asset: "USDC", amount: "10.0000000", to: RECIPIENT_ONE }),
    ]);

    const res1 = await getSummary();
    expect(res1.get("X-Cache")).toBe("MISS");

    jest.clearAllMocks();
    server.loadAccount.mockResolvedValue({ id: ACCOUNT_ID });
    mockPayments([
      payment({ asset: "USDC", amount: "10.0000000", to: RECIPIENT_ONE }),
      payment({ asset: "USDC", amount: "5.0000000", to: RECIPIENT_TWO }),
    ]);

    const res2 = await getSummary(true);
    expect(res2.status).toBe(200);
    expect(res2.get("X-Cache")).toBe("MISS");
    expect(res2.body.data.summary[0].totalSent).toBe("15.0000000");
  });

  it("cache keys are scoped per account so two different accounts never share entries", async () => {
    const ACCOUNT_B = Keypair.random().publicKey();

    // First account's request
    mockPayments([
      payment({ from: ACCOUNT_ID, to: RECIPIENT_ONE, amount: "100.0000000" }),
    ]);
    const res1 = await getSummary();
    expect(res1.body.data.summary[0].totalSent).toBe("100.0000000");

    jest.clearAllMocks();
    server.loadAccount.mockResolvedValue({ id: ACCOUNT_B });

    // Second account's request
    mockPayments([
      payment({ from: ACCOUNT_B, to: RECIPIENT_ONE, amount: "50.0000000" }),
    ]);
    const res2 = await request(app).get(`/account/${ACCOUNT_B}/asset-sent-summary`);
    expect(res2.body.data.summary[0].totalSent).toBe("50.0000000");

    // Verify first account still has its cached value
    jest.clearAllMocks();
    const res3 = await getSummary();
    expect(res3.get("X-Cache")).toBe("HIT");
    expect(res3.body.data.summary[0].totalSent).toBe("100.0000000");
  });
});
