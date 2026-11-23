"use strict";

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

const ACCOUNT_ID = Keypair.random().publicKey();
const SENDER_ID = Keypair.random().publicKey();

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

let pagingToken = 0;

/**
 * Inbound native payment placed `daysAgo` full days before now. The one-hour
 * offset keeps it safely inside its 24h bucket while the request runs.
 */
function inboundXlm(amount, daysAgo) {
  pagingToken += 1;
  return {
    type: "payment",
    from: SENDER_ID,
    to: ACCOUNT_ID,
    amount,
    asset_type: "native",
    transaction_successful: true,
    created_at: new Date(Date.now() - daysAgo * DAY_MS - HOUR_MS).toISOString(),
    paging_token: String(pagingToken),
  };
}

/**
 * Builds 14 days of history with controlled variance: daily inbound totals
 * alternate 9 and 11 XLM, giving a mean of 10 and a standard deviation of 1,
 * so the flag threshold is exactly 12 XLM.
 */
function historyWithControlledVariance() {
  const records = [];
  for (let day = 1; day <= 14; day += 1) {
    records.push(inboundXlm(day % 2 === 0 ? "9.0000000" : "11.0000000", day));
  }
  return records;
}

function mockPayments(records) {
  // Horizon returns newest first for order("desc").
  const sorted = [...records].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at),
  );
  jest.spyOn(server, "payments").mockReturnValue({
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records: sorted }),
  });
}

beforeEach(() => {
  jest.spyOn(server, "loadAccount").mockResolvedValue({ id: ACCOUNT_ID });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /account/:id/balance-velocity", () => {
  it("returns velocityFlag: false when the current change is within the normal range", async () => {
    mockPayments([...historyWithControlledVariance(), inboundXlm("10.5000000", 0)]);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/balance-velocity`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accountId).toBe(ACCOUNT_ID);
    expect(res.body.data.currentRate).toBe("10.5000000");
    expect(res.body.data.baseline).toEqual({
      sampleDays: 14,
      average: "10.0000000",
      standardDeviation: "1.0000000",
      threshold: "12.0000000",
    });
    expect(res.body.data.velocityFlag).toBe(false);
  });

  it("returns velocityFlag: true when the current change is double the historical average", async () => {
    mockPayments([...historyWithControlledVariance(), inboundXlm("20.0000000", 0)]);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/balance-velocity`);

    expect(res.status).toBe(200);
    expect(res.body.data.currentRate).toBe("20.0000000");
    expect(res.body.data.baseline.average).toBe("10.0000000");
    expect(res.body.data.velocityFlag).toBe(true);
  });

  it("always returns velocityFlag: false when history is too short for a baseline", async () => {
    mockPayments([
      inboundXlm("1.0000000", 2),
      inboundXlm("1.0000000", 1),
      inboundXlm("5000.0000000", 0),
    ]);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/balance-velocity`);

    expect(res.status).toBe(200);
    expect(res.body.data.currentRate).toBe("5000.0000000");
    expect(res.body.data.baseline).toEqual({
      sampleDays: 2,
      average: null,
      standardDeviation: null,
      threshold: null,
    });
    expect(res.body.data.velocityFlag).toBe(false);
  });

  it("always includes all three time window fields, even when they are zero", async () => {
    mockPayments([]);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/balance-velocity`);

    expect(res.status).toBe(200);
    expect(res.body.data.windows).toEqual({
      change24h: "0.0000000",
      change7d: "0.0000000",
      change30d: "0.0000000",
    });
    expect(res.body.data.velocityFlag).toBe(false);
  });

  it("sums each time window from the bucketed history", async () => {
    mockPayments([...historyWithControlledVariance(), inboundXlm("10.5000000", 0)]);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/balance-velocity`);

    // Days 1-6 alternate 11/9 (sum 60); days 1-14 sum 140.
    expect(res.body.data.windows).toEqual({
      change24h: "10.5000000",
      change7d: "70.5000000",
      change30d: "150.5000000",
    });
  });

  it("returns 404 when the account does not exist", async () => {
    const notFound = new Error("Not Found");
    notFound.response = { status: 404 };
    server.loadAccount.mockRejectedValue(notFound);
    jest.spyOn(server, "payments");

    const res = await request(app).get(`/account/${ACCOUNT_ID}/balance-velocity`);

    expect(res.status).toBe(404);
    expect(server.payments).not.toHaveBeenCalled();
  });
});
