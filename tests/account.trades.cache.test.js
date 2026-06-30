const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => ({
  ...jest.requireActual("../src/config/stellar"),
  server: { trades: jest.fn() },
}));

const app = require("../src/index");
const { server } = require("../src/config/stellar");
const cacheService = require("../src/services/cache");

const accountId = Keypair.random().publicKey();

function mockTrades(records) {
  const chain = {
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  };
  server.trades.mockReturnValue(chain);
  return chain;
}

describe("GET /account/:id/trades cache behavior", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  it("caches trades per account and pagination params", async () => {
    const firstChain = mockTrades([
      {
        id: "trade-1",
        paging_token: "pt-1",
        ledger_close_time: "2024-01-01T00:00:00Z",
        base_is_seller: true,
        base_amount: "10.0",
        base_asset_type: "native",
        counter_amount: "20.0",
        counter_asset_type: "credit_alphanum4",
        counter_asset_code: "USDC",
        counter_asset_issuer: Keypair.random().publicKey(),
      },
    ]);

    const url = `/account/${accountId}/trades?limit=10&order=asc&cursor=pt-0`;
    const res1 = await request(app).get(url);
    expect(res1.statusCode).toBe(200);
    expect(res1.get("X-Cache")).toBe("MISS");
    expect(firstChain.forAccount).toHaveBeenCalledWith(accountId);
    expect(firstChain.limit).toHaveBeenCalledWith(10);
    expect(firstChain.order).toHaveBeenCalledWith("asc");
    expect(firstChain.cursor).toHaveBeenCalledWith("pt-0");
    expect(server.trades).toHaveBeenCalledTimes(1);

    const res2 = await request(app).get(url);
    expect(res2.statusCode).toBe(200);
    expect(res2.get("X-Cache")).toBe("HIT");
    expect(server.trades).toHaveBeenCalledTimes(1);

    const secondChain = mockTrades([]);
    const differentPaginationRes = await request(app).get(
      `/account/${accountId}/trades?limit=20&order=asc&cursor=pt-0`,
    );
    expect(differentPaginationRes.statusCode).toBe(200);
    expect(differentPaginationRes.get("X-Cache")).toBe("MISS");
    expect(secondChain.limit).toHaveBeenCalledWith(20);
    expect(server.trades).toHaveBeenCalledTimes(2);
  });

  it("bypasses cache when ?fresh=true is passed", async () => {
    mockTrades([
      {
        id: "trade-1",
        paging_token: "pt-1",
        ledger_close_time: "2024-01-01T00:00:00Z",
        base_is_seller: false,
      },
    ]);

    const baseUrl = `/account/${accountId}/trades`;
    const res1 = await request(app).get(baseUrl);
    expect(res1.statusCode).toBe(200);
    expect(res1.get("X-Cache")).toBe("MISS");
    expect(server.trades).toHaveBeenCalledTimes(1);

    mockTrades([
      {
        id: "trade-2",
        paging_token: "pt-2",
        ledger_close_time: "2024-01-01T00:00:10Z",
        base_is_seller: true,
      },
    ]);
    const res2 = await request(app).get(`${baseUrl}?fresh=true`);
    expect(res2.statusCode).toBe(200);
    expect(res2.get("X-Cache")).toBe("MISS");
    expect(server.trades).toHaveBeenCalledTimes(2);
  });
});
