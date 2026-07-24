const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

// Covers GitHub issue #494: every list endpoint must return { items: [], total: 0 }
// (never null or an omitted data field) when Horizon returns no records.

jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    server: {
      accounts: jest.fn(),
      assets: jest.fn(),
      operations: jest.fn(),
      offers: jest.fn(),
      transactions: jest.fn(),
    },
  };
});

const app = require("../src/index");
const { server } = require("../src/config/stellar");

function emptyChain() {
  const chain = {};
  ["forAsset", "forCode", "forAccount", "limit", "order", "cursor", "includeFailed"].forEach((method) => {
    chain[method] = jest.fn().mockReturnValue(chain);
  });
  chain.call = jest.fn().mockResolvedValue({ records: [] });
  return chain;
}

describe("Empty list responses (#494)", () => {
  const accountId = Keypair.random().publicKey();
  const issuer = Keypair.random().publicKey();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("GET /asset/:code/:issuer/holders returns { items: [], total: 0 }", async () => {
    server.accounts.mockReturnValue(emptyChain());

    const res = await request(app).get(`/asset/USDC/${issuer}/holders`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });

  it("GET /asset/search returns { items: [], total: 0 }", async () => {
    server.assets.mockReturnValue(emptyChain());

    const res = await request(app).get("/asset/search?code=ZZZZ");

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });

  it("GET /account/:id/payments returns { items: [], total: 0 }", async () => {
    server.operations.mockReturnValue(emptyChain());

    const res = await request(app).get(`/account/${accountId}/payments`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });

  it("GET /account/:id/offers returns { items: [], total: 0 }", async () => {
    server.offers.mockReturnValue(emptyChain());

    const res = await request(app).get(`/account/${accountId}/offers`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });

  it("GET /transactions/:id returns { items: [], total: 0 }", async () => {
    server.transactions.mockReturnValue(emptyChain());

    const res = await request(app).get(`/transactions/${accountId}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });

  it("GET /transactions/:id/operations returns { items: [], total: 0 }", async () => {
    server.operations.mockReturnValue(emptyChain());

    const res = await request(app).get(`/transactions/${accountId}/operations`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });
});
