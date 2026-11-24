"use strict";

/**
 * Tests for GET /soroban/contract/:id/token-info
 *
 * The Soroban RPC is mocked: getContractData confirms existence and
 * simulateTransaction answers name()/symbol()/decimals() per contract.
 *
 * Covers:
 *   - a standard (custom WASM) token
 *   - a Stellar Asset Contract (CODE:ISSUER and native)
 *   - a custom token whose name mimics CODE:ISSUER is not treated as a SAC
 *   - a non-token contract → supportsToken: false with null fields
 *   - a missing contract → 404
 *   - a malformed contract ID → 400
 *   - responses are cached
 */

jest.mock("../src/config/stellar", () => {
  const actual = jest.requireActual("../src/config/stellar");
  return {
    ...actual,
    sorobanServer: {
      getContractData: jest.fn(),
      simulateTransaction: jest.fn(),
    },
  };
});

const request = require("supertest");
const { Asset, Networks, nativeToScVal } = require("@stellar/stellar-sdk");
const app = require("../src/index");
const { sorobanServer, NETWORK } = require("../src/config/stellar");
const cacheService = require("../src/services/cache");

const PASSPHRASE = NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const CUSTOM_TOKEN_ID = "CCJZ5DGASBWQXR5MPFCJXMBI333XE5U3FSJTNQU7RIKE3P5GN2K2WYD2";
const USDC_SAC_ID = new Asset("USDC", ISSUER).contractId(PASSPHRASE);
const NATIVE_SAC_ID = Asset.native().contractId(PASSPHRASE);

function functionNameOf(tx) {
  return tx.operations[0].func.invokeContract().functionName().toString();
}

/**
 * Make simulateTransaction answer from a { fnName: ScVal } map. Functions not
 * in the map produce the RPC's simulation-error shape.
 */
function mockSimulation(responses) {
  sorobanServer.simulateTransaction.mockImplementation(async (tx) => {
    const fn = functionNameOf(tx);
    if (!(fn in responses)) {
      return {
        error: "HostError: Error(WasmVm, MissingValue) — trying to invoke non-existent contract function",
        latestLedger: 100,
      };
    }
    return { result: { retval: responses[fn], auth: [] }, latestLedger: 100 };
  });
}

function tokenResponses(name, symbol, decimals) {
  return {
    name: nativeToScVal(name, { type: "string" }),
    symbol: nativeToScVal(symbol, { type: "string" }),
    decimals: nativeToScVal(decimals, { type: "u32" }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  cacheService.flush();
  sorobanServer.getContractData.mockResolvedValue({ key: {}, val: {} });
});

describe("GET /soroban/contract/:id/token-info", () => {
  it("returns metadata for a standard token", async () => {
    mockSimulation(tokenResponses("Example Token", "EXT", 7));

    const res = await request(app).get(`/soroban/contract/${CUSTOM_TOKEN_ID}/token-info`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({
      contractId: CUSTOM_TOKEN_ID,
      name: "Example Token",
      symbol: "EXT",
      decimals: 7,
      supportsToken: true,
      isStellarAsset: false,
      asset: null,
    });
    expect(sorobanServer.simulateTransaction).toHaveBeenCalledTimes(3);
  });

  it("simulates with a placeholder source account at sequence 0", async () => {
    mockSimulation(tokenResponses("Example Token", "EXT", 7));
    await request(app).get(`/soroban/contract/${CUSTOM_TOKEN_ID}/token-info`);

    const tx = sorobanServer.simulateTransaction.mock.calls[0][0];
    // TransactionBuilder increments the source sequence by one when building.
    expect(tx.sequence).toBe("1");
    const fns = sorobanServer.simulateTransaction.mock.calls.map(([t]) => functionNameOf(t));
    expect(fns.sort()).toEqual(["decimals", "name", "symbol"]);
  });

  it("detects a Stellar Asset Contract and parses its asset", async () => {
    mockSimulation(tokenResponses(`USDC:${ISSUER}`, "USDC", 7));

    const res = await request(app).get(`/soroban/contract/${USDC_SAC_ID}/token-info`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({
      contractId: USDC_SAC_ID,
      name: `USDC:${ISSUER}`,
      symbol: "USDC",
      decimals: 7,
      supportsToken: true,
      isStellarAsset: true,
      asset: { code: "USDC", issuer: ISSUER, type: "credit_alphanum4" },
    });
  });

  it("detects the native Stellar Asset Contract", async () => {
    mockSimulation(tokenResponses("native", "native", 7));

    const res = await request(app).get(`/soroban/contract/${NATIVE_SAC_ID}/token-info`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.isStellarAsset).toBe(true);
    expect(res.body.data.asset).toEqual({ code: "XLM", issuer: null, type: "native" });
  });

  it("does not treat a custom token named CODE:ISSUER as a Stellar asset", async () => {
    mockSimulation(tokenResponses(`USDC:${ISSUER}`, "USDC", 7));

    const res = await request(app).get(`/soroban/contract/${CUSTOM_TOKEN_ID}/token-info`);

    expect(res.body.data.supportsToken).toBe(true);
    expect(res.body.data.isStellarAsset).toBe(false);
    expect(res.body.data.asset).toBeNull();
  });

  it("returns supportsToken: false with null fields for a non-token contract", async () => {
    mockSimulation({});

    const res = await request(app).get(`/soroban/contract/${CUSTOM_TOKEN_ID}/token-info`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({
      contractId: CUSTOM_TOKEN_ID,
      name: null,
      symbol: null,
      decimals: null,
      supportsToken: false,
      isStellarAsset: false,
      asset: null,
    });
  });

  it("returns null fields when only some token functions exist", async () => {
    mockSimulation({ name: nativeToScVal("Half Token", { type: "string" }) });

    const res = await request(app).get(`/soroban/contract/${CUSTOM_TOKEN_ID}/token-info`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.supportsToken).toBe(false);
    expect(res.body.data.name).toBeNull();
  });

  it("returns 404 for a missing contract", async () => {
    sorobanServer.getContractData.mockRejectedValue(
      new Error(`Contract data not found. Contract: ${CUSTOM_TOKEN_ID}`)
    );

    const res = await request(app).get(`/soroban/contract/${CUSTOM_TOKEN_ID}/token-info`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(sorobanServer.simulateTransaction).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed contract ID", async () => {
    const res = await request(app).get("/soroban/contract/NOT-A-CONTRACT/token-info");

    expect(res.statusCode).toBe(400);
    expect(sorobanServer.getContractData).not.toHaveBeenCalled();
  });

  it("caches the response", async () => {
    mockSimulation(tokenResponses("Example Token", "EXT", 7));

    const first = await request(app).get(`/soroban/contract/${CUSTOM_TOKEN_ID}/token-info`);
    const second = await request(app).get(`/soroban/contract/${CUSTOM_TOKEN_ID}/token-info`);

    expect(first.headers["x-cache"]).toBe("MISS");
    expect(second.headers["x-cache"]).toBe("HIT");
    expect(second.body.data).toEqual(first.body.data);
    expect(sorobanServer.simulateTransaction).toHaveBeenCalledTimes(3);
  });
});
