"use strict";

/**
 * Tests for the webhooks endpoints and WebhookStore service.
 *
 * Covers:
 *   WebhookStore unit tests
 *     - register() returns entry with webhookId, url, events, registeredAt
 *     - find() returns entry when present, undefined when absent
 *     - remove() returns true on success, false when not found
 *     - list() returns all registered webhooks
 *     - clear() empties the store
 *
 *   POST /webhooks
 *     - 201 with full entry on valid request
 *     - 400 when url is missing
 *     - 400 when url is not a valid HTTP/HTTPS URL
 *     - 400 when events is missing
 *     - 400 when events is empty array
 *     - 400 when events contains non-string items
 *     - assigns a unique webhookId to each registration
 *
 *   GET /webhooks
 *     - 200 with empty list initially
 *     - 200 with registered webhooks after POST
 *     - response includes total count
 *
 *   DELETE /webhooks/:webhookId
 *     - 200 with { webhookId, unregistered: true } on success
 *     - removes the webhook from the store
 *     - 404 with { type: "WebhookNotFound" } when webhookId does not exist
 *     - subsequent DELETE of same ID also returns 404
 */

const request    = require("supertest");
const webhookStore = require("../src/services/webhookStore");

// Suppress the warm-up cache calls during test init
jest.mock("../src/config/stellar", () => ({
  ...jest.requireActual("../src/config/stellar"),
  server: {
    loadAccount:  jest.fn(),
    payments:     jest.fn(),
    operations:   jest.fn(),
    offers:       jest.fn(),
    transactions: jest.fn(),
    ledgers: jest.fn().mockReturnValue({
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      call:  jest.fn().mockResolvedValue({ records: [] }),
    }),
    feeStats: jest.fn().mockResolvedValue({
      fee_charged: { min: "100", p10: "100", p50: "200", p95: "500", p99: "1000", max: "5000" },
      last_ledger_base_fee: "100",
      ledger_capacity_usage: "0.5",
    }),
  },
  fetchAccountCreation: jest.fn(),
}));

const app = require("../src/index");

const VALID_URL    = "https://example.com/hooks";
const VALID_EVENTS = ["payment", "account_funded"];

beforeEach(() => {
  webhookStore.clear();
  jest.clearAllMocks();
});

// ── WebhookStore unit tests ───────────────────────────────────────────────────

