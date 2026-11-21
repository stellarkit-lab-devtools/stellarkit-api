"use strict";

/**
 * Tests for sdk/utils.ts — UtilsModule.
 *
 * The repository does not use ts-jest, so the real TypeScript source is
 * transpiled with the `typescript` compiler and executed with a mocked global
 * fetch. This exercises the shipped module rather than a hand-written stub.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

function loadUtilsModule() {
  const source = fs.readFileSync(path.join(__dirname, "../sdk/utils.ts"), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function("module", "exports", "require", "process", js)(
    module,
    module.exports,
    require,
    process,
  );
  return module.exports;
}

const UtilsModule = loadUtilsModule();

function mockFetch(body, ok = true, status = 200) {
  global.fetch = jest.fn(async () => ({
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => body,
  }));
}

describe("UtilsModule", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete global.fetch;
  });

  it("convert() returns XLM/stroops interfaces", async () => {
    mockFetch({ success: true, data: { xlm: "1.0000000", stroops: 10000000 } });
    const utils = new UtilsModule({ baseUrl: "http://api.test/" });
    expect(await utils.convert({ stroops: 10000000 })).toEqual({
      xlm: "1.0000000",
      stroops: 10000000,
    });
    expect(global.fetch.mock.calls[0][0]).toBe(
      "http://api.test/utils/convert?stroops=10000000",
    );
  });

  it("validateAccount() calls /utils/validate-account with id", async () => {
    mockFetch({ data: { input: "GABC", isValid: false, reason: "bad" } });
    const utils = new UtilsModule({ baseUrl: "http://api.test" });
    expect(await utils.validateAccount("GABC")).toEqual({
      input: "GABC",
      isValid: false,
      reason: "bad",
    });
    expect(global.fetch.mock.calls[0][0]).toBe(
      "http://api.test/utils/validate-account?id=GABC",
    );
  });

  it("validateAsset() calls /utils/validate-asset", async () => {
    mockFetch({ data: { input: "USDC", isValid: true, assetType: "credit_alphanum4" } });
    const utils = new UtilsModule({ baseUrl: "http://api.test" });
    const result = await utils.validateAsset("USDC");
    expect(result.isValid).toBe(true);
    expect(result.assetType).toBe("credit_alphanum4");
    expect(global.fetch.mock.calls[0][0]).toBe(
      "http://api.test/utils/validate-asset?code=USDC",
    );
  });

  it("ledgerDate() calls /utils/ledger-date", async () => {
    mockFetch({ data: { sequence: 42, estimatedDate: "2024-01-01T00:00:00.000Z", note: "approx" } });
    const utils = new UtilsModule({ baseUrl: "http://api.test" });
    const result = await utils.ledgerDate(42);
    expect(result.sequence).toBe(42);
    expect(global.fetch.mock.calls[0][0]).toBe(
      "http://api.test/utils/ledger-date?sequence=42",
    );
  });

  it("decodeXdr() POSTs the xdr envelope", async () => {
    mockFetch({ data: { operations: [{ type: "payment" }] } });
    const utils = new UtilsModule({ baseUrl: "http://api.test" });
    const result = await utils.decodeXdr("AAAA");
    expect(result.operations).toHaveLength(1);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("http://api.test/utils/decode-xdr");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ xdr: "AAAA" });
  });

  it("fundTestnetAccount() calls Friendbot on testnet", async () => {
    mockFetch({ data: { accountId: "GABC", message: "funded", transaction: {} } });
    const utils = new UtilsModule({ baseUrl: "http://api.test", network: "testnet" });
    expect((await utils.fundTestnetAccount("GABC")).accountId).toBe("GABC");
    expect(global.fetch.mock.calls[0][0]).toBe(
      "http://api.test/utils/friendbot/GABC",
    );
  });

  it("fundTestnetAccount() throws a typed error on mainnet", async () => {
    mockFetch({ data: {} });
    const utils = new UtilsModule({ baseUrl: "http://api.test", network: "mainnet" });
    await expect(utils.fundTestnetAccount("GABC")).rejects.toMatchObject({
      name: "MainnetNotSupportedError",
      type: "MainnetNotSupported",
      status: 403,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("throws StellarKitError on non-2xx responses", async () => {
    mockFetch({ error: { message: "bad asset", type: "ValidationError" } }, false, 400);
    const utils = new UtilsModule({ baseUrl: "http://api.test" });
    await expect(utils.validateAsset("!!!")).rejects.toMatchObject({
      name: "StellarKitError",
      message: "bad asset",
      status: 400,
      type: "ValidationError",
    });
  });

  it("does not expose a generateKeypair() method", () => {
    const utils = new UtilsModule({ baseUrl: "http://api.test" });
    expect(utils.generateKeypair).toBeUndefined();
  });
});
