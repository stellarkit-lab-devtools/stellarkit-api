"use strict";

/**
 * Tests for GET /webhooks
 *
 * Covers:
 *   - Unfiltered list returns every registered webhook
 *   - Each webhook includes webhookId, url, events, accountId, createdAt
 *   - ?accountId= filters to that account only
 *   - Empty results return { webhooks: [], total: 0 } with 200 (never 404)
 */

const request = require("supertest");
const express = require("express");
const webhookStore = require("../src/services/webhookStore");

jest.mock("../src/middleware/webhookSignatureAuth", () => (req, res, next) => next());

const webhooksRouter = require("../src/routes/webhooks");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/webhooks", webhooksRouter);
  return app;
}

const ACCOUNT_A = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
const ACCOUNT_B = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const UNKNOWN_ACCOUNT = "GCZST3XVCDTUJ76ZAV2HA72KYEV5QJ5PCIPNPLGKLPTK3AAEB23X2O5";

function requiredFields(webhook) {
  expect(webhook).toEqual(
    expect.objectContaining({
      webhookId: expect.any(String),
      url: expect.any(String),
      events: expect.any(Array),
      createdAt: expect.any(String),
    }),
  );
  expect(webhook).toHaveProperty("accountId");
}

describe("GET /webhooks", () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    webhookStore.clear();
  });

  it("returns success:true with webhooks array and total", async () => {
    const res = await request(app).get("/webhooks");

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ webhooks: [], total: 0 });
  });

  it("returns an empty array (not 404) when no webhooks are registered", async () => {
    const res = await request(app).get("/webhooks");

    expect(res.statusCode).toBe(200);
    expect(res.body.data.webhooks).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });

  it("unfiltered list returns every registered webhook", async () => {
    webhookStore.register({
      url: "https://a.example/hooks",
      events: ["payment"],
      accountId: ACCOUNT_A,
    });
    webhookStore.register({
      url: "https://b.example/hooks",
      events: ["account_funded"],
      accountId: ACCOUNT_B,
    });

    const res = await request(app).get("/webhooks");

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.webhooks).toHaveLength(2);
    expect(res.body.data.total).toBe(2);
    res.body.data.webhooks.forEach(requiredFields);
  });

  it("each webhook includes webhookId, url, events, accountId, and createdAt", async () => {
    const stored = webhookStore.register({
      url: "https://hooks.example/path",
      events: ["payment", "trade"],
      accountId: ACCOUNT_A,
    });

    const res = await request(app).get("/webhooks");
    const [webhook] = res.body.data.webhooks;

    expect(webhook.webhookId).toBe(stored.webhookId);
    expect(webhook.url).toBe("https://hooks.example/path");
    expect(webhook.events).toEqual(["payment", "trade"]);
    expect(webhook.accountId).toBe(ACCOUNT_A);
    expect(webhook.createdAt).toBe(stored.createdAt);
    expect(new Date(webhook.createdAt).toISOString()).toBe(webhook.createdAt);
  });

  it("?accountId= returns only webhooks for that account", async () => {
    webhookStore.register({
      url: "https://a.example/hooks",
      events: ["payment"],
      accountId: ACCOUNT_A,
    });
    webhookStore.register({
      url: "https://a2.example/hooks",
      events: ["trade"],
      accountId: ACCOUNT_A,
    });
    webhookStore.register({
      url: "https://b.example/hooks",
      events: ["payment"],
      accountId: ACCOUNT_B,
    });

    const res = await request(app).get("/webhooks").query({ accountId: ACCOUNT_A });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.webhooks).toHaveLength(2);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.webhooks.every((w) => w.accountId === ACCOUNT_A)).toBe(true);
    expect(res.body.data.webhooks.map((w) => w.url).sort()).toEqual([
      "https://a.example/hooks",
      "https://a2.example/hooks",
    ]);
  });

  it("?accountId= with no matching webhooks returns an empty array, not 404", async () => {
    webhookStore.register({
      url: "https://a.example/hooks",
      events: ["payment"],
      accountId: ACCOUNT_A,
    });

    const res = await request(app).get("/webhooks").query({ accountId: UNKNOWN_ACCOUNT });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.webhooks).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });

  it("unfiltered list includes webhooks that have no accountId", async () => {
    webhookStore.register({ url: "https://global.example/hooks", events: ["payment"] });

    const res = await request(app).get("/webhooks");

    expect(res.statusCode).toBe(200);
    expect(res.body.data.webhooks).toHaveLength(1);
    expect(res.body.data.webhooks[0].accountId).toBeNull();
    expect(res.body.data.total).toBe(1);
  });
});

describe("WebhookStore.list(accountId)", () => {
  beforeEach(() => {
    webhookStore.clear();
  });

  it("returns all entries when called with no accountId", () => {
    webhookStore.register({ url: "https://a.com", events: ["payment"], accountId: ACCOUNT_A });
    webhookStore.register({ url: "https://b.com", events: ["payment"], accountId: ACCOUNT_B });
    expect(webhookStore.list()).toHaveLength(2);
  });

  it("filters by accountId when provided", () => {
    const a = webhookStore.register({ url: "https://a.com", events: ["payment"], accountId: ACCOUNT_A });
    webhookStore.register({ url: "https://b.com", events: ["payment"], accountId: ACCOUNT_B });
    const list = webhookStore.list(ACCOUNT_A);
    expect(list).toHaveLength(1);
    expect(list[0].webhookId).toBe(a.webhookId);
  });
});
