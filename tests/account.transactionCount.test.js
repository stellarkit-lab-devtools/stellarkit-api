const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const { Keypair } = require("@stellar/stellar-sdk");

const ACCOUNT_ID = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const HORIZON_404 = { response: { status: 404 } };

jest.mock("../src/config/stellar", () => {
  const actual = jest.requireActual("../src/config/stellar");
  return {
    ...actual,
    server: {
      loadAccount: jest.fn(),
      transactions: jest.fn(),
    },
  };
});

function makeTx(hash, createdAt, pagingToken) {
  return { hash, created_at: createdAt, paging_token: pagingToken };
}

function mockPages(pages) {
  const call = jest.fn();
  pages.forEach((records) => call.mockResolvedValueOnce({ records }));

  server.transactions.mockReturnValue({
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call,
  });

  return call;
}

describe("GET /account/:id/transaction-count", () => {
  const accountId = Keypair.random().publicKey();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("counts all transactions when 'since' is omitted", async () => {
    const records = [
      makeTx("h1", "2024-01-03T00:00:00Z", "t1"),
      makeTx("h2", "2024-01-02T00:00:00Z", "t2"),
      makeTx("h3", "2024-01-01T00:00:00Z", "t3"),
    ];
    mockPages([records]);

    const res = await request(app).get(`/account/${accountId}/transaction-count`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.count).toBe(3);
    expect(res.body.data.since).toBeNull();
  });

  it("paginates through multiple pages when counting all transactions", async () => {
    const fullPage = Array.from({ length: 200 }, (_, i) =>
      makeTx(`h${i}`, "2024-01-01T00:00:00Z", `t${i}`),
    );
    const lastPage = [makeTx("hlast", "2023-12-01T00:00:00Z", "tlast")];
    const call = mockPages([fullPage, lastPage]);

    const res = await request(app).get(`/account/${accountId}/transaction-count`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.count).toBe(201);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("counts 0 transactions for an account with no history", async () => {
    mockPages([[]]);

    const res = await request(app).get(`/account/${accountId}/transaction-count`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.count).toBe(0);
  });

  it("filters the count to transactions after the given 'since' date", async () => {
    const records = [
      makeTx("h1", "2024-03-01T00:00:00Z", "t1"),
      makeTx("h2", "2024-02-15T00:00:00Z", "t2"),
      makeTx("h3", "2024-01-01T00:00:00Z", "t3"),
    ];
    mockPages([records]);

    const res = await request(app).get(
      `/account/${accountId}/transaction-count?since=2024-02-01T00:00:00Z`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.count).toBe(2);
    expect(res.body.data.since).toBe("2024-02-01T00:00:00.000Z");
  });

  it("stops paginating as soon as it crosses the 'since' cutoff", async () => {
    const fullPage = Array.from({ length: 200 }, (_, i) =>
      makeTx(`h${i}`, "2024-06-01T00:00:00Z", `t${i}`),
    );
    // Older transactions that a full history scan would otherwise have to read.
    const olderPage = [makeTx("hold", "2020-01-01T00:00:00Z", "told")];
    const call = mockPages([fullPage, olderPage]);

    const res = await request(app).get(
      `/account/${accountId}/transaction-count?since=2023-01-01T00:00:00Z`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.count).toBe(200);
    // Second page is fetched (it contains the older tx that ends the scan),
    // but no third page is ever requested even though records exist beyond it.
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("returns 400 for an invalid 'since' date string", async () => {
    const res = await request(app).get(
      `/account/${accountId}/transaction-count?since=not-a-date`,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
    expect(res.body.error.message).toContain("since");
    expect(res.body.error.field).toBe("since");
  });

  it("returns 400 for an empty 'since' value", async () => {
    const res = await request(app).get(
      `/account/${accountId}/transaction-count?since=`,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.field).toBe("since");
  });
});
