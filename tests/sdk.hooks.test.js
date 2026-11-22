"use strict";

// Transpile the SDK source directly: Jest in this repo has no TypeScript
// transformer configured, while the SDK itself is TypeScript.
const fs = require("fs");
const path = require("path");
const Module = require("module");
const ts = require("typescript");
const sdkPath = path.join(__dirname, "../sdk/stellarkit-client.ts");
const compiled = ts.transpileModule(fs.readFileSync(sdkPath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const sdkModule = new Module(sdkPath);
sdkModule.filename = sdkPath;
sdkModule.paths = Module._nodeModulePaths(path.dirname(sdkPath));
sdkModule._compile(compiled, sdkPath);
const StellarKitClient = sdkModule.exports;

const nodeGlobal = require("vm").runInThisContext("globalThis");
nodeGlobal.fetch = jest.fn();

function mockFetch(status, body) {
  nodeGlobal.fetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
  });
}

describe("StellarKitClient hooks", () => {
  const BASE_URL = "http://localhost:3000";

  beforeEach(() => jest.clearAllMocks());

  it("runs onRequest then onResponse in registration order", async () => {
    const calls = [];
    const client = new StellarKitClient({
      baseUrl: BASE_URL,
      hooks: {
        onRequest: [
          () => calls.push("request-1"),
          () => calls.push("request-2"),
        ],
        onResponse: [
          () => calls.push("response-1"),
          () => calls.push("response-2"),
        ],
      },
    });
    mockFetch(200, { success: true, data: { status: "ok" } });
    expect(await client.getHealth()).toEqual({ status: "ok" });
    expect(calls).toEqual(["request-1", "request-2", "response-1", "response-2"]);
  });

  it("onRequest can mutate headers (trace header)", async () => {
    const client = new StellarKitClient({
      baseUrl: BASE_URL,
      hooks: { onRequest: ({ headers }) => { headers["x-trace-id"] = "trace-123"; } },
    });
    mockFetch(200, { success: true, data: {} });
    await client.getHealth();
    const headers = nodeGlobal.fetch.mock.calls[0][1].headers;
    expect(headers["x-trace-id"]).toBe("trace-123");
  });

  it("onResponse receives url, method, status and durationMs", async () => {
    let info;
    const client = new StellarKitClient({
      baseUrl: BASE_URL,
      hooks: { onResponse: (value) => { info = value; } },
    });
    mockFetch(200, { success: true, data: {} });
    await client.getAccount("GABC");
    expect(info.url).toContain("/account/GABC");
    expect(info.method).toBe("GET");
    expect(info.status).toBe(200);
    expect(typeof info.durationMs).toBe("number");
    expect(Number.isFinite(info.durationMs)).toBe(true);
  });

  it("a throwing hook never fails the call and is reported to onHookError", async () => {
    const onHookError = jest.fn();
    const onResponse = jest.fn();
    const client = new StellarKitClient({
      baseUrl: BASE_URL,
      hooks: {
        onRequest: [() => { throw new Error("boom"); }, () => onResponse()],
      },
      onHookError,
    });
    mockFetch(200, { success: true, data: { ok: true } });
    await expect(client.getHealth()).resolves.toEqual({ ok: true });
    expect(onHookError).toHaveBeenCalledWith(expect.any(Error), "onRequest");
    expect(onResponse).toHaveBeenCalledTimes(1);
  });

  it("onError receives the typed StellarKitError", async () => {
    let received;
    const client = new StellarKitClient({
      baseUrl: BASE_URL,
      hooks: { onError: (error) => { received = error; } },
    });
    mockFetch(404, { success: false, error: { message: "Account not found", type: "NotFound" } });
    await expect(client.getAccount("GABC")).rejects.toThrow("Account not found");
    expect(received.name).toBe("StellarKitError");
    expect(received.status).toBe(404);
    expect(received.type).toBe("NotFound");
  });
});
