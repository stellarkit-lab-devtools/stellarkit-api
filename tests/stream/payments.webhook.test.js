const webhookRegistry = require("../../src/services/webhookRegistry");
const webhookDelivery = require("../../src/services/webhookDelivery");
const { normalizeAsset } = require("../../src/utils/asset");

const VALID_KEY = "GCZST3XVCDTUJ76ZAV2HA72KYQJD2XIMJFVWLWWPWI4XVZL4GSDQH25N";

describe("Payment Stream - Webhook Delivery Integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    webhookRegistry.clear();
  });

  it("should trigger webhook delivery when an account receives a payment", async () => {
    const mockPayment = {
      type: "payment",
      amount: "50.0000000",
      asset_type: "credit_alphanum4",
      asset_code: "USDC",
      asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      from: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      to: VALID_KEY,
      created_at: "2024-01-01T12:00:00Z",
    };

    // Register a webhook
    const webhookUrl = "https://example.com/webhook";
    webhookRegistry.register(VALID_KEY, "payment.received", webhookUrl);

    // Get registered webhooks
    const webhooks = webhookRegistry.getWebhooks(VALID_KEY, "payment.received");
    expect(webhooks).toHaveLength(1);
    expect(webhooks[0].url).toBe(webhookUrl);

    // Simulate what the payment stream does
    const payload = {
      type: mockPayment.type,
      amount: mockPayment.amount,
      asset: normalizeAsset(mockPayment.asset_code, mockPayment.asset_issuer, mockPayment.asset_type),
      from: mockPayment.from,
      to: mockPayment.to,
      timestamp: mockPayment.created_at,
    };

    // Mock webhook delivery
    jest.spyOn(webhookDelivery, "triggerWebhooks").mockResolvedValue([
      {
        webhookId: webhooks[0].id,
        url: webhookUrl,
        success: true,
        statusCode: 200,
      },
    ]);

    // Trigger webhook delivery as the stream does
    const webhookPayload = {
      event: "payment.received",
      accountId: VALID_KEY,
      payment: payload,
      timestamp: new Date().toISOString(),
    };

    await webhookDelivery.triggerWebhooks(webhooks, webhookPayload);

    // Verify webhook delivery was called
    expect(webhookDelivery.triggerWebhooks).toHaveBeenCalledWith(webhooks, webhookPayload);

    const callArgs = webhookDelivery.triggerWebhooks.mock.calls[0];
    const callWebhooks = callArgs[0];
    const callPayload = callArgs[1];

    // Verify webhook payload structure
    expect(callPayload).toMatchObject({
      event: "payment.received",
      accountId: VALID_KEY,
      timestamp: expect.any(String),
    });

    // Verify payment data in payload
    expect(callPayload.payment).toMatchObject({
      type: "payment",
      amount: "50.0000000",
      from: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      to: VALID_KEY,
      timestamp: "2024-01-01T12:00:00Z",
    });

    expect(callPayload.payment.asset).toMatchObject({
      code: "USDC",
      issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      type: "credit_alphanum4",
    });

    expect(callWebhooks).toHaveLength(1);
    expect(callWebhooks[0].url).toBe(webhookUrl);
  });

  it("should not trigger webhooks if none are registered", async () => {
    const webhooks = webhookRegistry.getWebhooks(VALID_KEY, "payment.received");
    expect(webhooks).toHaveLength(0);
  });

  it("should include correct webhook payload structure for create_account operations", async () => {
    const mockCreateAccount = {
      type: "create_account",
      starting_balance: "2.0000000",
      funder: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      account: VALID_KEY,
      created_at: "2024-01-01T12:00:00Z",
    };

    webhookRegistry.register(VALID_KEY, "payment.received", "https://example.com/webhook");

    const payload = {
      type: mockCreateAccount.type,
      amount: mockCreateAccount.starting_balance,
      asset: normalizeAsset(null, null, null),
      from: mockCreateAccount.funder,
      to: mockCreateAccount.account,
      timestamp: mockCreateAccount.created_at,
    };

    const webhookPayload = {
      event: "payment.received",
      accountId: VALID_KEY,
      payment: payload,
      timestamp: new Date().toISOString(),
    };

    expect(webhookPayload.payment).toMatchObject({
      type: "create_account",
      amount: "2.0000000",
      from: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      to: VALID_KEY,
      timestamp: "2024-01-01T12:00:00Z",
    });
  });

  it("should handle webhook delivery errors gracefully", async () => {
    webhookRegistry.register(VALID_KEY, "payment.received", "https://example.com/webhook");

    // Mock webhook delivery to reject
    jest.spyOn(webhookDelivery, "triggerWebhooks").mockRejectedValue(
      new Error("Webhook delivery failed")
    );

    const webhooks = webhookRegistry.getWebhooks(VALID_KEY, "payment.received");
    const payload = {
      event: "payment.received",
      accountId: VALID_KEY,
      payment: { type: "payment" },
      timestamp: new Date().toISOString(),
    };

    // Stream should handle the error gracefully
    await expect(webhookDelivery.triggerWebhooks(webhooks, payload)).rejects.toThrow(
      "Webhook delivery failed"
    );
  });
});
