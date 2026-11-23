const webhookRegistry = require("../src/services/webhookRegistry");

describe("Webhook Registry", () => {
  beforeEach(() => {
    webhookRegistry.clear();
  });

  describe("register", () => {
    it("should register a new webhook", () => {
      const accountId = "GAOZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
      const eventType = "payment.received";
      const url = "https://example.com/webhook";

      const webhook = webhookRegistry.register(accountId, eventType, url);

      expect(webhook).toMatchObject({
        url,
        active: true,
      });
      expect(webhook.id).toBeDefined();
      expect(webhook.createdAt).toBeDefined();
    });

    it("should generate unique webhook IDs", () => {
      const accountId = "GAOZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
      const eventType = "payment.received";

      const webhook1 = webhookRegistry.register(accountId, eventType, "https://example.com/1");
      const webhook2 = webhookRegistry.register(accountId, eventType, "https://example.com/2");

      expect(webhook1.id).not.toBe(webhook2.id);
    });

    it("should allow multiple webhooks for the same event type", () => {
      const accountId = "GAOZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
      const eventType = "payment.received";

      webhookRegistry.register(accountId, eventType, "https://example.com/1");
      webhookRegistry.register(accountId, eventType, "https://example.com/2");

      const webhooks = webhookRegistry.getWebhooks(accountId, eventType);
      expect(webhooks).toHaveLength(2);
    });
  });

  describe("getWebhooks", () => {
    it("should return registered webhooks for an account and event type", () => {
      const accountId = "GAOZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
      const eventType = "payment.received";

      webhookRegistry.register(accountId, eventType, "https://example.com/1");
      webhookRegistry.register(accountId, eventType, "https://example.com/2");

      const webhooks = webhookRegistry.getWebhooks(accountId, eventType);

      expect(webhooks).toHaveLength(2);
      expect(webhooks[0].url).toBe("https://example.com/1");
      expect(webhooks[1].url).toBe("https://example.com/2");
    });

    it("should return only active webhooks", () => {
      const accountId = "GAOZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
      const eventType = "payment.received";

      const webhook1 = webhookRegistry.register(accountId, eventType, "https://example.com/1");
      const webhook2 = webhookRegistry.register(accountId, eventType, "https://example.com/2");

      webhookRegistry.unregister(accountId, webhook1.id);

      const webhooks = webhookRegistry.getWebhooks(accountId, eventType);
      expect(webhooks).toHaveLength(1);
      expect(webhooks[0].id).toBe(webhook2.id);
    });

    it("should return empty array for non-existent account", () => {
      const webhooks = webhookRegistry.getWebhooks("non-existent", "payment.received");
      expect(webhooks).toEqual([]);
    });

    it("should return empty array for non-existent event type", () => {
      const accountId = "GAOZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
      webhookRegistry.register(accountId, "payment.received", "https://example.com/webhook");

      const webhooks = webhookRegistry.getWebhooks(accountId, "other.event");
      expect(webhooks).toEqual([]);
    });
  });

  describe("unregister", () => {
    it("should deactivate a webhook", () => {
      const accountId = "GAOZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
      const eventType = "payment.received";

      const webhook = webhookRegistry.register(accountId, eventType, "https://example.com/webhook");
      const unregistered = webhookRegistry.unregister(accountId, webhook.id);

      expect(unregistered).toBe(true);
      const webhooks = webhookRegistry.getWebhooks(accountId, eventType);
      expect(webhooks).toHaveLength(0);
    });

    it("should return false for non-existent webhook", () => {
      const accountId = "GAOZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
      const unregistered = webhookRegistry.unregister(accountId, "non-existent");

      expect(unregistered).toBe(false);
    });

    it("should return false for non-existent account", () => {
      const unregistered = webhookRegistry.unregister("non-existent", "webhook_id");

      expect(unregistered).toBe(false);
    });
  });

  describe("getAllWebhooks", () => {
    it("should return all webhooks for an account", () => {
      const accountId = "GAOZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

      webhookRegistry.register(accountId, "payment.received", "https://example.com/1");
      webhookRegistry.register(accountId, "payment.received", "https://example.com/2");
      webhookRegistry.register(accountId, "trustline.created", "https://example.com/3");

      const allWebhooks = webhookRegistry.getAllWebhooks(accountId);

      expect(allWebhooks["payment.received"]).toHaveLength(2);
      expect(allWebhooks["trustline.created"]).toHaveLength(1);
    });

    it("should return empty object for non-existent account", () => {
      const allWebhooks = webhookRegistry.getAllWebhooks("non-existent");
      expect(allWebhooks).toEqual({});
    });

    it("should only return active webhooks", () => {
      const accountId = "GAOZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

      const webhook1 = webhookRegistry.register(accountId, "payment.received", "https://example.com/1");
      const webhook2 = webhookRegistry.register(accountId, "payment.received", "https://example.com/2");

      webhookRegistry.unregister(accountId, webhook1.id);

      const allWebhooks = webhookRegistry.getAllWebhooks(accountId);
      expect(allWebhooks["payment.received"]).toHaveLength(1);
      expect(allWebhooks["payment.received"][0].id).toBe(webhook2.id);
    });
  });
});
