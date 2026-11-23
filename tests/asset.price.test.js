const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const cacheService = require("../src/services/cache");

describe("GET /asset/:code/:issuer/price", () => {
  const ASSET_CODE = "USDC";
  const ASSET_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
  const BASE = `/asset/${ASSET_CODE}/${ASSET_ISSUER}/price`;

  /**
   * Stub the chainable Horizon call the route makes:
   *   server.orderbook(asset, Asset.native()).limit(200).call()
   */
  function mockOrderBook({ bids = [], asks = [] }) {
    const call = jest.fn().mockResolvedValue({ bids, asks });
    const limit = jest.fn().mockReturnThis();
    const orderbook = jest
      .spyOn(server, "orderbook")
      .mockReturnValue({ limit, call });
    return { orderbook, limit, call };
  }

  const BOOK = {
    bids: [
      { price: "0.1284000", amount: "4200.0000000" },
      { price: "0.1280000", amount: "800.0000000" },
    ],
    asks: [
      { price: "0.1291000", amount: "3800.0000000" },
      { price: "0.1295000", amount: "1200.0000000" },
    ],
  };

  beforeEach(() => {
    cacheService.flush();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Horizon wiring ─────────────────────────────────────────────────────────

  it("prices the asset against XLM using the live order book", async () => {
    const { orderbook } = mockOrderBook(BOOK);

    const res = await request(app).get(BASE);

    expect(res.statusCode).toBe(200);
    expect(orderbook).toHaveBeenCalledTimes(1);

    const [base, counter] = orderbook.mock.calls[0];
    expect(base.getCode()).toBe(ASSET_CODE);
    expect(base.getIssuer()).toBe(ASSET_ISSUER);
    expect(counter.isNative()).toBe(true);
  });

  it("returns the normalised asset descriptor and XLM as the quote asset", async () => {
    mockOrderBook(BOOK);

    const res = await request(app).get(BASE);

    expect(res.body.success).toBe(true);
    expect(res.body.data.asset.code).toBe(ASSET_CODE);
    expect(res.body.data.asset.issuer).toBe(ASSET_ISSUER);
    expect(res.body.data.asset.type).toBe("credit_alphanum4");
    expect(res.body.data.quoteAsset).toBe("XLM");
    expect(res.headers["x-cache"]).toBe("MISS");
  });

  // ── Price computation ──────────────────────────────────────────────────────

  it("computes bid, ask, and mid from the best orders on each side", async () => {
    mockOrderBook(BOOK);

    const res = await request(app).get(BASE);
    const { data } = res.body;

    // Best orders, not the deeper levels
    expect(data.bid).toBe("0.1284000");
    expect(data.ask).toBe("0.1291000");
    // (0.1284 + 0.1291) / 2
    expect(data.mid).toBe("0.1287500");
  });

  it("returns bid, ask, and mid as seven-decimal strings", async () => {
    mockOrderBook({
      bids: [{ price: "0.25", amount: "100" }],
      asks: [{ price: "0.75", amount: "100" }],
    });

    const res = await request(app).get(BASE);
    const { data } = res.body;

    for (const value of [data.bid, data.ask, data.mid]) {
      expect(typeof value).toBe("string");
      expect(value).toMatch(/^\d+\.\d{7}$/);
    }

    expect(data.bid).toBe("0.2500000");
    expect(data.ask).toBe("0.7500000");
    expect(data.mid).toBe("0.5000000");
  });

  it("falls back to the bid price for mid when nobody is asking", async () => {
    mockOrderBook({ bids: [{ price: "0.1284000", amount: "4200" }], asks: [] });

    const res = await request(app).get(BASE);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.ask).toBeNull();
    expect(res.body.data.bid).toBe("0.1284000");
    expect(res.body.data.mid).toBe("0.1284000");
  });

  it("falls back to the ask price for mid when nobody is bidding", async () => {
    mockOrderBook({ bids: [], asks: [{ price: "0.1291000", amount: "3800" }] });

    const res = await request(app).get(BASE);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.bid).toBeNull();
    expect(res.body.data.mid).toBe("0.1291000");
  });

  it("keeps priceInXlm as a mirror of mid for existing callers", async () => {
    mockOrderBook(BOOK);

    const res = await request(app).get(BASE);

    expect(res.body.data.priceInXlm).toBe(res.body.data.mid);
  });

  // ── Caching ────────────────────────────────────────────────────────────────

  it("returns X-Cache: HIT on a second request within the TTL", async () => {
    const { call } = mockOrderBook(BOOK);

    await request(app).get(BASE);
    const res = await request(app).get(BASE);

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-cache"]).toBe("HIT");
    expect(res.body.data.mid).toBe("0.1287500");
    // Second request served from cache — Horizon hit only once
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("bypasses the cache with ?fresh=true", async () => {
    const { call } = mockOrderBook(BOOK);

    await request(app).get(BASE);
    const res = await request(app).get(`${BASE}?fresh=true`);

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-cache"]).toBe("MISS");
    expect(call).toHaveBeenCalledTimes(2);
  });

  // ── OrderBookEmpty ─────────────────────────────────────────────────────────

  it("returns OrderBookEmpty when the pair has no order book", async () => {
    mockOrderBook({ bids: [], asks: [] });

    const res = await request(app).get(BASE);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("OrderBookEmpty");
    expect(res.body.error.message).toContain("No active order book found for USDC/XLM");
    expect(res.body.error.suggestion).toContain("active offers");
  });

  it("returns OrderBookEmpty when Horizon answers 404 for the pair", async () => {
    const err = new Error("Not Found");
    err.response = { status: 404 };
    jest.spyOn(server, "orderbook").mockReturnValue({
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockRejectedValue(err),
    });

    const res = await request(app).get(BASE);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("OrderBookEmpty");
  });

  // ── Validation ─────────────────────────────────────────────────────────────

  it("returns 400 for invalid asset code", async () => {
    const res = await request(app).get(
      `/asset/TOOLONGASSETCODE/${ASSET_ISSUER}/price`
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 for invalid issuer", async () => {
    const res = await request(app).get(`/asset/${ASSET_CODE}/BADISSUER/price`);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
