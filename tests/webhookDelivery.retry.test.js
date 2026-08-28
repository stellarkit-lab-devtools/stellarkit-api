"use strict";

/**
 * Tests for WebhookDelivery retry logic
 *
 * Verifies:
 *   - Failed deliveries are retried up to 3 times with exponential backoff
 *     (5 s → 25 s → 125 s)
 *   - A successful retry stops further retries
 *   - After 3 failures the delivery is permanently failed
 *   - Permanent failure is logged with the webhook ID, URL, and last error
 *   - Network errors (axios throws) trigger retries, not just non-2xx
 *   - Non-2xx HTTP responses also trigger retries
 */

// Mock axios before requiring anything
jest.mock("axios");

const axios = require("axios");
const webhookDelivery = require("../src/services/webhookDelivery");

const WEBHOOK = { id: "wh_test_001", url: "https://example.com/hooks" };
const PAYLOAD = { event: "payment", data: { amount: "10.0000000" } };

beforeEach(() => {
  jest.clearAllMocks();
  // Zero out retry delays so tests run instantly
  webhookDelivery._retryDelays = [0, 0, 0];
});

// ── Successful delivery ───────────────────────────────────────────────────────

describe("WebhookDelivery.deliverWebhook — success path", () => {
  it("returns a success result on the first attempt", async () => {
    axios.post.mockResolvedValueOnce({ status: 200, data: {} });

    const result = await webhookDelivery.deliverWebhook(WEBHOOK, PAYLOAD);

    expect(result.success).toBe(true);
    expect(result.attempt).toBe(1);
    expect(result.webhookId).toBe(WEBHOOK.id);
    expect(result.url).toBe(WEBHOOK.url);
  });

  it("calls axios.post exactly once on first-attempt success", async () => {
    axios.post.mockResolvedValueOnce({ status: 200, data: {} });
    await webhookDelivery.deliverWebhook(WEBHOOK, PAYLOAD);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it("sends the payload as the request body", async () => {
    axios.post.mockResolvedValueOnce({ status: 200, data: {} });
    await webhookDelivery.deliverWebhook(WEBHOOK, PAYLOAD);
    expect(axios.post).toHaveBeenCalledWith(WEBHOOK.url, PAYLOAD, expect.any(Object));
  });
});

// ── Retry on failure ──────────────────────────────────────────────────────────

describe("WebhookDelivery.deliverWebhook — retry logic", () => {
  it("retries after a network error and succeeds on attempt 2", async () => {
    const networkError = new Error("ECONNREFUSED");
    axios.post
      .mockRejectedValueOnce(networkError)   // attempt 1 fails
      .mockResolvedValueOnce({ status: 200, data: {} }); // attempt 2 succeeds

    const result = await webhookDelivery.deliverWebhook(WEBHOOK, PAYLOAD);

    expect(result.success).toBe(true);
    expect(result.attempt).toBe(2);
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it("retries after a non-2xx response and succeeds on attempt 2", async () => {
    const serverError = new Error("Request failed with status code 500");
    serverError.response = { status: 500 };
    axios.post
      .mockRejectedValueOnce(serverError)
      .mockResolvedValueOnce({ status: 200, data: {} });

    const result = await webhookDelivery.deliverWebhook(WEBHOOK, PAYLOAD);

    expect(result.success).toBe(true);
    expect(result.attempt).toBe(2);
  });

  it("retries up to 3 times before permanently failing (4 total attempts)", async () => {
    const error = new Error("Service Unavailable");
    axios.post.mockRejectedValue(error);

    const result = await webhookDelivery.deliverWebhook(WEBHOOK, PAYLOAD);

    expect(result.success).toBe(false);
    // 4 total calls: initial + 3 retries
    expect(axios.post).toHaveBeenCalledTimes(4);
  });

  it("does NOT make a 5th attempt after 4 failures", async () => {
    const error = new Error("timeout");
    axios.post.mockRejectedValue(error);

    await webhookDelivery.deliverWebhook(WEBHOOK, PAYLOAD);

    expect(axios.post).toHaveBeenCalledTimes(4);
  });

  it("stops retrying immediately after a successful attempt", async () => {
    const error = new Error("fail");
    axios.post
      .mockRejectedValueOnce(error)  // attempt 1
      .mockRejectedValueOnce(error)  // attempt 2
      .mockResolvedValueOnce({ status: 200, data: {} }); // attempt 3 succeeds

    const result = await webhookDelivery.deliverWebhook(WEBHOOK, PAYLOAD);

    expect(result.success).toBe(true);
    expect(result.attempt).toBe(3);
    // Must NOT have made a 4th call
    expect(axios.post).toHaveBeenCalledTimes(3);
  });
});

// ── Exponential backoff delays ────────────────────────────────────────────────

describe("WebhookDelivery — exponential backoff timing", () => {
  beforeEach(() => {
    // Restore real delays for these timing tests
    webhookDelivery._retryDelays = [5000, 25000, 125000];
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    // Restore zero delays for all other tests
    webhookDelivery._retryDelays = [0, 0, 0];
  });

  it("waits 5 000 ms before the second attempt", async () => {
    const error = new Error("fail");
    axios.post
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ status: 200, data: {} });

    const deliveryPromise = webhookDelivery.deliverWebhook(WEBHOOK, PAYLOAD);

    // First call fires synchronously; advance past the 5 s delay
    await jest.advanceTimersByTimeAsync(5000);
    const result = await deliveryPromise;

    expect(result.success).toBe(true);
    expect(result.attempt).toBe(2);
  });

  it("waits 25 000 ms before the third attempt", async () => {
    const error = new Error("fail");
    axios.post
      .mockRejectedValueOnce(error)  // attempt 1 → 5 000 ms wait
      .mockRejectedValueOnce(error)  // attempt 2 → 25 000 ms wait
      .mockResolvedValueOnce({ status: 200, data: {} });

    const deliveryPromise = webhookDelivery.deliverWebhook(WEBHOOK, PAYLOAD);

    // After attempt 1 failure: wait 5 000 ms
    await jest.advanceTimersByTimeAsync(5000);
    // After attempt 2 failure: wait 25 000 ms
    await jest.advanceTimersByTimeAsync(25000);
    const result = await deliveryPromise;

    expect(result.success).toBe(true);
    expect(result.attempt).toBe(3);
  });

  it("waits 125 000 ms before the fourth attempt", async () => {
    const error = new Error("fail");
    axios.post
      .mockRejectedValueOnce(error)  // attempt 1 → 5 000 ms wait
      .mockRejectedValueOnce(error)  // attempt 2 → 25 000 ms wait
      .mockRejectedValueOnce(error)  // attempt 3 → 125 000 ms wait
      .mockResolvedValueOnce({ status: 200, data: {} });

    const deliveryPromise = webhookDelivery.deliverWebhook(WEBHOOK, PAYLOAD);

    await jest.advanceTimersByTimeAsync(5000);
    await jest.advanceTimersByTimeAsync(25000);
    await jest.advanceTimersByTimeAsync(125000);
    const result = await deliveryPromise;

    expect(result.success).toBe(true);
    expect(result.attempt).toBe(4);
  });

  it("the _retryDelays array encodes [5000, 25000, 125000]", () => {
    expect(webhookDelivery._retryDelays).toEqual([5000, 25000, 125000]);
  });
});

// ── Permanent failure ─────────────────────────────────────────────────────────

describe("WebhookDelivery — permanent failure after max retries", () => {
  it("returns { success: false } after all retries are exhausted", async () => {
    const error = new Error("Gateway Timeout");
    axios.post.mockRejectedValue(error);

    const result = await webhookDelivery.deliverWebhook(WEBHOOK, PAYLOAD);

    expect(result.success).toBe(false);
  });

  it("includes webhookId in the permanent failure result", async () => {
    axios.post.mockRejectedValue(new Error("fail"));
    const result = await webhookDelivery.deliverWebhook(WEBHOOK, PAYLOAD);
    expect(result.webhookId).toBe(WEBHOOK.id);
  });

  it("includes url in the permanent failure result", async () => {
    axios.post.mockRejectedValue(new Error("fail"));
    const result = await webhookDelivery.deliverWebhook(WEBHOOK, PAYLOAD);
    expect(result.url).toBe(WEBHOOK.url);
  });

  it("includes the last error message in the permanent failure result", async () => {
    const error = new Error("Connection refused");
    axios.post.mockRejectedValue(error);
    const result = await webhookDelivery.deliverWebhook(WEBHOOK, PAYLOAD);
    expect(result.error).toBe("Connection refused");
  });

  it("includes a timestamp in the permanent failure result", async () => {
    axios.post.mockRejectedValue(new Error("fail"));
    const result = await webhookDelivery.deliverWebhook(WEBHOOK, PAYLOAD);
    expect(typeof result.timestamp).toBe("string");
    expect(() => new Date(result.timestamp)).not.toThrow();
  });

  it("logs an error-level message after permanent failure", async () => {
    const logger = require("../src/utils/logger");
    const errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {});

    axios.post.mockRejectedValue(new Error("endpoint down"));

    await webhookDelivery.deliverWebhook(WEBHOOK, PAYLOAD);

    // logger.error should have been called at least once
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

// ── triggerWebhooks batch method ──────────────────────────────────────────────

describe("WebhookDelivery.triggerWebhooks", () => {
  it("returns an empty array when given an empty list", async () => {
    const results = await webhookDelivery.triggerWebhooks([], PAYLOAD);
    expect(results).toEqual([]);
  });

  it("returns an empty array when given null", async () => {
    const results = await webhookDelivery.triggerWebhooks(null, PAYLOAD);
    expect(results).toEqual([]);
  });

  it("delivers to all webhooks and returns one result per webhook", async () => {
    axios.post.mockResolvedValue({ status: 200, data: {} });

    const webhooks = [
      { id: "wh_1", url: "https://a.example.com" },
      { id: "wh_2", url: "https://b.example.com" },
    ];

    const results = await webhookDelivery.triggerWebhooks(webhooks, PAYLOAD);

    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(true);
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it("continues delivering to remaining webhooks when one fails permanently", async () => {
    // Use per-URL distinction by inspecting what url is called
    axios.post.mockImplementation((url) => {
      if (url === "https://fail.example.com") {
        return Promise.reject(new Error("fail"));
      }
      return Promise.resolve({ status: 200 });
    });

    const webhooks = [
      { id: "wh_1", url: "https://fail.example.com" },
      { id: "wh_2", url: "https://ok.example.com" },
    ];

    const results = await webhookDelivery.triggerWebhooks(webhooks, PAYLOAD);

    expect(results).toHaveLength(2);
    expect(results.find((r) => r.webhookId === "wh_1").success).toBe(false);
    expect(results.find((r) => r.webhookId === "wh_2").success).toBe(true);
  });
});
