/**
 * Tests for the contract.event webhook system.
 *
 * Covers:
 *   1. Webhook registration via POST /webhooks.
 *   2. Webhook listing via GET /webhooks.
 *   3. Payload shape delivered to subscribers when a contract emits an event.
 *   4. The normaliseEvent helper in contractEventPoller.
 */

const request = require("supertest");
const axios = require("axios");
const app = require("../src/index");
const registry = require("../src/services/webhookRegistry");
const delivery = require("../src/services/webhookDelivery");
const { normaliseEvent } = require("../src/services/contractEventPoller");

const CONTRACT_ID = "CCJZ5DGASBWQXR5MPFCJXMBI333XE5U3FSJTNQU7RIKE3P5GN2K2WYD2";
const WEBHOOK_URL = "https://example.com/hook";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeRawEvent(overrides = {}) {
  return {
    contractId: CONTRACT_ID,
    ledger: 12345,
    topic: [],
    value: null,
    ...overrides,
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  registry.clear();
  jest.restoreAllMocks();
});

// ── 1. Webhook registration ──────────────────────────────────────────────────

describe("POST /webhooks", () => {
  it("registers a webhook and returns 201 with the entry", async () => {
    const res = await request(app)
      .post("/webhooks")
      .set("Content-Type", "application/json")
      .send({ url: WEBHOOK_URL, event: "contract.event", contractId: CONTRACT_ID });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);

    const { data } = res.body;
    expect(typeof data.id).toBe("string");
    expect(data.url).toBe(WEBHOOK_URL);
    expect(data.event).toBe("contract.event");
    expect(data.contractId).toBe(CONTRACT_ID);
    expect(typeof data.createdAt).toBe("string");
  });

  it("registers a webhook without a contractId (wildcard)", async () => {
    const res = await request(app)
      .post("/webhooks")
      .set("Content-Type", "application/json")
      .send({ url: WEBHOOK_URL, event: "contract.event" });

    expect(res.statusCode).toBe(201);
    expect(res.body.data.contractId).toBeNull();
  });

  it("returns 400 when url is missing", async () => {
    const res = await request(app)
      .post("/webhooks")
      .set("Content-Type", "application/json")
      .send({ event: "contract.event" });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
    expect(res.body.error.field).toBe("url");
  });

  it("returns 400 for an invalid (non-http) url", async () => {
    const res = await request(app)
      .post("/webhooks")
      .set("Content-Type", "application/json")
      .send({ url: "ftp://bad.example.com", event: "contract.event" });

    expect(res.statusCode).toBe(400);
    expect(res.body.error.field).toBe("url");
  });

  it("returns 400 when event is missing", async () => {
    const res = await request(app)
      .post("/webhooks")
      .set("Content-Type", "application/json")
      .send({ url: WEBHOOK_URL });

    expect(res.statusCode).toBe(400);
    expect(res.body.error.field).toBe("event");
  });

  it("returns 400 for an unsupported event type", async () => {
    const res = await request(app)
      .post("/webhooks")
      .set("Content-Type", "application/json")
      .send({ url: WEBHOOK_URL, event: "unsupported.event" });

    expect(res.statusCode).toBe(400);
    expect(res.body.error.field).toBe("event");
  });

  it("returns 415 when Content-Type is not application/json", async () => {
    const res = await request(app)
      .post("/webhooks")
      .set("Content-Type", "text/plain")
      .send("not json");

    expect(res.statusCode).toBe(415);
    expect(res.body.error.type).toBe("InvalidContentType");
  });
});

// ── 2. Webhook listing ───────────────────────────────────────────────────────

describe("GET /webhooks", () => {
  it("returns an empty list when no webhooks are registered", async () => {
    const res = await request(app).get("/webhooks");

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });

  it("returns all registered webhooks", async () => {
    registry.register({ url: WEBHOOK_URL, event: "contract.event", contractId: CONTRACT_ID });
    registry.register({ url: "https://other.example.com/hook", event: "contract.event" });

    const res = await request(app).get("/webhooks");

    expect(res.statusCode).toBe(200);
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.total).toBe(2);
  });
});

// ── 3. Payload shape on delivery ─────────────────────────────────────────────

