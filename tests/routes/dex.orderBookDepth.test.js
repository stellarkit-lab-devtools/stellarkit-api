"use strict";

const request = require("supertest");
const app = require("../../src/index");

jest.mock("../../src/config/stellar", () => {
  const actual = jest.requireActual("../../src/config/stellar");
  return {
    ...actual,
    server: {
      orderbook: jest.fn(),
    },
  };
});

const { server } = require("../../src/config/stellar");

const sellAsset = "XLM:native";
const buyAsset = "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const endpoint = `/dex/order-book-depth/${sellAsset}/${buyAsset}`;

function mockOrderBook({ bids = [], asks = [] }) {
  const query = {
    limit: jest.fn(() => query),
    call: jest.fn().mockResolvedValue({ bids, asks }),
  };
  server.orderbook.mockReturnValue(query);
  return query;
}

describe("GET /dex/order-book-depth/:sellAsset/:buyAsset", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("sums three bid levels cumulatively from outermost to innermost", async () => {
    mockOrderBook({
      bids: [
        { price: "0.1300000", amount: "3.0000000" },
        { price: "0.1200000", amount: "5.0000000" },
        { price: "0.1100000", amount: "7.0000000" },
      ],
      asks: [
        { price: "0.1500000", amount: "2.0000000" },
        { price: "0.1600000", amount: "4.0000000" },
      ],
    });

    const response = await request(app).get(endpoint);

    expect(response.statusCode).toBe(200);
    expect(response.body.data.bids.map((level) => level.cumulativeVolume)).toEqual([
      "15.0000000",
      "12.0000000",
      "7.0000000",
    ]);
  });

  it("calculates spread as best ask minus best bid", async () => {
    mockOrderBook({
      bids: [{ price: "0.1300000", amount: "3.0000000" }],
      asks: [{ price: "0.1500000", amount: "2.0000000" }],
    });

    const response = await request(app).get(endpoint);

    expect(response.statusCode).toBe(200);
    expect(response.body.data.spread).toBe("0.0200000");
  });

  it("?depth=5 requests and returns five levels on each side", async () => {
    const query = mockOrderBook({
      bids: Array.from({ length: 5 }, (_, index) => ({
        price: (0.15 - index * 0.01).toFixed(7),
        amount: "1.0000000",
      })),
      asks: Array.from({ length: 5 }, (_, index) => ({
        price: (0.16 + index * 0.01).toFixed(7),
        amount: "1.0000000",
      })),
    });

    const response = await request(app).get(`${endpoint}?depth=5`);

    expect(response.statusCode).toBe(200);
    expect(query.limit).toHaveBeenCalledWith(5);
    expect(response.body.data.bids).toHaveLength(5);
    expect(response.body.data.asks).toHaveLength(5);
  });

  it("returns OrderBookEmpty when there are no orders", async () => {
    mockOrderBook({ bids: [], asks: [] });

    const response = await request(app).get(endpoint);

    expect(response.statusCode).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.type).toBe("OrderBookEmpty");
  });
});