describe("WebhookStore", () => {
  describe("register()", () => {
    it("returns an entry with a non-empty webhookId string", () => {
      const entry = webhookStore.register({ url: VALID_URL, events: VALID_EVENTS });
      expect(typeof entry.webhookId).toBe("string");
      expect(entry.webhookId.length).toBeGreaterThan(0);
    });

    it("returns an entry with the provided url", () => {
      const entry = webhookStore.register({ url: VALID_URL, events: VALID_EVENTS });
      expect(entry.url).toBe(VALID_URL);
    });

    it("returns an entry with the provided events array", () => {
      const entry = webhookStore.register({ url: VALID_URL, events: VALID_EVENTS });
      expect(entry.events).toEqual(VALID_EVENTS);
    });

    it("returns an entry with a registeredAt ISO timestamp", () => {
      const entry = webhookStore.register({ url: VALID_URL, events: VALID_EVENTS });
      expect(typeof entry.registeredAt).toBe("string");
      expect(new Date(entry.registeredAt).toISOString()).toBe(entry.registeredAt);
    });

    it("assigns unique webhookIds to separate registrations", () => {
      const a = webhookStore.register({ url: VALID_URL, events: ["payment"] });
      const b = webhookStore.register({ url: VALID_URL, events: ["payment"] });
      expect(a.webhookId).not.toBe(b.webhookId);
    });

    it("increments the store size by 1 on each call", () => {
      expect(webhookStore.size).toBe(0);
      webhookStore.register({ url: VALID_URL, events: VALID_EVENTS });
      expect(webhookStore.size).toBe(1);
      webhookStore.register({ url: VALID_URL, events: VALID_EVENTS });
      expect(webhookStore.size).toBe(2);
    });
  });

  describe("find()", () => {
    it("returns the entry when the webhookId exists", () => {
      const entry = webhookStore.register({ url: VALID_URL, events: VALID_EVENTS });
      expect(webhookStore.find(entry.webhookId)).toEqual(entry);
    });

    it("returns undefined when the webhookId does not exist", () => {
      expect(webhookStore.find("nonexistent")).toBeUndefined();
    });
  });

  describe("remove()", () => {
    it("returns true when the webhook existed and was removed", () => {
      const entry = webhookStore.register({ url: VALID_URL, events: VALID_EVENTS });
      expect(webhookStore.remove(entry.webhookId)).toBe(true);
    });

    it("returns false when the webhookId does not exist", () => {
      expect(webhookStore.remove("nonexistent")).toBe(false);
    });

    it("removes the entry so find() returns undefined afterwards", () => {
      const entry = webhookStore.register({ url: VALID_URL, events: VALID_EVENTS });
      webhookStore.remove(entry.webhookId);
      expect(webhookStore.find(entry.webhookId)).toBeUndefined();
    });

    it("decrements the store size by 1", () => {
      const entry = webhookStore.register({ url: VALID_URL, events: VALID_EVENTS });
      expect(webhookStore.size).toBe(1);
      webhookStore.remove(entry.webhookId);
      expect(webhookStore.size).toBe(0);
    });
  });

  describe("list()", () => {
    it("returns an empty array when no webhooks are registered", () => {
      expect(webhookStore.list()).toEqual([]);
    });

    it("returns all registered webhook entries", () => {
      const a = webhookStore.register({ url: "https://a.com", events: ["payment"] });
      const b = webhookStore.register({ url: "https://b.com", events: ["account_funded"] });
      const list = webhookStore.list();
      expect(list).toHaveLength(2);
      expect(list.map((e) => e.webhookId)).toContain(a.webhookId);
      expect(list.map((e) => e.webhookId)).toContain(b.webhookId);
    });

    it("does not include removed webhooks", () => {
      const a = webhookStore.register({ url: "https://a.com", events: ["payment"] });
      webhookStore.register({ url: "https://b.com", events: ["payment"] });
      webhookStore.remove(a.webhookId);
      expect(webhookStore.list()).toHaveLength(1);
    });
  });

  describe("clear()", () => {
    it("empties the store", () => {
      webhookStore.register({ url: VALID_URL, events: VALID_EVENTS });
      webhookStore.register({ url: VALID_URL, events: VALID_EVENTS });
      webhookStore.clear();
      expect(webhookStore.size).toBe(0);
      expect(webhookStore.list()).toEqual([]);
    });
  });
});

// ── POST /webhooks ────────────────────────────────────────────────────────────

describe("POST /webhooks", () => {
  it("returns 201 with the registered webhook entry", async () => {
    const res = await request(app)
      .post("/webhooks")
      .send({ url: VALID_URL, events: VALID_EVENTS });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.webhookId).toBeDefined();
    expect(res.body.data.url).toBe(VALID_URL);
    expect(res.body.data.events).toEqual(VALID_EVENTS);
    expect(res.body.data.registeredAt).toBeDefined();
  });

  it("assigns a unique webhookId to each registration", async () => {
    const r1 = await request(app).post("/webhooks").send({ url: VALID_URL, events: ["payment"] });
    const r2 = await request(app).post("/webhooks").send({ url: VALID_URL, events: ["payment"] });
    expect(r1.body.data.webhookId).not.toBe(r2.body.data.webhookId);
  });

  it("stores the webhook so it appears in GET /webhooks", async () => {
    await request(app).post("/webhooks").send({ url: VALID_URL, events: VALID_EVENTS });
    const list = await request(app).get("/webhooks");
    expect(list.body.data.webhooks).toHaveLength(1);
    expect(list.body.data.webhooks[0].url).toBe(VALID_URL);
  });

  it("returns 400 when url is missing", async () => {
    const res = await request(app)
      .post("/webhooks")
      .send({ events: VALID_EVENTS });
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
  });

  it("returns 400 when url is an empty string", async () => {
    const res = await request(app)
      .post("/webhooks")
      .send({ url: "", events: VALID_EVENTS });
    expect(res.statusCode).toBe(400);
    expect(res.body.error.type).toBe("ValidationError");
  });

  it("returns 400 when url is not a valid HTTP/HTTPS URL", async () => {
    const res = await request(app)
      .post("/webhooks")
      .send({ url: "ftp://not-http.com", events: VALID_EVENTS });
    expect(res.statusCode).toBe(400);
    expect(res.body.error.type).toBe("ValidationError");
  });

  it("returns 400 when events is missing", async () => {
    const res = await request(app)
      .post("/webhooks")
      .send({ url: VALID_URL });
    expect(res.statusCode).toBe(400);
    expect(res.body.error.type).toBe("ValidationError");
  });

  it("returns 400 when events is an empty array", async () => {
    const res = await request(app)
      .post("/webhooks")
      .send({ url: VALID_URL, events: [] });
    expect(res.statusCode).toBe(400);
    expect(res.body.error.type).toBe("ValidationError");
  });

  it("returns 400 when events contains non-string items", async () => {
    const res = await request(app)
      .post("/webhooks")
      .send({ url: VALID_URL, events: [123, null] });
    expect(res.statusCode).toBe(400);
    expect(res.body.error.type).toBe("ValidationError");
  });
});

