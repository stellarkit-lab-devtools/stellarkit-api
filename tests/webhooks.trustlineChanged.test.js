const request = require("supertest");

jest.mock("../src/config/stellar", () => ({
  server: { loadAccount: jest.fn() },
  horizonUrl: "https://horizon-testnet.stellar.org",
  NETWORK: "testnet",
}));

const app = require("../src/index");
const webhookService = require("../src/services/webhookService");
const TrustlineChangeDetector =
  require("../src/services/trustlineChangeDetector");

describe("Trustline Webhook System", () => {
  const ACCOUNT_ID = "GBRPYHIL2CI3WHZSRXYE5Q6MKDA77BNUCQVLLELYVT2QX3BZ4TSNOTF";
  const WEBHOOK_URL = "https://example.com/webhook";
  const ISSUER = "GBHSJZQQOASDCJMMK4J3K7S4KCTGP72QJVVJ4RXNZ7TXPZ6RCK5BLYD";
  const USDC_CODE = "USDC";

  beforeEach(() => {
    jest.clearAllMocks();
    webhookService.clear();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Webhook Registration", () => {
    it("registers a webhook for an account", async () => {
      const res = await request(app)
        .post("/webhooks")
        .send({
          accountId: ACCOUNT_ID,
          url: WEBHOOK_URL,
          events: ["trustline.changed"],
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accountId).toBe(ACCOUNT_ID);
      expect(res.body.data.url).toBe(WEBHOOK_URL);
      expect(res.body.data.events).toContain("trustline.changed");
    });

    it("returns 400 for missing accountId", async () => {
      const res = await request(app)
        .post("/webhooks")
        .send({
          url: WEBHOOK_URL,
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 for missing url", async () => {
      const res = await request(app)
        .post("/webhooks")
        .send({
          accountId: ACCOUNT_ID,
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 for invalid URL format", async () => {
      const res = await request(app)
        .post("/webhooks")
        .send({
          accountId: ACCOUNT_ID,
          url: "not-a-valid-url",
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 for invalid account ID", async () => {
      const res = await request(app)
        .post("/webhooks")
        .send({
          accountId: "invalid-account",
          url: WEBHOOK_URL,
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe("Webhook Retrieval", () => {
    it("retrieves webhooks for an account", async () => {
      webhookService.registerWebhook(ACCOUNT_ID, WEBHOOK_URL);

      const res = await request(app).get(`/webhooks/${ACCOUNT_ID}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.webhooks.length).toBe(1);
      expect(res.body.data.webhooks[0].url).toBe(WEBHOOK_URL);
    });

    it("returns empty array when no webhooks exist", async () => {
      const res = await request(app).get(`/webhooks/${ACCOUNT_ID}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.webhooks).toEqual([]);
    });
  });

  describe("Webhook Deletion", () => {
    it("deletes a webhook", async () => {
      const webhook = webhookService.registerWebhook(ACCOUNT_ID, WEBHOOK_URL);

      const res = await request(app).delete(
        `/webhooks/${ACCOUNT_ID}/${webhook.id}`
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const webhooks = webhookService.getWebhooksForAccount(ACCOUNT_ID);
      expect(webhooks.length).toBe(0);
    });

    it("returns 404 for non-existent webhook", async () => {
      const res = await request(app).delete(`/webhooks/${ACCOUNT_ID}/999`);

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe("Trustline Change Detection", () => {
    it("detects trustline_created effect", async () => {
      const effects = [
        {
          type: "trustline_created",
          account: ACCOUNT_ID,
          asset_code: USDC_CODE,
          asset_issuer: ISSUER,
          asset_type: "credit_alphanum4",
          balance: "0.0000000",
          limit: "1000.0000000",
        },
      ];

      const webhookPayloads = [];
      global.fetch.mockImplementation((url, options) => {
        webhookPayloads.push(JSON.parse(options.body));
        return Promise.resolve({ ok: true });
      });

      webhookService.registerWebhook(ACCOUNT_ID, WEBHOOK_URL);

      await TrustlineChangeDetector.processTransactionEffects(
        ACCOUNT_ID,
        effects,
        "abc123"
      );

      expect(webhookPayloads.length).toBe(1);
      expect(webhookPayloads[0]).toEqual({
        event: "trustline.changed",
        accountId: ACCOUNT_ID,
        trustline: {
          asset: {
            code: USDC_CODE,
            issuer: ISSUER,
            type: "credit_alphanum4",
          },
          balance: "0.0000000",
          limit: "1000.0000000",
          isAuthorized: null,
          buyingLiabilities: "0.0000000",
          sellingLiabilities: "0.0000000",
        },
        changeType: "added",
        timestamp: expect.any(String),
        transactionHash: "abc123",
      });
    });

    it("detects trustline_removed effect", async () => {
      const effects = [
        {
          type: "trustline_removed",
          account: ACCOUNT_ID,
          asset_code: USDC_CODE,
          asset_issuer: ISSUER,
          asset_type: "credit_alphanum4",
        },
      ];

      const webhookPayloads = [];
      global.fetch.mockImplementation((url, options) => {
        webhookPayloads.push(JSON.parse(options.body));
        return Promise.resolve({ ok: true });
      });

      webhookService.registerWebhook(ACCOUNT_ID, WEBHOOK_URL);

      await TrustlineChangeDetector.processTransactionEffects(
        ACCOUNT_ID,
        effects,
        "abc123"
      );

      expect(webhookPayloads.length).toBe(1);
      expect(webhookPayloads[0].changeType).toBe("removed");
    });

    it("detects trustline_authorized effect", async () => {
      const effects = [
        {
          type: "trustline_authorized",
          account: ACCOUNT_ID,
          asset_code: USDC_CODE,
          asset_issuer: ISSUER,
          authorized: true,
        },
      ];

      const webhookPayloads = [];
      global.fetch.mockImplementation((url, options) => {
        webhookPayloads.push(JSON.parse(options.body));
        return Promise.resolve({ ok: true });
      });

      webhookService.registerWebhook(ACCOUNT_ID, WEBHOOK_URL);

      await TrustlineChangeDetector.processTransactionEffects(
        ACCOUNT_ID,
        effects,
        "abc123"
      );

      expect(webhookPayloads.length).toBe(1);
      expect(webhookPayloads[0].changeType).toBe("authorization_changed");
      expect(webhookPayloads[0].trustline.isAuthorized).toBe(true);
    });

    it("ignores non-trustline effects", async () => {
      const effects = [
        {
          type: "account_credited",
          account: ACCOUNT_ID,
          asset_code: USDC_CODE,
          asset_issuer: ISSUER,
          amount: "100.0000000",
        },
      ];

      const webhookPayloads = [];
      global.fetch.mockImplementation((url, options) => {
        webhookPayloads.push(JSON.parse(options.body));
        return Promise.resolve({ ok: true });
      });

      webhookService.registerWebhook(ACCOUNT_ID, WEBHOOK_URL);

      await TrustlineChangeDetector.processTransactionEffects(
        ACCOUNT_ID,
        effects,
        "abc123"
      );

      expect(webhookPayloads.length).toBe(0);
    });

    it("includes timestamp in payload", async () => {
      const effects = [
        {
          type: "trustline_created",
          account: ACCOUNT_ID,
          asset_code: USDC_CODE,
          asset_issuer: ISSUER,
          asset_type: "credit_alphanum4",
        },
      ];

      const webhookPayloads = [];
      global.fetch.mockImplementation((url, options) => {
        webhookPayloads.push(JSON.parse(options.body));
        return Promise.resolve({ ok: true });
      });

      webhookService.registerWebhook(ACCOUNT_ID, WEBHOOK_URL);

      await TrustlineChangeDetector.processTransactionEffects(
        ACCOUNT_ID,
        effects,
        "abc123"
      );

      expect(webhookPayloads[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe("Webhook Delivery Retry", () => {
    it("retries failed webhook deliveries", async () => {
      global.fetch
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce({ ok: true });

      webhookService.registerWebhook(ACCOUNT_ID, WEBHOOK_URL);

      const effects = [
        {
          type: "trustline_created",
          account: ACCOUNT_ID,
          asset_code: USDC_CODE,
          asset_issuer: ISSUER,
          asset_type: "credit_alphanum4",
        },
      ];

      await TrustlineChangeDetector.processTransactionEffects(
        ACCOUNT_ID,
        effects,
        "abc123"
      );

      expect(global.fetch).toHaveBeenCalled();
    });
  });
});
