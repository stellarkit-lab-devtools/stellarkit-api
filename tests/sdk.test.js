"use strict";

const StellarKitClient = require("../sdk/stellarkit-client");

// Mock global fetch
global.fetch = jest.fn();

function mockFetch(status, body) {
  global.fetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
  });
}

describe("StellarKitClient", () => {
  const BASE_URL = "http://localhost:3000";
  let client;

  beforeEach(() => {
    client = new StellarKitClient({ baseUrl: BASE_URL });
    jest.clearAllMocks();
  });

  describe("Constructor", () => {
    it("throws if baseUrl is missing", () => {
      expect(() => new StellarKitClient({})).toThrow("baseUrl is required");
    });

    it("strips trailing slash from baseUrl", () => {
      const c = new StellarKitClient({ baseUrl: "http://localhost:3000/" });
      expect(c.baseUrl).toBe("http://localhost:3000");
    });

    it("stores apiKey when provided", () => {
      const c = new StellarKitClient({ baseUrl: BASE_URL, apiKey: "secret" });
      expect(c.apiKey).toBe("secret");
    });
  });

  describe("Error handling", () => {
    it("throws StellarKitError on non-200 response", async () => {
      mockFetch(404, { success: false, error: { message: "Account not found" } });
      await expect(client.getAccount("GABC")).rejects.toThrow();
    });

    it("StellarKitError has correct status and message", async () => {
      mockFetch(404, { success: false, error: { message: "Account not found" } });
      try {
        await client.getAccount("GABC");
      } catch (err) {
        expect(err.name).toBe("StellarKitError");
        expect(err.status).toBe(404);
        expect(err.message).toBe("Account not found");
      }
    });
  });

  describe("API key header", () => {
    it("sends x-api-key header when apiKey is set", async () => {
      const c = new StellarKitClient({ baseUrl: BASE_URL, apiKey: "test-key" });
      mockFetch(200, { success: true, data: { status: "ok" } });
      await c.getHealth();
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ "x-api-key": "test-key" }),
        })
      );
    });

    it("omits x-api-key header when no apiKey", async () => {
      mockFetch(200, { success: true, data: { status: "ok" } });
      await client.getHealth();
      const headers = global.fetch.mock.calls[0][1].headers;
      expect(headers["x-api-key"]).toBeUndefined();
    });
  });

  describe("getHealth", () => {
    it("resolves to data field", async () => {
      mockFetch(200, { success: true, data: { status: "ok", service: "StellarKit API" } });
      const result = await client.getHealth();
      expect(result).toEqual({ status: "ok", service: "StellarKit API" });
      expect(global.fetch).toHaveBeenCalledWith(`${BASE_URL}/health`, expect.any(Object));
    });
  });

  describe("getNetworkStatus", () => {
    it("calls /network-status", async () => {
      mockFetch(200, { success: true, data: { network: "testnet" } });
      const result = await client.getNetworkStatus();
      expect(result.network).toBe("testnet");
      expect(global.fetch).toHaveBeenCalledWith(`${BASE_URL}/network-status`, expect.any(Object));
    });
  });

  describe("getFeeEstimate", () => {
    it("calls /fee-estimate without operations", async () => {
      mockFetch(200, { success: true, data: { operationCount: 1 } });
      await client.getFeeEstimate();
      expect(global.fetch).toHaveBeenCalledWith(`${BASE_URL}/fee-estimate?operations=1`, expect.any(Object));
    });

    it("calls /fee-estimate with operations param", async () => {
      mockFetch(200, { success: true, data: { operationCount: 3 } });
      await client.getFeeEstimate(3);
      expect(global.fetch).toHaveBeenCalledWith(`${BASE_URL}/fee-estimate?operations=3`, expect.any(Object));
    });
  });

  describe("getAccount", () => {
    it("calls /account/:id", async () => {
      const id = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
      mockFetch(200, { success: true, data: { accountId: id } });
      const result = await client.getAccount(id);
      expect(result.accountId).toBe(id);
      expect(global.fetch).toHaveBeenCalledWith(`${BASE_URL}/account/${id}`, expect.any(Object));
    });
  });

  describe("getAccountAge", () => {
    it("calls /account/:id/age", async () => {
      const id = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
      mockFetch(200, { success: true, data: { ageInDays: 100 } });
      const result = await client.getAccountAge(id);
      expect(result.ageInDays).toBe(100);
      expect(global.fetch).toHaveBeenCalledWith(`${BASE_URL}/account/${id}/age`, expect.any(Object));
    });
  });

  describe("getAccountXlmEquivalentBalances", () => {
    it("calls /account/:id/balances/xlm-equivalent", async () => {
      const id = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
      mockFetch(200, { success: true, data: { totalXlmEquivalent: "100" } });
      const result = await client.getAccountXlmEquivalentBalances(id);
      expect(result.totalXlmEquivalent).toBe("100");
      expect(global.fetch).toHaveBeenCalledWith(`${BASE_URL}/account/${id}/balances/xlm-equivalent`, expect.any(Object));
    });
  });

  describe("getAccountRiskScore", () => {
    it("calls /account/:id/risk-score", async () => {
      const id = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
      mockFetch(200, { success: true, data: { score: 80 } });
      const result = await client.getAccountRiskScore(id);
      expect(result.score).toBe(80);
      expect(global.fetch).toHaveBeenCalledWith(`${BASE_URL}/account/${id}/risk-score`, expect.any(Object));
    });
  });

  describe("getAccountTrustlineHealth", () => {
    it("calls /account/:id/trustline-health", async () => {
      const id = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
      mockFetch(200, { success: true, data: { trustlineCount: 2 } });
      const result = await client.getAccountTrustlineHealth(id);
      expect(result.trustlineCount).toBe(2);
      expect(global.fetch).toHaveBeenCalledWith(`${BASE_URL}/account/${id}/trustline-health`, expect.any(Object));
    });
  });

  describe("getAccountVolume", () => {
    it("calls /account/:id/volume with default days", async () => {
      const id = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
      mockFetch(200, { success: true, data: { totalTransactions: 10 } });
      const result = await client.getAccountVolume(id);
      expect(result.totalTransactions).toBe(10);
      expect(global.fetch).toHaveBeenCalledWith(`${BASE_URL}/account/${id}/volume?days=30`, expect.any(Object));
    });

    it("calls /account/:id/volume with custom days", async () => {
      const id = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
      mockFetch(200, { success: true, data: { totalTransactions: 5 } });
      await client.getAccountVolume(id, 7);
      expect(global.fetch).toHaveBeenCalledWith(`${BASE_URL}/account/${id}/volume?days=7`, expect.any(Object));
    });
  });

  describe("getTransactionHistory", () => {
    it("calls /transactions/:id with pagination params", async () => {
      const id = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
      mockFetch(200, { success: true, data: [] });
      await client.getTransactionHistory(id, { limit: 5, order: "asc" });
      expect(global.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/transactions/${id}?limit=5&order=asc`,
        expect.any(Object)
      );
    });
  });

  describe("getAsset", () => {
    it("calls /asset/:code/:issuer", async () => {
      mockFetch(200, { success: true, data: { code: "USDC" } });
      await client.getAsset("USDC", "GA5Z");
      expect(global.fetch).toHaveBeenCalledWith(`${BASE_URL}/asset/USDC/GA5Z`, expect.any(Object));
    });
  });

  describe("searchAssets", () => {
    it("calls /asset/search?code=:code", async () => {
      mockFetch(200, { success: true, data: [] });
      await client.searchAssets("USDC");
      expect(global.fetch).toHaveBeenCalledWith(`${BASE_URL}/asset/search?code=USDC&limit=10`, expect.any(Object));
    });
  });
});
