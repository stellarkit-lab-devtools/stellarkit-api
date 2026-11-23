const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    server: {
      loadAccount: jest.fn(),
      operations: jest.fn(),
      payments: jest.fn(),
      offers: jest.fn(),
      transactions: jest.fn(),
      claimableBalances: jest.fn(),
      effects: jest.fn(),
    },
  };
});

const app = require("../src/index");
const { server } = require("../src/config/stellar");
const cacheService = require("../src/services/cache");
const { buildNextPageUrl, buildNextLinkHeader } = require("../src/utils/pagination");

const ACCOUNT = Keypair.random().publicKey();
const ISSUER = Keypair.random().publicKey();

function chain(records) {
  const builder = {
    forAccount: jest.fn().mockReturnThis(),
    claimant: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    includeFailed: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  };
  return builder;
}

/** Extracts the URL from a `<url>; rel="next"` header value. */
function nextUrl(res) {
  const header = res.headers.link;
  expect(header).toBeDefined();
  const match = header.match(/^<([^>]+)>; rel="next"$/);
  expect(match).not.toBeNull();
  return new URL(match[1]);
}

const paymentRecord = (token) => ({
  id: token,
  paging_token: token,
  type: "payment",
  from: ISSUER,
  to: ACCOUNT,
  asset_type: "credit_alphanum4",
  asset_code: "USDC",
  asset_issuer: ISSUER,
  amount: "10.0000000",
  created_at: "2024-01-01T00:00:00Z",
  transaction_hash: `tx-${token}`,
});

const offerRecord = (token) => ({
  id: token,
  paging_token: token,
  seller: ACCOUNT,
  selling_asset_type: "native",
  buying_asset_type: "credit_alphanum4",
  buying_asset_code: "USDC",
  buying_asset_issuer: ISSUER,
  amount: "5.0000000",
  price: "0.1000000",
  price_r: { n: 1, d: 10 },
  last_modified_ledger: 100,
});

const transactionRecord = (token) => ({
  id: `hash-${token}`,
  hash: `hash-${token}`,
  paging_token: token,
  ledger_attr: 100,
  created_at: "2024-01-01T00:00:00Z",
  operation_count: 1,
  successful: true,
  source_account: ACCOUNT,
  fee_charged: "100",
  max_fee: "100",
  fee_account: ACCOUNT,
});

const claimableBalanceRecord = (token) => ({
  id: `00000000${token}`,
  paging_token: token,
  asset: "native",
  amount: "1.0000000",
  sponsor: ISSUER,
  created_at: "2024-01-01T00:00:00Z",
  claimants: [],
});

const trustlineEffect = (token) => ({
  id: token,
  paging_token: token,
  account: ACCOUNT,
  type: "trustline_created",
  asset_type: "credit_alphanum4",
  asset_code: "USDC",
  asset_issuer: ISSUER,
  limit: "1000.0000000",
  created_at: "2024-01-01T00:00:00Z",
  transaction_hash: `tx-${token}`,
});

beforeEach(() => {
  jest.clearAllMocks();
  cacheService.flush();
  server.loadAccount.mockResolvedValue({ id: ACCOUNT, account_id: ACCOUNT });
});

describe("buildNextPageUrl", () => {
  function fakeReq(originalUrl, { protocol = "http", host = "api.example.com" } = {}) {
    return {
      protocol,
      originalUrl,
      get: (name) => (name.toLowerCase() === "host" ? host : undefined),
    };
  }

  it("replaces only the cursor and keeps every other parameter in order", () => {
    const url = buildNextPageUrl(fakeReq("/a/b?limit=10&cursor=old&order=asc"), "new");
    expect(url).toBe("http://api.example.com/a/b?limit=10&cursor=new&order=asc");
  });

  it("appends a cursor when the request had none", () => {
    const url = buildNextPageUrl(fakeReq("/a/b?limit=10"), "123-4");
    expect(url).toBe("http://api.example.com/a/b?limit=10&cursor=123-4");
  });

  it("percent-encodes asset parameters and spaces", () => {
    const url = buildNextPageUrl(
      fakeReq(`/a?asset=USDC:${ISSUER}&note=hello+world&x=a%2Fb`),
      "9",
    );
    expect(url).toBe(
      `http://api.example.com/a?asset=USDC%3A${ISSUER}&note=hello%20world&x=a%2Fb&cursor=9`,
    );
  });

  it("uses req.protocol and the Host header", () => {
    const url = buildNextPageUrl(
      fakeReq("/x", { protocol: "https", host: "proxy.example.org:8443" }),
      "1",
    );
    expect(url).toBe("https://proxy.example.org:8443/x?cursor=1");
  });

  it("returns null without a cursor", () => {
    expect(buildNextPageUrl(fakeReq("/x"), null)).toBeNull();
    expect(buildNextLinkHeader(fakeReq("/x"), "")).toBeNull();
  });
});

