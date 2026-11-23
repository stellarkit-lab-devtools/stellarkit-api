"use strict";

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

function loadTypeScript(filePath) {
  const filename = path.resolve(__dirname, filePath);
  const cached = loadTypeScript.cache.get(filename);
  if (cached) return cached.exports;

  const loadedModule = { exports: {} };
  loadTypeScript.cache.set(filename, loadedModule);
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const localRequire = (request) => {
    if (request.startsWith(".")) {
      const target = path.resolve(path.dirname(filename), request);
      if (fs.existsSync(`${target}.ts`)) return loadTypeScript(`${target}.ts`);
    }
    return require(request);
  };
  new Function("require", "module", "exports", compiled)(
    localRequire,
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}
loadTypeScript.cache = new Map();

const { StellarKit } = loadTypeScript("../sdk/stellarkit-client.ts");
const {
  StellarKitConfigurationError,
  StellarKitNetworkError,
} = loadTypeScript("../sdk/http.ts");

describe("SDK custom fetch", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it("uses the injected fetch with the requested URL and headers", async () => {
    const fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ data: { status: "ok" } }),
    });
    const client = new StellarKit({
      baseUrl: "https://api.example.com/",
      apiKey: "test-key",
      fetch,
    });

    await client.getHealth();

    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.com/health",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-api-key": "test-key",
        }),
      }),
    );
  });

  it("throws a typed configuration error when global fetch is unavailable", () => {
    globalThis.fetch = undefined;

    expect(() => new StellarKit({ baseUrl: "https://api.example.com" }))
      .toThrow(StellarKitConfigurationError);
    expect(() => new StellarKit({ baseUrl: "https://api.example.com" }))
      .toThrow(/pass one with the fetch option/i);
  });

  it("maps rejected injected fetch calls to the typed network error", async () => {
    const fetch = jest.fn().mockRejectedValue(new Error("connection refused"));
    const client = new StellarKit({
      baseUrl: "https://api.example.com",
      fetch,
    });

    await expect(client.getHealth()).rejects.toMatchObject({
      name: "StellarKitNetworkError",
      type: "NetworkError",
      message: "Network request failed: connection refused",
    });
    await expect(client.getHealth()).rejects.toBeInstanceOf(StellarKitNetworkError);
  });
});
