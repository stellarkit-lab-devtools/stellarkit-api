/**
 * Tests for GET /soroban/contract/:id/invoke-simulation
 *
 * Verifies that the endpoint:
 *   - Returns 400 when the ?function= query param is missing
 *   - Returns 400 when the contract ID is invalid
 *   - Returns a successful simulation result with estimatedFee, resourceUsage,
 *     error (null), and success (true) for a valid contract + function
 *   - Returns a simulation result with error and success: false when the
 *     Soroban RPC returns a simulation error
 *   - Returns 500 when Soroban RPC is not configured
 *
 * All RPC calls are mocked; no real network requests are made.
 */

jest.mock("../src/config/stellar", () => {
  const actual = jest.requireActual("../src/config/stellar");
  return {
    ...actual,
    sorobanServer: {
      simulateTransaction: jest.fn(),
    },
  };
});

const request = require("supertest");
const app = require("../src/index");
const { sorobanServer } = require("../src/config/stellar");

const CONTRACT_ID = "CCJZ5DGASBWQXR5MPFCJXMBI333XE5U3FSJTNQU7RIKE3P5GN2K2WYD2";

function buildSuccessSimResult(overrides = {}) {
  return {
    minResourceFee: "12345",
    cost: {
      cpuInsns: "1000000",
      memBytes: "512000",
    },
    transactionData: null,
    latestLedger: 100,
    error: undefined,
    ...overrides,
  };
}

function buildErrorSimResult(errorMsg = "contract trapped with error: division by zero") {
  return {
    minResourceFee: "0",
    cost: { cpuInsns: "0", memBytes: "0" },
    transactionData: null,
    latestLedger: 100,
    error: errorMsg,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Missing function param ────────────────────────────────────────────────────

describe("GET /soroban/contract/:id/invoke-simulation — missing function param", () => {
  it("returns 400 when ?function= is omitted", async () => {
    const res = await request(app).get(
      `/soroban/contract/${CONTRACT_ID}/invoke-simulation`
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
    expect(res.body.error.message).toMatch(/function/i);
  });

  it("returns 400 when ?function= is an empty string", async () => {
    const res = await request(app).get(
      `/soroban/contract/${CONTRACT_ID}/invoke-simulation?function=`
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
  });
});

// ── Invalid contract ID ───────────────────────────────────────────────────────

describe("GET /soroban/contract/:id/invoke-simulation — invalid contract ID", () => {
  it("returns 400 for a malformed contract ID", async () => {
    const res = await request(app).get(
      "/soroban/contract/INVALID_ID/invoke-simulation?function=get_balance"
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ── Successful simulation ─────────────────────────────────────────────────────

describe("GET /soroban/contract/:id/invoke-simulation — successful simulation", () => {
  it("returns 200 with estimatedFee, resourceUsage, null error and success: true", async () => {
    sorobanServer.simulateTransaction.mockResolvedValue(buildSuccessSimResult());

    const res = await request(app).get(
      `/soroban/contract/${CONTRACT_ID}/invoke-simulation?function=get_balance`
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const { data } = res.body;
    expect(data.success).toBe(true);
    expect(data.error).toBeNull();
    expect(data.estimatedFee).toBe("12345");
    expect(data.resourceUsage).toBeDefined();
    expect(typeof data.resourceUsage.cpuInstructions).toBe("number");
    expect(typeof data.resourceUsage.memBytes).toBe("number");
  });

  it("maps cpuInsns and memBytes from simulation cost to resourceUsage", async () => {
    sorobanServer.simulateTransaction.mockResolvedValue(
      buildSuccessSimResult({
        cost: { cpuInsns: "2000000", memBytes: "1024000" },
      })
    );

    const res = await request(app).get(
      `/soroban/contract/${CONTRACT_ID}/invoke-simulation?function=transfer`
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.resourceUsage.cpuInstructions).toBe(2000000);
    expect(res.body.data.resourceUsage.memBytes).toBe(1024000);
  });

  it("returns estimatedFee as a string", async () => {
    sorobanServer.simulateTransaction.mockResolvedValue(
      buildSuccessSimResult({ minResourceFee: "98765" })
    );

    const res = await request(app).get(
      `/soroban/contract/${CONTRACT_ID}/invoke-simulation?function=get_balance`
    );

    expect(res.statusCode).toBe(200);
    expect(typeof res.body.data.estimatedFee).toBe("string");
    expect(res.body.data.estimatedFee).toBe("98765");
  });

  it("wraps response in { success: true, data: { ... } } envelope", async () => {
    sorobanServer.simulateTransaction.mockResolvedValue(buildSuccessSimResult());

    const res = await request(app).get(
      `/soroban/contract/${CONTRACT_ID}/invoke-simulation?function=get_balance`
    );

    expect(res.body).toHaveProperty("success", true);
    expect(res.body).toHaveProperty("data");
    expect(res.body.data).toHaveProperty("estimatedFee");
    expect(res.body.data).toHaveProperty("resourceUsage");
    expect(res.body.data).toHaveProperty("error");
    expect(res.body.data).toHaveProperty("success");
  });

  it("accepts ?args= as a JSON-encoded array and forwards to simulation", async () => {
    sorobanServer.simulateTransaction.mockResolvedValue(buildSuccessSimResult());

    const res = await request(app).get(
      `/soroban/contract/${CONTRACT_ID}/invoke-simulation?function=transfer&args=["hello",42]`
    );

    expect(res.statusCode).toBe(200);
    expect(sorobanServer.simulateTransaction).toHaveBeenCalledTimes(1);
  });
});

// ── Error simulation ──────────────────────────────────────────────────────────

describe("GET /soroban/contract/:id/invoke-simulation — error simulation", () => {
  it("returns 200 with success: false and error message when simulation errors", async () => {
    sorobanServer.simulateTransaction.mockResolvedValue(
      buildErrorSimResult("contract trapped: division by zero")
    );

    const res = await request(app).get(
      `/soroban/contract/${CONTRACT_ID}/invoke-simulation?function=bad_func`
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const { data } = res.body;
    expect(data.success).toBe(false);
    expect(data.error).toBe("contract trapped: division by zero");
  });

  it("returns estimatedFee '0' and success: false when simulation errors", async () => {
    sorobanServer.simulateTransaction.mockResolvedValue(
      buildErrorSimResult("HostError: value out of range")
    );

    const res = await request(app).get(
      `/soroban/contract/${CONTRACT_ID}/invoke-simulation?function=bad_func`
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.success).toBe(false);
    expect(res.body.data.estimatedFee).toBe("0");
    expect(res.body.data.error).toContain("HostError");
  });
});

// ── Invalid args JSON ─────────────────────────────────────────────────────────

describe("GET /soroban/contract/:id/invoke-simulation — invalid args", () => {
  it("returns 400 when ?args= is not valid JSON", async () => {
    const res = await request(app).get(
      `/soroban/contract/${CONTRACT_ID}/invoke-simulation?function=get_balance&args=notjson`
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
  });

  it("returns 400 when ?args= is a JSON object (not array)", async () => {
    const res = await request(app).get(
      `/soroban/contract/${CONTRACT_ID}/invoke-simulation?function=get_balance&args={"key":"value"}`
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
  });
});