// ── GET /webhooks ─────────────────────────────────────────────────────────────

describe("GET /webhooks", () => {
  it("returns 200 with an empty list when no webhooks are registered", async () => {
    const res = await request(app).get("/webhooks");
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.webhooks).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });

  it("returns all registered webhooks after POST", async () => {
    await request(app).post("/webhooks").send({ url: "https://a.com", events: ["payment"] });
    await request(app).post("/webhooks").send({ url: "https://b.com", events: ["account_funded"] });

    const res = await request(app).get("/webhooks");
    expect(res.statusCode).toBe(200);
    expect(res.body.data.webhooks).toHaveLength(2);
    expect(res.body.data.total).toBe(2);
  });

  it("response total matches the number of webhooks in the array", async () => {
    await request(app).post("/webhooks").send({ url: VALID_URL, events: ["payment"] });

    const res = await request(app).get("/webhooks");
    expect(res.body.data.total).toBe(res.body.data.webhooks.length);
  });
});

// ── DELETE /webhooks/:webhookId ───────────────────────────────────────────────

describe("DELETE /webhooks/:webhookId", () => {
  it("returns 200 with { webhookId, unregistered: true } on success", async () => {
    const postRes = await request(app)
      .post("/webhooks")
      .send({ url: VALID_URL, events: VALID_EVENTS });

    const { webhookId } = postRes.body.data;
    const delRes = await request(app).delete(`/webhooks/${webhookId}`);

    expect(delRes.statusCode).toBe(200);
    expect(delRes.body.success).toBe(true);
    expect(delRes.body.data.webhookId).toBe(webhookId);
    expect(delRes.body.data.unregistered).toBe(true);
  });

  it("removes the webhook so it no longer appears in GET /webhooks", async () => {
    const postRes = await request(app)
      .post("/webhooks")
      .send({ url: VALID_URL, events: VALID_EVENTS });

    const { webhookId } = postRes.body.data;
    await request(app).delete(`/webhooks/${webhookId}`);

    const listRes = await request(app).get("/webhooks");
    const ids = listRes.body.data.webhooks.map((w) => w.webhookId);
    expect(ids).not.toContain(webhookId);
  });

  it("returns 404 with type 'WebhookNotFound' when webhookId does not exist", async () => {
    const res = await request(app).delete("/webhooks/nonexistent-id");

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("WebhookNotFound");
  });

  it("error message contains the unknown webhookId", async () => {
    const badId = "wh_does_not_exist";
    const res   = await request(app).delete(`/webhooks/${badId}`);

    expect(res.body.error.message).toContain(badId);
  });

  it("returns 404 on a second DELETE of the same webhookId", async () => {
    const postRes = await request(app)
      .post("/webhooks")
      .send({ url: VALID_URL, events: VALID_EVENTS });

    const { webhookId } = postRes.body.data;

    await request(app).delete(`/webhooks/${webhookId}`);
    const second = await request(app).delete(`/webhooks/${webhookId}`);

    expect(second.statusCode).toBe(404);
    expect(second.body.error.type).toBe("WebhookNotFound");
  });

  it("only deletes the targeted webhook — others remain", async () => {
    const r1 = await request(app).post("/webhooks").send({ url: "https://a.com", events: ["payment"] });
    const r2 = await request(app).post("/webhooks").send({ url: "https://b.com", events: ["payment"] });

    await request(app).delete(`/webhooks/${r1.body.data.webhookId}`);

    const listRes = await request(app).get("/webhooks");
    expect(listRes.body.data.webhooks).toHaveLength(1);
    expect(listRes.body.data.webhooks[0].webhookId).toBe(r2.body.data.webhookId);
  });
});
