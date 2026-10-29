const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../../src/config/stellar", () => ({
  ...jest.requireActual("../../src/config/stellar"),
  server: {
    loadAccount: jest.fn(),
    payments: jest.fn(),
  },
}));

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");
const cacheService = require("../../src/services/cache");

const ACCOUNT_ID = Keypair.random().publicKey();
const SENDER_ID_1 = Keypair.random().publicKey();

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

let pagingToken = 0;

function inboundXlm(amount, daysAgo) {
  pagingToken += 1;
  return {
    type: "payment",
    from: SENDER_ID_1,
    to: ACCOUNT_ID,
    amount,
    asset_type: "native",
    transaction_successful: true,
    created_at: new Date(Date.now() - daysAgo * DAY_MS - HOUR_MS).toISOString(),
    paging_token: String(pagingToken),
  };
}

function mockPayments(records) {
  const sorted = [...records].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );
  const chain = {
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records: sorted }),
  };
  server.payments.mockReturnValue(chain);
  return chain;
}

describe("GET /account/:id/balance-velocity — caching", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
    server.loadAccount.mockResolvedValue({ id: ACCOUNT_ID });
  });

  it("sets X-Cache: MISS on first request", async () => {
    const records = [
      inboundXlm("10.0000000", 1),
      inboundXlm("10.0000000", 2),
      inboundXlm("5.0000000", 0),
    ];
    mockPayments(records);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/balance-velocity`);

    expect(res.statusCode).toBe(200);
    expect(res.get("X-Cache")).toBe("MISS");
    expect(res.body.success).toBe(true);
    expect(res.body.data.accountId).toBe(ACCOUNT_ID);
  });

  it("sets X-Cache: HIT on second request with identical data", async () => {
    const records = [
      inboundXlm("10.0000000", 1),
      inboundXlm("10.0000000", 2),
      inboundXlm("5.0000000", 0),
    ];
    mockPayments(records);

    const url = `/account/${ACCOUNT_ID}/balance-velocity`;

    // First request
    const res1 = await request(app).get(url);
    expect(res1.statusCode).toBe(200);
    expect(res1.get("X-Cache")).toBe("MISS");
    const data1 = res1.body.data;

    // Reset mock to verify it's not called again
    jest.clearAllMocks();
    server.loadAccount.mockResolvedValue({ id: ACCOUNT_ID });

    // Second request should hit cache
    const res2 = await request(app).get(url);
    expect(res2.statusCode).toBe(200);
    expect(res2.get("X-Cache")).toBe("HIT");
    expect(res2.body.data).toEqual(data1);
    expect(server.payments).not.toHaveBeenCalled();
  });

  it("forces fresh data when ?fresh=true is used", async () => {
    const records = [
      inboundXlm("10.0000000", 1),
      inboundXlm("10.0000000", 2),
      inboundXlm("5.0000000", 0),
    ];
    mockPayments(records);

    const url = `/account/${ACCOUNT_ID}/balance-velocity`;

    // First request
    const res1 = await request(app).get(url);
    expect(res1.statusCode).toBe(200);
    expect(res1.get("X-Cache")).toBe("MISS");
    expect(server.payments).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    server.loadAccount.mockResolvedValue({ id: ACCOUNT_ID });
    mockPayments(records);

    // Second request with fresh=true should bypass cache
    const res2 = await request(app).get(`${url}?fresh=true`);
    expect(res2.statusCode).toBe(200);
    expect(res2.get("X-Cache")).toBe("MISS");
    expect(server.payments).toHaveBeenCalledTimes(1);
  });

  it("maintains separate cache entries for different accounts", async () => {
    const ACCOUNT_ID_2 = Keypair.random().publicKey();

    const records1 = [
      inboundXlm("10.0000000", 1),
      inboundXlm("5.0000000", 0),
    ];
    mockPayments(records1);

    // First account request
    const res1 = await request(app).get(`/account/${ACCOUNT_ID}/balance-velocity`);
    expect(res1.statusCode).toBe(200);
    expect(res1.get("X-Cache")).toBe("MISS");
    const data1 = res1.body.data;

    // Mock for second account
    jest.clearAllMocks();
    server.loadAccount.mockResolvedValue({ id: ACCOUNT_ID_2 });

    // Different payments history for account 2 (higher activity)
    const records2 = [
      inboundXlm("100.0000000", 1),
      inboundXlm("150.0000000", 2),
      inboundXlm("200.0000000", 0),
    ];

    const sender2 = Keypair.random().publicKey();
    const records2Modified = records2.map((r) => ({ ...r, from: sender2, to: ACCOUNT_ID_2 }));
    mockPayments(records2Modified);

    // Second account request
    const res2 = await request(app).get(`/account/${ACCOUNT_ID_2}/balance-velocity`);
    expect(res2.statusCode).toBe(200);
    expect(res2.get("X-Cache")).toBe("MISS");
    const data2 = res2.body.data;

    // Data should be different
    expect(data1.currentRate).not.toBe(data2.currentRate);

    // Cache entries should be separate
    jest.clearAllMocks();
    server.loadAccount.mockResolvedValue({ id: ACCOUNT_ID });

    const res1_retry = await request(app).get(`/account/${ACCOUNT_ID}/balance-velocity`);
    expect(res1_retry.get("X-Cache")).toBe("HIT");
    expect(res1_retry.body.data).toEqual(data1);

    server.loadAccount.mockResolvedValue({ id: ACCOUNT_ID_2 });

    const res2_retry = await request(app).get(`/account/${ACCOUNT_ID_2}/balance-velocity`);
    expect(res2_retry.get("X-Cache")).toBe("HIT");
    expect(res2_retry.body.data).toEqual(data2);
  });
});