describe("deliverContractEvent — payload shape", () => {
  it("posts the normalised payload to the subscriber URL", async () => {
    registry.register({ url: WEBHOOK_URL, event: "contract.event", contractId: CONTRACT_ID });

    const mockPost = jest.spyOn(axios, "post").mockResolvedValue({ status: 200 });

    const payload = {
      event: "contract.event",
      contractId: CONTRACT_ID,
      eventType: "transfer",
      topic: ["transfer", "alice", "bob"],
      value: "100",
      ledger: 99999,
    };

    await delivery.deliverContractEvent(payload);

    expect(mockPost).toHaveBeenCalledTimes(1);
    const [calledUrl, calledPayload] = mockPost.mock.calls[0];
    expect(calledUrl).toBe(WEBHOOK_URL);
    expect(calledPayload).toMatchObject({
      event: "contract.event",
      contractId: CONTRACT_ID,
      eventType: "transfer",
      topic: expect.any(Array),
      value: expect.anything(),
      ledger: 99999,
    });
  });

  it("includes event, contractId, eventType, topic, value, and ledger in payload", async () => {
    registry.register({ url: WEBHOOK_URL, event: "contract.event", contractId: CONTRACT_ID });

    let deliveredPayload = null;
    jest.spyOn(axios, "post").mockImplementation(async (_url, body) => {
      deliveredPayload = body;
      return { status: 200 };
    });

    const payload = {
      event: "contract.event",
      contractId: CONTRACT_ID,
      eventType: "mint",
      topic: ["mint", "recipient"],
      value: "500",
      ledger: 42000,
    };

    await delivery.deliverContractEvent(payload);

    expect(deliveredPayload).not.toBeNull();
    expect(deliveredPayload).toHaveProperty("event", "contract.event");
    expect(deliveredPayload).toHaveProperty("contractId", CONTRACT_ID);
    expect(deliveredPayload).toHaveProperty("eventType", "mint");
    expect(deliveredPayload).toHaveProperty("topic");
    expect(deliveredPayload).toHaveProperty("value");
    expect(deliveredPayload).toHaveProperty("ledger", 42000);
  });

  it("does not call axios when no webhooks match the contractId", async () => {
    // Register for a different contract
    registry.register({ url: WEBHOOK_URL, event: "contract.event", contractId: "CDIFFERENT" });

    const mockPost = jest.spyOn(axios, "post").mockResolvedValue({ status: 200 });

    await delivery.deliverContractEvent({
      event: "contract.event",
      contractId: CONTRACT_ID,
      eventType: "transfer",
      topic: [],
      value: null,
      ledger: 1,
    });

    expect(mockPost).not.toHaveBeenCalled();
  });

  it("delivers to wildcard webhooks (no contractId filter)", async () => {
    // Wildcard — no contractId
    registry.register({ url: WEBHOOK_URL, event: "contract.event" });

    const mockPost = jest.spyOn(axios, "post").mockResolvedValue({ status: 200 });

    await delivery.deliverContractEvent({
      event: "contract.event",
      contractId: CONTRACT_ID,
      eventType: "burn",
      topic: ["burn"],
      value: "50",
      ledger: 5000,
    });

    expect(mockPost).toHaveBeenCalledTimes(1);
  });
});

// ── 4. normaliseEvent ─────────────────────────────────────────────────────────

describe("contractEventPoller.normaliseEvent", () => {
  it("maps contractId, ledger, and event type correctly", () => {
    const raw = makeRawEvent({
      topic: [{ switch: () => ({ name: "scvSymbol" }), sym: () => "mint" }],
      value: null,
    });

    // topic entries are passed through decodeVal which tries scValToNative first
    // For a plain object (not a real ScVal) it will fall back and use the raw value string
    const result = normaliseEvent(raw);

    expect(result.event).toBe("contract.event");
    expect(result.contractId).toBe(CONTRACT_ID);
    expect(result.ledger).toBe(12345);
    expect(Array.isArray(result.topic)).toBe(true);
  });

  it("returns eventType 'unknown' when topic is empty", () => {
    const raw = makeRawEvent({ topic: [] });
    const result = normaliseEvent(raw);
    expect(result.eventType).toBe("unknown");
  });

  it("includes null value when raw event has no value", () => {
    const raw = makeRawEvent({ value: null });
    const result = normaliseEvent(raw);
    expect(result.value).toBeNull();
  });

  it("extracts eventType as the string form of the first topic", () => {
    // Raw topic entries that scValToNative can handle as plain strings
    // We use a topic array where the first entry is a plain string-like object
    // (normaliseEvent calls decodeVal which falls back gracefully)
    const raw = makeRawEvent({ topic: ["transfer", "alice"] });
    const result = normaliseEvent(raw);
    // "transfer" is a plain string so decodeVal returns it as-is
    expect(result.eventType).toBe("transfer");
    expect(result.topic).toEqual(["transfer", "alice"]);
  });
});
