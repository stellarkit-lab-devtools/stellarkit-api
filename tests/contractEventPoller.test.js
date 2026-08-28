"use strict";

/**
 * Tests for src/services/contractEventPoller.js
 *
 * Covers:
 *   - Poller only delivers events newer than the last seen event ID
 *   - Poller delivers nothing when there are no new events
 *   - Poller uses CONTRACT_POLL_INTERVAL_MS env var (default 5000)
 *   - Poller starts and stops correctly
 *   - Multiple registered contracts are polled independently
 *   - Webhook delivery errors are caught and do not crash the poller
 *   - compareEventIds correctly orders event IDs
 *   - Non-existent / empty RPC responses are handled gracefully
 */

const {
  ContractEventPoller,
  compareEventIds,
  getPollIntervalMs,
} = require("../src/services/contractEventPoller");

// ── compareEventIds ────────────────────────────────────────────────────────────

describe("compareEventIds", () => {
  it("returns 0 for identical IDs", () => {
    expect(compareEventIds("100-1", "100-1")).toBe(0);
  });

  it("returns negative when first ID is older (lower ledger)", () => {
    expect(compareEventIds("99-0", "100-0")).toBeLessThan(0);
  });

  it("returns positive when first ID is newer (higher ledger)", () => {
    expect(compareEventIds("101-0", "100-0")).toBeGreaterThan(0);
  });

  it("compares event index within the same ledger", () => {
    expect(compareEventIds("100-1", "100-2")).toBeLessThan(0);
    expect(compareEventIds("100-3", "100-2")).toBeGreaterThan(0);
  });

  it("handles IDs without an index segment", () => {
    expect(compareEventIds("100", "101")).toBeLessThan(0);
  });
});

// ── getPollIntervalMs ──────────────────────────────────────────────────────────

describe("getPollIntervalMs", () => {
  const originalEnv = process.env.CONTRACT_POLL_INTERVAL_MS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.CONTRACT_POLL_INTERVAL_MS;
    } else {
      process.env.CONTRACT_POLL_INTERVAL_MS = originalEnv;
    }
  });

  it("returns 5000 when env var is not set", () => {
    delete process.env.CONTRACT_POLL_INTERVAL_MS;
    expect(getPollIntervalMs()).toBe(5000);
  });

  it("returns parsed value from CONTRACT_POLL_INTERVAL_MS", () => {
    process.env.CONTRACT_POLL_INTERVAL_MS = "10000";
    expect(getPollIntervalMs()).toBe(10000);
  });

  it("falls back to 5000 for non-numeric values", () => {
    process.env.CONTRACT_POLL_INTERVAL_MS = "not-a-number";
    expect(getPollIntervalMs()).toBe(5000);
  });

  it("falls back to 5000 for zero or negative values", () => {
    process.env.CONTRACT_POLL_INTERVAL_MS = "0";
    expect(getPollIntervalMs()).toBe(5000);
    process.env.CONTRACT_POLL_INTERVAL_MS = "-1000";
    expect(getPollIntervalMs()).toBe(5000);
  });
});

// ── ContractEventPoller ────────────────────────────────────────────────────────

