const request = require("supertest");
const express = require("express");
const cacheService = require("../src/services/cache");

// Mock the stellar server
jest.mock("../src/config/stellar", () => ({
  server: {
    getEvents: jest.fn(),
    ledgers: jest.fn(),
    loadBaseAccount: jest.fn(),
  },
}));

const { server } = require("../src/config/stellar");
const eventsRouter = require("../src/routes/events");

// Create test app
const app = express();
app.use("/events", eventsRouter);

describe("GET /events", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  const validContractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABG4";

  describe("validation", () => {
    it("returns 400 when contractId is missing", async () => {
      const res = await request(app).get("/events");
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("contractId");
    });

    it("returns 400 for invalid contractId format", async () => {
      const res = await request(app).get("/events?contractId=invalid");
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("Invalid contractId");
    });

    it("returns 400 for malformed ledgers parameter", async () => {
      const res = await request(app).get(`/events?contractId=${validContractId}&ledgers=-1`);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("ledgers");
    });

    it("accepts valid contractId format", async () => {
      // Mock successful response
      server.getEvents.mockResolvedValue({ events: [] });
      server.ledgers.mockResolvedValue({
        records: [{ sequence: 100 }],
      });
      
      const res = await request(app).get(`/events?contractId=${validContractId}`);
      // Should not be a validation error (400)
      expect(res.status).not.toBe(400);
    });
  });

  describe("event counting", () => {
    it("counts events by type correctly", async () => {
      const mockEvents = [
        { type: "contract", topic: [{ type: "symbol", value: "mint" }], pagingToken: "1" },
        { type: "contract", topic: [{ type: "symbol", value: "mint" }], pagingToken: "2" },
        { type: "contract", topic: [{ type: "symbol", value: "burn" }], pagingToken: "3" },
        { type: "system", topic: [{ type: "symbol", value: "diagnostic" }], pagingToken: "4" },
      ];

      server.getEvents
        .mockResolvedValueOnce({ events: mockEvents, pagingToken: "4" })
        .mockResolvedValueOnce({ events: [], pagingToken: "4" });
      
      server.ledgers.mockResolvedValue({
        records: [{ sequence: 50 }],
      });

      // Need a second call for toLedger
      server.ledgers
        .mockResolvedValueOnce({ records: [{ sequence: 100 }] }) // oldest
        .mockResolvedValueOnce({ records: [{ sequence: 100 }] }); // current

      const res = await request(app).get(`/events?contractId=${validContractId}&ledgers=100`);

      expect(res.status).toBe(200);
      expect(res.body.data.totalEvents).toBe(3); // Excludes diagnostic by default
      expect(res.body.data.byType.contract).toBe(2);
      expect(res.body.data.byType.system).toBe(undefined);
    });
  });

  describe("topic decoding", () => {
    it("decodes topics correctly", async () => {
      const mockEvents = [
        { type: "contract", topic: [{ type: "symbol", value: "Transfer" }], pagingToken: "1" },
        { type: "contract", topic: [{ type: "string", value: "Hello World" }], pagingToken: "2" },
      ];

      server.getEvents
        .mockResolvedValueOnce({ events: mockEvents, pagingToken: "2" })
        .mockResolvedValueOnce({ events: [], pagingToken: "2" });
      
      server.ledgers
        .mockResolvedValueOnce({ records: [{ sequence: 50 }] })
        .mockResolvedValueOnce({ records: [{ sequence: 100 }] });

      const res = await request(app).get(`/events?contractId=${validContractId}`);

      expect(res.status).toBe(200);
      const topics = res.body.data.topics;
      expect(topics).toContainEqual(expect.objectContaining({ topic: "Transfer", count: 1 }));
    });
  });

  describe("partial flag", () => {
    it("sets partial=true when limit is reached", async () => {
      const mockEvents = Array.from({ length: 1000 }, (_, i) => ({
        type: "contract",
        topic: [{ type: "symbol", value: `event${i}` }],
        pagingToken: `${i}`,
      }));

      // First call returns full page
      server.getEvents
        .mockResolvedValueOnce({ events: mockEvents, pagingToken: "1000" })
        .mockResolvedValueOnce({ events: mockEvents, pagingToken: "2000" }); // Second page
      server.ledgers
        .mockResolvedValueOnce({ records: [{ sequence: 50 }] })
        .mockResolvedValueOnce({ records: [{ sequence: 100 }] });

      const res = await request(app).get(`/events?contractId=${validContractId}&ledgers=1000`);

      expect(res.status).toBe(200);
      expect(res.body.data.partial).toBe(true);
    });

    it("sets partial=false when all events retrieved", async () => {
      const mockEvents = [
        { type: "contract", topic: [{ type: "symbol", value: "event1" }], pagingToken: "1" },
      ];

      server.getEvents
        .mockResolvedValueOnce({ events: mockEvents, pagingToken: "1" })
        .mockResolvedValueOnce({ events: [], pagingToken: "1" });
      
      server.ledgers
        .mockResolvedValueOnce({ records: [{ sequence: 50 }] })
        .mockResolvedValueOnce({ records: [{ sequence: 100 }] });

      const res = await request(app).get(`/events?contractId=${validContractId}&ledgers=1000`);

      expect(res.status).toBe(200);
      expect(res.body.data.partial).toBe(false);
    });
  });

  describe("range clamping", () => {
    it("clamps fromLedger to oldest retained ledger", async () => {
      // Oldest retained is ledger 80, current is 100, requested lookback is 1000
      // Should clamp to 80, not 0 or negative
      server.ledgers
        .mockResolvedValueOnce({ records: [{ sequence: 80 }] }) // oldest
        .mockResolvedValueOnce({ records: [{ sequence: 100 }] }); // current

      server.getEvents.mockResolvedValue({ events: [], pagingToken: null });

      await request(app).get(`/events?contractId=${validContractId}&ledgers=1000`);

      // Verify getEvents was called with clamped ledger
      expect(server.getEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          startLedger: 80, // Should be clamped to oldest
        })
      );
    });
  });

  describe("diagnostic filtering", () => {
    it("excludes diagnostic events by default", async () => {
      const mockEvents = [
        { type: "contract", topic: [{ type: "symbol", value: "mint" }], pagingToken: "1" },
        { type: "diagnostic", topic: [{ type: "symbol", value: "diagnostic" }], pagingToken: "2" },
        { type: "diagnostic", topic: [{ type: "symbol", value: "system_log" }], pagingToken: "3" },
      ];

      server.getEvents
        .mockResolvedValueOnce({ events: mockEvents, pagingToken: "3" })
        .mockResolvedValueOnce({ events: [], pagingToken: "3" });
      server.ledgers
        .mockResolvedValueOnce({ records: [{ sequence: 50 }] })
        .mockResolvedValueOnce({ records: [{ sequence: 100 }] });

      const res = await request(app).get(`/events?contractId=${validContractId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.totalEvents).toBe(1); // Only the mint event
    });

    it("includes diagnostic events when includeDiagnostic=true", async () => {
      const mockEvents = [
        { type: "contract", topic: [{ type: "symbol", value: "mint" }], pagingToken: "1" },
        { type: "diagnostic", topic: [{ type: "symbol", value: "diagnostic" }], pagingToken: "2" },
      ];

      server.getEvents
        .mockResolvedValueOnce({ events: mockEvents, pagingToken: "2" })
        .mockResolvedValueOnce({ events: [], pagingToken: "2" });
      server.ledgers
        .mockResolvedValueOnce({ records: [{ sequence: 50 }] })
        .mockResolvedValueOnce({ records: [{ sequence: 100 }] });

      const res = await request(app).get(`/events?contractId=${validContractId}&includeDiagnostic=true`);

      expect(res.status).toBe(200);
      expect(res.body.data.totalEvents).toBe(2);
    });
  });

  describe("empty result", () => {
    it("returns empty result correctly", async () => {
      server.getEvents.mockResolvedValue({ events: [], pagingToken: null });
      server.ledgers
        .mockResolvedValueOnce({ records: [{ sequence: 50 }] })
        .mockResolvedValueOnce({ records: [{ sequence: 100 }] });

      const res = await request(app).get(`/events?contractId=${validContractId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.totalEvents).toBe(0);
      expect(res.body.data.byType).toEqual({});
      expect(res.body.data.topics).toEqual([]);
      expect(res.body.data.partial).toBe(false);
    });
  });

  describe("caching", () => {
    it("caches results for 15 seconds", async () => {
      server.getEvents.mockResolvedValue({ events: [], pagingToken: null });
      server.ledgers
        .mockResolvedValueOnce({ records: [{ sequence: 50 }] })
        .mockResolvedValueOnce({ records: [{ sequence: 100 }] });

      // First request - should call RPC
      await request(app).get(`/events?contractId=${validContractId}`);
      
      // Second request - should use cache
      const res = await request(app).get(`/events?contractId=${validContractId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.cached).toBe(true);
      expect(server.getEvents).toHaveBeenCalledTimes(1); // Only called once
    });
  });
});