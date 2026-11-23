const webhookDelivery = require("../src/services/webhookDelivery");
const axios = require("axios");

jest.mock("axios");

describe("Webhook Delivery Service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Zero out retry delays so tests run instantly without real waiting
    webhookDelivery._retryDelays = [0, 0, 0];
  });

  describe("triggerWebhooks", () => {
    it("should trigger all webhooks with the correct payload", async () => {
      const webhooks = [
        { id: "webhook_1", url: "https://example.com/webhook1" },
        { id: "webhook_2", url: "https://example.com/webhook2" },
      ];

      const payload = {
        event: "payment.received",
        accountId: "GAOZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
        payment: {
          type: "payment",
          amount: "100.0000000",
          asset: { code: "USDC", issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN", type: "credit_alphanum4" },
          from: "GACXLYNLCCNVR63LMBR2TBHVZ3XPRVVR5GVVGX7RXZC3C3KBQZ6QLXO",
          to: "GAOZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
          timestamp: "2024-01-01T12:00:00Z",
        },
        timestamp: "2024-01-01T12:00:01Z",
      };

      axios.post.mockResolvedValue({ status: 200 });

      const results = await webhookDelivery.triggerWebhooks(webhooks, payload);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
      expect(axios.post).toHaveBeenCalledTimes(2);
      expect(axios.post).toHaveBeenCalledWith(
        "https://example.com/webhook1",
        payload,
        expect.objectContaining({
          timeout: 30000,
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "X-Webhook-Event": "payment.received",
          }),
        })
      );
    });

    it("should handle empty webhook list", async () => {
      const payload = { event: "payment.received" };
      const results = await webhookDelivery.triggerWebhooks([], payload);

      expect(results).toEqual([]);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it("should handle null webhook list", async () => {
      const payload = { event: "payment.received" };
      const results = await webhookDelivery.triggerWebhooks(null, payload);

      expect(results).toEqual([]);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it("should retry failed deliveries and succeed on attempt 3", async () => {
      const webhooks = [{ id: "webhook_1", url: "https://example.com/webhook1" }];
      const payload = { event: "payment.received" };

      // First two calls fail, third succeeds
      axios.post
        .mockRejectedValueOnce(new Error("Network error"))
        .mockRejectedValueOnce(new Error("Timeout"))
        .mockResolvedValueOnce({ status: 200 });

      const results = await webhookDelivery.triggerWebhooks(webhooks, payload);

      expect(results[0].success).toBe(true);
      expect(results[0].attempt).toBe(3);
      expect(axios.post).toHaveBeenCalledTimes(3);
    });

    // Updated for new spec: 3 retries = 4 total attempts (attempt number = 4 on final failure)
    it("should fail after max retries (3 retries = 4 total attempts)", async () => {
      const webhooks = [{ id: "webhook_1", url: "https://example.com/webhook1" }];
      const payload = { event: "payment.received" };

      axios.post.mockRejectedValue(new Error("Network error"));

      const results = await webhookDelivery.triggerWebhooks(webhooks, payload);

      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe("Network error");
      // 4 total attempts: 1 initial + 3 retries
      expect(results[0].attempt).toBe(4);
      expect(axios.post).toHaveBeenCalledTimes(4);
    });

    it("should include correct headers in webhook request", async () => {
      const webhooks = [{ id: "webhook_1", url: "https://example.com/webhook" }];
      const payload = { event: "payment.received", accountId: "test" };

      axios.post.mockResolvedValue({ status: 200 });

      await webhookDelivery.triggerWebhooks(webhooks, payload);

      expect(axios.post).toHaveBeenCalledWith(
        "https://example.com/webhook",
        payload,
        expect.objectContaining({
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "StellarKit-Webhook/1.0",
            "X-Webhook-Event": "payment.received",
          },
        })
      );
    });

    it("should include webhook id and timestamp in result", async () => {
      const webhooks = [{ id: "webhook_123", url: "https://example.com/webhook" }];
      const payload = { event: "payment.received" };

      axios.post.mockResolvedValue({ status: 200 });

      const results = await webhookDelivery.triggerWebhooks(webhooks, payload);

      expect(results[0]).toMatchObject({
        webhookId: "webhook_123",
        url: "https://example.com/webhook",
        success: true,
        statusCode: 200,
      });
      expect(results[0].timestamp).toBeDefined();
    });
  });

  describe("deliverWebhook", () => {
    it("should successfully deliver a webhook", async () => {
      const webhook = { id: "webhook_1", url: "https://example.com/webhook" };
      const payload = { event: "payment.received" };

      axios.post.mockResolvedValue({ status: 200 });

      const result = await webhookDelivery.deliverWebhook(webhook, payload);

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.attempt).toBe(1);
    });

    // Updated: 3 retries = final attempt is 4, not 3
    it("should return error result on failed delivery after retries", async () => {
      const webhook = { id: "webhook_1", url: "https://example.com/webhook" };
      const payload = { event: "payment.received" };

      const error = new Error("Connection refused");
      axios.post.mockRejectedValue(error);

      const result = await webhookDelivery.deliverWebhook(webhook, payload);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Connection refused");
      // 1 initial + 3 retries = attempt 4 on permanent failure
      expect(result.attempt).toBe(4);
    });

    it("should track attempt number in result", async () => {
      const webhook = { id: "webhook_1", url: "https://example.com/webhook" };
      const payload = { event: "payment.received" };

      axios.post.mockResolvedValue({ status: 200 });

      const result = await webhookDelivery.deliverWebhook(webhook, payload, 2);

      expect(result.attempt).toBe(2);
    });
  });

  describe("Paused webhook filtering", () => {
    it("should skip paused webhooks during delivery", async () => {
      const webhooks = [
        { id: "webhook_1", url: "https://example.com/webhook1", status: "paused" },
        { id: "webhook_2", url: "https://example.com/webhook2", status: "active" },
      ];

      const payload = { event: "payment.received" };

      axios.post.mockResolvedValue({ status: 200 });

      const results = await webhookDelivery.triggerWebhooks(webhooks, payload);

      // Only the active webhook should be delivered
      expect(results).toHaveLength(1);
      expect(results[0].webhookId).toBe("webhook_2");
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(axios.post).toHaveBeenCalledWith(
        "https://example.com/webhook2",
        payload,
        expect.anything()
      );
    });

    it("should deliver to all active webhooks and skip paused ones", async () => {
      const webhooks = [
        { id: "webhook_1", url: "https://example.com/webhook1", status: "active" },
        { id: "webhook_2", url: "https://example.com/webhook2", status: "paused" },
        { id: "webhook_3", url: "https://example.com/webhook3", status: "active" },
        { id: "webhook_4", url: "https://example.com/webhook4", status: "paused" },
      ];

      const payload = { event: "payment.received" };

      axios.post.mockResolvedValue({ status: 200 });

      const results = await webhookDelivery.triggerWebhooks(webhooks, payload);

      // Only the two active webhooks should be delivered
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.webhookId)).toEqual(["webhook_1", "webhook_3"]);
      expect(axios.post).toHaveBeenCalledTimes(2);
    });

    it("should return empty array when all webhooks are paused", async () => {
      const webhooks = [
        { id: "webhook_1", url: "https://example.com/webhook1", status: "paused" },
        { id: "webhook_2", url: "https://example.com/webhook2", status: "paused" },
      ];

      const payload = { event: "payment.received" };

      axios.post.mockResolvedValue({ status: 200 });

      const results = await webhookDelivery.triggerWebhooks(webhooks, payload);

      expect(results).toEqual([]);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it("should treat webhooks without status field as active (backward compatibility)", async () => {
      const webhooks = [
        { id: "webhook_1", url: "https://example.com/webhook1" }, // No status field
        { id: "webhook_2", url: "https://example.com/webhook2", status: "active" },
      ];

      const payload = { event: "payment.received" };

      axios.post.mockResolvedValue({ status: 200 });

      const results = await webhookDelivery.triggerWebhooks(webhooks, payload);

      // Both should be delivered (one has no status, one is active)
      expect(results).toHaveLength(2);
      expect(axios.post).toHaveBeenCalledTimes(2);
    });
  });
});