describe("ContractEventPoller", () => {
  const CONTRACT_ID = "CCJZ5DGASBWQXR5MPFCJXMBI333XE5U3FSJTNQU7RIKE3P5GN2K2WYD2";

  /** Build a minimal mock RPC client. */
  function makeMockClient(events = []) {
    return {
      getEvents: jest.fn().mockResolvedValue({ events }),
    };
  }

  function makeEvent(id) {
    return { id, type: "contract", contractId: CONTRACT_ID, value: `data-${id}` };
  }

  let poller;

  beforeEach(() => {
    poller = new ContractEventPoller();
  });

  afterEach(() => {
    poller.stop();
  });

  // ── Registration ────────────────────────────────────────────────────────────

  it("registers a contract and stores the watcher", () => {
    const deliver = jest.fn();
    poller.register(CONTRACT_ID, deliver);
    expect(poller._watchers.has(CONTRACT_ID)).toBe(true);
  });

  it("throws when contractId is not a string", () => {
    expect(() => poller.register(null, jest.fn())).toThrow(TypeError);
  });

  it("throws when deliverWebhook is not a function", () => {
    expect(() => poller.register(CONTRACT_ID, "not-a-fn")).toThrow(TypeError);
  });

  it("deregisters a contract", () => {
    poller.register(CONTRACT_ID, jest.fn());
    poller.deregister(CONTRACT_ID);
    expect(poller._watchers.has(CONTRACT_ID)).toBe(false);
  });

  // ── Start / Stop ────────────────────────────────────────────────────────────

  it("starts and reports isRunning=true", () => {
    poller.start(60000);
    expect(poller.isRunning).toBe(true);
  });

  it("stops and reports isRunning=false", () => {
    poller.start(60000);
    poller.stop();
    expect(poller.isRunning).toBe(false);
  });

  it("calling start() twice does not create a second timer", () => {
    poller.start(60000);
    const timerRef = poller._timer;
    poller.start(60000);
    expect(poller._timer).toBe(timerRef);
  });

  // ── Polling: delivers only new events ─────────────────────────────────────

  it("delivers all events when lastSeenEventId is null", async () => {
    const events = [makeEvent("100-0"), makeEvent("100-1"), makeEvent("101-0")];
    const client = makeMockClient(events);
    poller._rpcClient = client;

    const deliver = jest.fn().mockResolvedValue(undefined);
    poller.register(CONTRACT_ID, deliver, null);

    await poller._poll();

    expect(deliver).toHaveBeenCalledTimes(3);
    // Events delivered in ascending ID order
    expect(deliver.mock.calls[0][1].id).toBe("100-0");
    expect(deliver.mock.calls[2][1].id).toBe("101-0");
  });

  it("only delivers events newer than lastSeenEventId", async () => {
    const events = [makeEvent("100-0"), makeEvent("100-1"), makeEvent("101-0")];
    const client = makeMockClient(events);
    poller._rpcClient = client;

    const deliver = jest.fn().mockResolvedValue(undefined);
    poller.register(CONTRACT_ID, deliver, "100-0"); // last seen is 100-0

    await poller._poll();

    // Only 100-1 and 101-0 should be delivered
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver.mock.calls[0][1].id).toBe("100-1");
    expect(deliver.mock.calls[1][1].id).toBe("101-0");
  });

  it("delivers nothing when no events are newer than lastSeenEventId", async () => {
    const events = [makeEvent("100-0"), makeEvent("100-1")];
    const client = makeMockClient(events);
    poller._rpcClient = client;

    const deliver = jest.fn().mockResolvedValue(undefined);
    poller.register(CONTRACT_ID, deliver, "100-1"); // already up-to-date

    await poller._poll();

    expect(deliver).not.toHaveBeenCalled();
  });

  it("delivers nothing when RPC returns an empty events array", async () => {
    const client = makeMockClient([]);
    poller._rpcClient = client;

    const deliver = jest.fn();
    poller.register(CONTRACT_ID, deliver, null);

    await poller._poll();

    expect(deliver).not.toHaveBeenCalled();
  });

  // ── Cursor advancement ─────────────────────────────────────────────────────

  it("advances lastSeenEventId to the most recently delivered event", async () => {
    const events = [makeEvent("100-0"), makeEvent("101-0")];
    const client = makeMockClient(events);
    poller._rpcClient = client;

    const deliver = jest.fn().mockResolvedValue(undefined);
    poller.register(CONTRACT_ID, deliver, null);

    await poller._poll();

    expect(poller._watchers.get(CONTRACT_ID).lastSeenEventId).toBe("101-0");
  });

  it("does not advance cursor past a failed delivery", async () => {
    const events = [makeEvent("100-0"), makeEvent("101-0"), makeEvent("102-0")];
    const client = makeMockClient(events);
    poller._rpcClient = client;

    // Delivery succeeds for 100-0 then fails for 101-0
    const deliver = jest.fn()
      .mockResolvedValueOnce(undefined)        // 100-0 OK
      .mockRejectedValueOnce(new Error("net")); // 101-0 fails

    poller.register(CONTRACT_ID, deliver, null);

    await poller._poll();

    // Cursor should be 100-0 (last successful), 102-0 not delivered
    expect(poller._watchers.get(CONTRACT_ID).lastSeenEventId).toBe("100-0");
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  // ── Multiple contracts ─────────────────────────────────────────────────────

  it("polls all registered contracts independently", async () => {
    const CONTRACT_B = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

    const clientA = { getEvents: jest.fn().mockResolvedValue({ events: [makeEvent("100-0")] }) };
    const clientB = { getEvents: jest.fn().mockResolvedValue({ events: [makeEvent("200-0")] }) };

    // Use the same mock for both — return different results based on contractIds
    const sharedClient = {
      getEvents: jest.fn((opts) => {
        const ids = opts.filters[0].contractIds;
        if (ids[0] === CONTRACT_ID) return Promise.resolve({ events: [makeEvent("100-0")] });
        return Promise.resolve({ events: [{ id: "200-0", type: "contract", contractId: CONTRACT_B }] });
      }),
    };
    poller._rpcClient = sharedClient;

    const deliverA = jest.fn().mockResolvedValue(undefined);
    const deliverB = jest.fn().mockResolvedValue(undefined);
    poller.register(CONTRACT_ID, deliverA, null);
    poller.register(CONTRACT_B, deliverB, null);

    await poller._poll();

    expect(deliverA).toHaveBeenCalledTimes(1);
    expect(deliverB).toHaveBeenCalledTimes(1);
    expect(deliverA.mock.calls[0][0]).toBe(CONTRACT_ID);
    expect(deliverB.mock.calls[0][0]).toBe(CONTRACT_B);
  });

  // ── RPC errors ─────────────────────────────────────────────────────────────

  it("does not throw when RPC call rejects — error is logged", async () => {
    poller._rpcClient = {
      getEvents: jest.fn().mockRejectedValue(new Error("RPC error")),
    };

    const deliver = jest.fn();
    poller.register(CONTRACT_ID, deliver, null);

    // Should not throw
    await expect(poller._poll()).resolves.toBeUndefined();
    expect(deliver).not.toHaveBeenCalled();
  });

  it("handles missing events field in RPC response gracefully", async () => {
    poller._rpcClient = {
      getEvents: jest.fn().mockResolvedValue({}), // no .events field
    };

    const deliver = jest.fn();
    poller.register(CONTRACT_ID, deliver, null);

    await expect(poller._poll()).resolves.toBeUndefined();
    expect(deliver).not.toHaveBeenCalled();
  });

  // ── No registered watchers ────────────────────────────────────────────────

  it("does nothing when no contracts are registered", async () => {
    const client = makeMockClient([makeEvent("100-0")]);
    poller._rpcClient = client;

    await poller._poll();

    expect(client.getEvents).not.toHaveBeenCalled();
  });
});