describe("Link: rel=\"next\" on paginated routes", () => {
  it("GET /account/:id/operations emits a next link", async () => {
    server.operations.mockReturnValue(chain([paymentRecord("111"), paymentRecord("222")]));

    const res = await request(app).get(`/account/${ACCOUNT}/operations?limit=2`);

    expect(res.status).toBe(200);
    expect(res.body.meta.hasMore).toBe(true);
    const url = nextUrl(res);
    expect(url.pathname).toBe(`/account/${ACCOUNT}/operations`);
    expect(url.searchParams.get("cursor")).toBe("222");
    expect(url.searchParams.get("limit")).toBe("2");
  });

  it("GET /account/:id/payments preserves asset filter params and replaces the cursor", async () => {
    server.payments.mockReturnValue(chain([paymentRecord("333")]));

    const res = await request(app).get(
      `/account/${ACCOUNT}/payments?assetCode=USDC&assetIssuer=${ISSUER}&cursor=100&order=asc`,
    );

    expect(res.status).toBe(200);
    const raw = res.headers.link;
    expect(raw).toContain(`assetCode=USDC&assetIssuer=${ISSUER}&cursor=333&order=asc`);
    expect(raw).not.toContain("cursor=100");
  });

  it("GET /account/:id/offers emits a next link built from the Host header", async () => {
    server.offers.mockReturnValue(chain([offerRecord("444")]));

    const res = await request(app)
      .get(`/account/${ACCOUNT}/offers?limit=1`)
      .set("Host", "stellarkit.example.com");

    expect(res.status).toBe(200);
    const url = nextUrl(res);
    expect(url.host).toBe("stellarkit.example.com");
    expect(url.protocol).toBe("http:");
    expect(url.searchParams.get("cursor")).toBe("444");
  });

  it("GET /transactions/:id emits a next link", async () => {
    server.transactions.mockReturnValue(chain([transactionRecord("555")]));

    const res = await request(app).get(`/transactions/${ACCOUNT}?limit=1&order=desc`);

    expect(res.status).toBe(200);
    const url = nextUrl(res);
    expect(url.pathname).toBe(`/transactions/${ACCOUNT}`);
    expect(url.search).toBe("?limit=1&order=desc&cursor=555");
  });

  it("GET /account/:id/claimable-balances emits a next link when hasMore is true", async () => {
    server.claimableBalances.mockReturnValue(
      chain([claimableBalanceRecord("666"), claimableBalanceRecord("777")]),
    );

    const res = await request(app).get(`/account/${ACCOUNT}/claimable-balances?limit=1`);

    expect(res.status).toBe(200);
    expect(res.body.meta.hasMore).toBe(true);
    expect(nextUrl(res).searchParams.get("cursor")).toBe("777");
  });

  it("GET /account/:id/trustline-history percent-encodes the asset parameter", async () => {
    server.effects.mockReturnValue(chain([trustlineEffect("888"), trustlineEffect("999")]));

    const res = await request(app).get(
      `/account/${ACCOUNT}/trustline-history?asset=USDC:${ISSUER}&limit=1`,
    );

    expect(res.status).toBe(200);
    expect(res.body.meta.hasMore).toBe(true);
    expect(res.headers.link).toContain(`asset=USDC%3A${ISSUER}`);
    expect(nextUrl(res).searchParams.get("asset")).toBe(`USDC:${ISSUER}`);
    expect(nextUrl(res).searchParams.get("cursor")).toBe("888");
  });

  describe("absent on the final page", () => {
    it("GET /account/:id/operations", async () => {
      server.operations.mockReturnValue(chain([]));
      const res = await request(app).get(`/account/${ACCOUNT}/operations`);
      expect(res.status).toBe(200);
      expect(res.body.meta.hasMore).toBe(false);
      expect(res.headers.link).toBeUndefined();
    });

    it("GET /account/:id/payments", async () => {
      server.payments.mockReturnValue(chain([]));
      const res = await request(app).get(`/account/${ACCOUNT}/payments`);
      expect(res.status).toBe(200);
      expect(res.headers.link).toBeUndefined();
    });

    it("GET /account/:id/offers", async () => {
      server.offers.mockReturnValue(chain([]));
      const res = await request(app).get(`/account/${ACCOUNT}/offers`);
      expect(res.status).toBe(200);
      expect(res.headers.link).toBeUndefined();
    });

    it("GET /transactions/:id", async () => {
      server.transactions.mockReturnValue(chain([]));
      const res = await request(app).get(`/transactions/${ACCOUNT}`);
      expect(res.status).toBe(200);
      expect(res.headers.link).toBeUndefined();
    });

    it("GET /account/:id/claimable-balances", async () => {
      server.claimableBalances.mockReturnValue(chain([claimableBalanceRecord("1")]));
      const res = await request(app).get(`/account/${ACCOUNT}/claimable-balances?limit=5`);
      expect(res.status).toBe(200);
      expect(res.body.meta.hasMore).toBe(false);
      expect(res.headers.link).toBeUndefined();
    });

    it("GET /account/:id/trustline-history", async () => {
      server.effects.mockReturnValue(chain([trustlineEffect("1")]));
      const res = await request(app).get(`/account/${ACCOUNT}/trustline-history`);
      expect(res.status).toBe(200);
      expect(res.body.meta.hasMore).toBe(false);
      expect(res.headers.link).toBeUndefined();
    });
  });
});
