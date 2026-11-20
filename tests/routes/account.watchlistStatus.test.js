"use strict";

const request = require("supertest");

const originalFetch = global.fetch;

// Mock the watchlist lookup service
jest.mock("../src/services/watchlistService", () => ({
  checkWatchlist: jest.fn(),
}));

jest.mock("../src/config/stellar", () => {
  const mockServer = {
    loadAccount: jest.fn((id) => {
      if (id === "GAAAAAAAACK4") {
        const err = new Error("Not Found");
        err.response = { status: 404 };
        throw err;
      }
      return Promise.resolve({
        id: id,
        account_id: id,
        sequence: "12345",
      });
    }),
  };

  return {
    server: mockServer,
    horizonUrl: "https://horizon-testnet.stellar.org",
    NETWORK: "testnet",
    NETWORKS: { testnet: "https://horizon-testnet.stellar.org" },
  };
});

const app = require("../src/index");
const watchlistService = require("../src/services/watchlistService");

describe("GET /account/:id/watchlist-status", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const cacheService = require("../src/services/cache");
    if (cacheService.flush) cacheService.flush();
    else if (cacheService.flushAll) cacheService.flushAll();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe("Account not on any watchlist", () => {
    it("returns { onWatchlist: false, sources: [] } when account is not on any watchlist", async () => {
      watchlistService.checkWatchlist.mockResolvedValue({
        onWatchlist: false,
        sources: [],
        reason: null,
      });

      const response = await request(app)
        .get("/account/GAAAAAAAADKM4/watchlist-status")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.onWatchlist).toBe(false);
      expect(response.body.data.sources).toEqual([]);
      expect(response.body.data.reason).toBeNull();
    });

    it("sources is always an array never null", async () => {
      watchlistService.checkWatchlist.mockResolvedValue({
        onWatchlist: false,
        sources: [],
        reason: null,
      });

      const response = await request(app)
        .get("/account/GAAAAAAAADKM4/watchlist-status")
        .expect(200);

      expect(Array.isArray(response.body.data.sources)).toBe(true);
      expect(response.body.data.sources).not.toBeNull();
    });
  });

  describe("Account on a watchlist", () => {
    it("returns { onWatchlist: true, sources: [...], reason } when account is flagged", async () => {
      watchlistService.checkWatchlist.mockResolvedValue({
        onWatchlist: true,
        sources: ["stellar-known-malicious", "cryptowatch"],
        reason: "Associated with suspicious activity",
      });

      const response = await request(app)
        .get("/account/GAAAAAAAADKM4/watchlist-status")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.onWatchlist).toBe(true);
      expect(response.body.data.sources).toEqual(["stellar-known-malicious", "cryptowatch"]);
      expect(response.body.data.reason).toBe("Associated with suspicious activity");
    });

    it("returns multiple sources when account appears on multiple watchlists", async () => {
      watchlistService.checkWatchlist.mockResolvedValue({
        onWatchlist: true,
        sources: ["watchlist-a", "watchlist-b", "watchlist-c"],
        reason: "High risk score",
      });

      const response = await request(app)
        .get("/account/GAAAAAAAADKM4/watchlist-status")
        .expect(200);

      expect(response.body.data.onWatchlist).toBe(true);
      expect(response.body.data.sources).toHaveLength(3);
    });
  });

  describe("Non-existent account", () => {
    it("returns a 404 when account does not exist on the network", async () => {
      const response = await request(app)
        .get("/account/GAAAAAAAACK4/watchlist-status")
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("not found");
    });
  });

  describe("Cache behavior", () => {
    it("returns cached response on subsequent requests", async () => {
      watchlistService.checkWatchlist.mockResolvedValue({
        onWatchlist: false,
        sources: [],
        reason: null,
      });

      // First request - cache miss
      await request(app)
        .get("/account/GAAAAAAAADKM4/watchlist-status")
        .expect(200);

      // Second request should hit cache
      const response2 = await request(app)
        .get("/account/GAAAAAAAADKM4/watchlist-status")
        .expect(200);

      expect(response2.header["x-cache"]).toBe("HIT");
    });

    it("bypasses cache when fresh=true", async () => {
      watchlistService.checkWatchlist
        .mockResolvedValueOnce({ onWatchlist: false, sources: [], reason: null })
        .mockResolvedValueOnce({ onWatchlist: true, sources: ["test"], reason: "test" });

      // First request
      await request(app)
        .get("/account/GAAAAAAAADKM4/watchlist-status?fresh=true")
        .expect(200);

      // Second request with fresh=true should not use cache
      const response = await request(app)
        .get("/account/GAAAAAAAADKM4/watchlist-status?fresh=true")
        .expect(200);

      expect(watchlistService.checkWatchlist).toHaveBeenCalledTimes(2);
    });
  });
});