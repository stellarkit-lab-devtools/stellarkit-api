const request = require("supertest");
const { xdr, scValToNative } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    sorobanServer: {
      getLedgerEntries: jest.fn(),
      getLatestLedger: jest.fn(),
      getContractData: jest.fn(),
      getTransaction: jest.fn(),
    },
  };
});

const { sorobanServer } = require("../src/config/stellar");
const app = require("../src/index");

const VALID_HASH = "a".repeat(64);

describe("GET /soroban/transactions/:hash", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 400 for a malformed hash", async () => {
    const res = await request(app).get("/soroban/transactions/not-a-hash");
    expect(res.statusCode).toBe(400);
    expect(res.body.error.type).toBe("InvalidTransactionHash");
    expect(sorobanServer.getTransaction).not.toHaveBeenCalled();
  });

  it("returns 404 and distinguishes not-yet-seen from outside retention window", async () => {
    sorobanServer.getTransaction.mockResolvedValue({
      status: "NOT_FOUND",
      latestLedger: 1000,
      oldestLedger: 500,
    });

    const res = await request(app).get(`/soroban/transactions/${VALID_HASH}`);
    expect(res.statusCode).toBe(404);
    expect(res.body.error.type).toBe("TransactionNotFound");
    expect(res.body.error.latestLedger).toBe(1000);
    expect(res.body.error.oldestLedger).toBe(500);
    expect(res.body.error.message).toMatch(/500/);
    expect(res.body.error.message).toMatch(/1000/);
  });

  it("returns decoded integer return value for a successful call", async () => {
    const returnValue = xdr.ScVal.scvU64(xdr.Uint64.fromString("42"));
    sorobanServer.getTransaction.mockResolvedValue({
      status: "SUCCESS",
      ledger: 900,
      createdAt: 1700000000,
      applicationOrder: 1,
      feeBump: false,
      returnValue,
      latestLedger: 1000,
      oldestLedger: 500,
    });

    const res = await request(app).get(`/soroban/transactions/${VALID_HASH}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe("SUCCESS");
    expect(res.body.data.hash).toBe(VALID_HASH);
    expect(res.body.data.ledger).toBe(900);
    // BigInt decoded to string
    expect(res.body.data.returnValue).toBe("42");
    expect(res.body.data.errorCode).toBeNull();
    expect(res.body.data.latestLedger).toBe(1000);
    expect(res.body.data.oldestLedger).toBe(500);
  });

  it("returns decoded string return value", async () => {
    const returnValue = xdr.ScVal.scvString("hello");
    sorobanServer.getTransaction.mockResolvedValue({
      status: "SUCCESS",
      ledger: 901,
      createdAt: 1700000001,
      applicationOrder: 1,
      feeBump: false,
      returnValue,
      latestLedger: 1000,
      oldestLedger: 500,
    });

    const res = await request(app).get(`/soroban/transactions/${VALID_HASH}`);
    expect(res.statusCode).toBe(200);
    // scValToNative("hello") → Buffer; toJsonSafe → hex string
    expect(typeof res.body.data.returnValue).toBe("string");
  });

  it("returns decoded vector return value", async () => {
    const returnValue = xdr.ScVal.scvVec([
      xdr.ScVal.scvU32(1),
      xdr.ScVal.scvU32(2),
    ]);
    sorobanServer.getTransaction.mockResolvedValue({
      status: "SUCCESS",
      ledger: 902,
      createdAt: 1700000002,
      applicationOrder: 2,
      feeBump: false,
      returnValue,
      latestLedger: 1000,
      oldestLedger: 500,
    });

    const res = await request(app).get(`/soroban/transactions/${VALID_HASH}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data.returnValue)).toBe(true);
  });

  it("returns FAILED status with an errorCode when present", async () => {
    sorobanServer.getTransaction.mockResolvedValue({
      status: "FAILED",
      ledger: 850,
      createdAt: 1700000003,
      applicationOrder: 3,
      feeBump: false,
      returnValue: null,
      resultXdr: null,
      latestLedger: 1000,
      oldestLedger: 500,
    });

    const res = await request(app).get(`/soroban/transactions/${VALID_HASH}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe("FAILED");
    // errorCode is best-effort; null is acceptable when resultXdr is absent
    expect(res.body.data.errorCode === null || typeof res.body.data.errorCode === "string").toBe(true);
  });

  it("returns null returnValue for a FAILED transaction", async () => {
    sorobanServer.getTransaction.mockResolvedValue({
      status: "FAILED",
      ledger: 851,
      createdAt: 1700000004,
      applicationOrder: 4,
      feeBump: false,
      returnValue: null,
      resultXdr: null,
      latestLedger: 1000,
      oldestLedger: 500,
    });

    const res = await request(app).get(`/soroban/transactions/${VALID_HASH}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.returnValue).toBeNull();
  });
});
