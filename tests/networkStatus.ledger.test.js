"use strict";

const request = require("supertest");
const app = require("../src/index");
const cacheService = require("../src/services/cache");

jest.mock("../src/config/stellar", () => {
  const actual = jest.requireActual("../src/config/stellar");
  return {
    ...actual,
    server: {
      ledgers: jest.fn(),
    },
  };
});

const { server } = require("../src/config/stellar");

const LEDGER = {
  sequence: "12345",
  hash: "ledger-hash",
  prev_hash: "previous-hash",
  closed_at: "2024-01-15T12:00:00Z",
  protocol_version: 20,
  successful_transaction_count: 7,
  failed_transaction_count: 2,
  operation_count: 15,
  base_fee_in_stroops: "100",
  base_reserve_in_stroops: "5000000",
  max_tx_set_size: 1000,
};

function mockLedgerCall(response) {
  const query = {
    ledger: jest.fn(() => query),
    call: jest.fn().mockResolvedValue(response),
  };
  server.ledgers.mockReturnValue(query);
  return query;
}

describe("GET /network-status/:sequence", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  it("returns a normalized ledger record", async () => {
    const query = mockLedgerCall(LEDGER);

    const response = await request(app).get("/network-status/12345");

    expect(response.statusCode).toBe(200);
    expect(response.body.data).toEqual({
      sequence: 12345,
      hash: "ledger-hash",
      previousHash: "previous-hash",
      closedAt: "2024-01-15T12:00:00.000Z",
      protocolVersion: 20,
      successfulTransactionCount: 7,
      failedTransactionCount: 2,
      operationCount: 15,
      baseFeeStroops: 100,
      baseReserveXLM: "0.5000000",
      maxTxSetSize: 1000,
    });
    expect(query.ledger).toHaveBeenCalledWith(12345);
    expect(response.headers["x-cache"]).toBe("MISS");
  });

  it.each(["abc", "0", "-1"])("rejects invalid sequence %s", async (sequence) => {
    const response = await request(app).get(`/network-status/${sequence}`);

    expect(response.statusCode).toBe(400);
    expect(response.body.error.type).toBe("ValidationError");
    expect(server.ledgers).not.toHaveBeenCalled();
  });

  it("returns 404 when Horizon cannot find the requested ledger", async () => {
    const error = new Error("Not found");
    error.response = { status: 404 };
    const query = {
      ledger: jest.fn(() => query),
      call: jest.fn().mockRejectedValue(error),
    };
    server.ledgers.mockReturnValue(query);

    const response = await request(app).get("/network-status/999999999");

    expect(response.statusCode).toBe(404);
    expect(response.body.error.type).toBe("LedgerNotFound");
  });

  it("serves subsequent requests from cache for one hour", async () => {
    mockLedgerCall(LEDGER);
    const setSpy = jest.spyOn(cacheService, "set");

    const firstResponse = await request(app).get("/network-status/12345");
    const secondResponse = await request(app).get("/network-status/12345");

    expect(firstResponse.headers["x-cache"]).toBe("MISS");
    expect(secondResponse.headers["x-cache"]).toBe("HIT");
    expect(server.ledgers).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith(
      "ledger:12345",
      expect.objectContaining({ sequence: 12345 }),
      60 * 60,
    );
    expect(cacheService.get("ledger:12345")).toEqual(firstResponse.body.data);
  });
});
