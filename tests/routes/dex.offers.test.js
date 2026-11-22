/**
 * Tests for GET /dex/offers — network-wide open offer search.
 */
const request = require("supertest");
const express = require("express");
const { Keypair, Asset } = require("@stellar/stellar-sdk");

const SELLER = Keypair.random().publicKey();
const SPONSOR = Keypair.random().publicKey();
const ISSUER = Keypair.random().publicKey();
const mockCall = jest.fn();
const mockApplied = {};

function mockChain() {
  const builder = {
    seller: jest.fn((v) => { mockApplied.seller = v; return builder; }),
    sponsor: jest.fn((v) => { mockApplied.sponsor = v; return builder; }),
    selling: jest.fn((v) => { mockApplied.selling = v; return builder; }),
    buying: jest.fn((v) => { mockApplied.buying = v; return builder; }),
    limit: jest.fn((v) => { mockApplied.limit = v; return builder; }),
    order: jest.fn((v) => { mockApplied.order = v; return builder; }),
    cursor: jest.fn((v) => { mockApplied.cursor = v; return builder; }),
    call: mockCall,
  };
  return builder;
}

jest.mock("../../src/config/stellar", () => ({
  server: { offers: jest.fn(() => mockChain()) },
  horizonUrl: "https://horizon-testnet.stellar.org",
  NETWORK: "testnet",
  NETWORKS: { testnet: "https://horizon-testnet.stellar.org", mainnet: "https://horizon.stellar.org" },
}));

const app = express();
app.use(express.json());
app.use("/dex", require("../../src/routes/dex"));
app.use(require("../../src/middleware/errorHandler"));

function makeOffer(overrides = {}) {
  return {
    id: "123",
    seller: SELLER,
    selling_asset_type: "credit_alphanum4",
    selling_asset_code: "USDC",
    selling_asset_issuer: ISSUER,
    buying_asset_type: "native",
    amount: "10.5",
    price: "1.25",
    sponsor: SPONSOR,
    last_modified_ledger: 12345,
    last_modified_at: "2026-01-02T03:04:05Z",
    paging_token: "123",
    ...overrides,
  };
}

describe("GET /dex/offers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockApplied).forEach((k) => delete mockApplied[k]);
    mockCall.mockResolvedValue({ records: [makeOffer()] });
  });

  it("requires at least one filter", async () => {
    const res = await request(app).get("/dex/offers");
    expect(res.statusCode).toBe(400);
    expect(res.body.error.type).toBe("MissingFilter");
    expect(mockCall).not.toHaveBeenCalled();
  });

  it("filters by seller", async () => {
    const res = await request(app).get(`/dex/offers?seller=${SELLER}`);
    expect(res.statusCode).toBe(200);
    expect(mockApplied.seller).toBe(SELLER);
    expect(res.body.data.offers[0]).toMatchObject({
      offerId: "123",
      seller: SELLER,
      selling: { code: "USDC", issuer: ISSUER, type: "credit_alphanum4" },
      buying: { code: "XLM", issuer: null, type: "native" },
      amount: "10.5000000",
      price: "1.2500000",
      sponsor: SPONSOR,
      lastModifiedLedger: 12345,
      lastModifiedAt: "2026-01-02T03:04:05.000Z",
    });
  });

  it("filters by selling asset (CODE:ISSUER and XLM)", async () => {
    await request(app).get(`/dex/offers?selling=USDC:${ISSUER}`);
    expect(mockApplied.selling).toBeInstanceOf(Asset);
    expect(mockApplied.selling.code).toBe("USDC");
    await request(app).get("/dex/offers?selling=XLM");
    expect(mockApplied.selling.isNative()).toBe(true);
  });

  it("filters by buying asset", async () => {
    await request(app).get(`/dex/offers?buying=USDC:${ISSUER}`);
    expect(mockApplied.buying).toBeInstanceOf(Asset);
    expect(mockApplied.buying.code).toBe("USDC");
  });

  it("filters by sponsor", async () => {
    await request(app).get(`/dex/offers?sponsor=${SPONSOR}`);
    expect(mockApplied.sponsor).toBe(SPONSOR);
  });

  it("combines filters, pagination and order", async () => {
    const res = await request(app).get(
      `/dex/offers?seller=${SELLER}&selling=XLM&buying=USDC:${ISSUER}&sponsor=${SPONSOR}&limit=5&order=asc&cursor=99`,
    );
    expect(res.statusCode).toBe(200);
    expect(mockApplied.seller).toBe(SELLER);
    expect(mockApplied.selling.isNative()).toBe(true);
    expect(mockApplied.buying.code).toBe("USDC");
    expect(mockApplied.sponsor).toBe(SPONSOR);
    expect(mockApplied.limit).toBe(5);
    expect(mockApplied.order).toBe("asc");
    expect(mockApplied.cursor).toBe("99");
  });

  it("rejects a malformed asset", async () => {
    const res = await request(app).get("/dex/offers?selling=NOT_AN_ASSET");
    expect(res.statusCode).toBe(400);
    expect(res.body.error.type).toBe("ValidationError");
    expect(mockCall).not.toHaveBeenCalled();
  });

  it("returns an empty result set", async () => {
    mockCall.mockResolvedValue({ records: [] });
    const res = await request(app).get(`/dex/offers?seller=${SELLER}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({ offers: [], total: 0 });
  });
});
