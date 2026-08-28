const axios = require("axios");
const logger = require("../utils/logger");

/**
 * Exponential backoff delays for webhook retries (in milliseconds).
 *
 * Attempt 1 failure → wait 5 000 ms  (5^1)
 * Attempt 2 failure → wait 25 000 ms (5^2)
 * Attempt 3 failure → wait 125 000 ms (5^3)
 *
 * After the third failed attempt the delivery is permanently marked as failed.
 */
const RETRY_DELAYS_MS = [5000, 25000, 125000];
const MAX_ATTEMPTS = 4; // 1 initial + 3 retries

/**
 * Webhook delivery service.
 *
 * Handles sending webhook payloads to registered endpoints with:
 *   - Up to 3 retries on network errors or non-2xx responses
 *   - Exponential backoff: 5 s, 25 s, 125 s between retries
 *   - Permanent failure logging after all retries are exhausted
 */
class WebhookDelivery {
  constructor() {
    this.timeoutMs = 30000;
    // Allow tests to override delays without real waiting
    this._retryDelays = RETRY_DELAYS_MS;
  }

  /**
   * Trigger webhook delivery for a list of registered webhooks.
   *
   * @param {Array} webhooks - Array of webhook objects with `id` and `url` properties.
   * @param {Object} payload - The event payload to send.
   * @returns {Promise<Array>} Array of delivery result objects.
   */
  async triggerWebhooks(webhooks, payload) {
    if (!webhooks || webhooks.length === 0) {
      return [];
    }

    const deliveryPromises = webhooks.map((webhook) =>
      this.deliverWebhook(webhook, payload),
    );

    return Promise.all(deliveryPromises);
  }

  /**
   * Attempt to deliver a single webhook payload, retrying on failure with
   * exponential backoff.
   *
   * Retry schedule (based on attempt number that just failed):
   *   Attempt 1 fails → wait 5 000 ms, then attempt 2
   *   Attempt 2 fails → wait 25 000 ms, then attempt 3
   *   Attempt 3 fails → wait 125 000 ms, then attempt 4
   *   Attempt 4 fails → permanently failed, no more retries
   *
   * A delivery is considered failed when:
   *   - axios throws (network error, connection refused, timeout), OR
   *   - The destination returns a non-2xx HTTP status code
   *
   * @param {Object} webhook - Webhook object with `id` and `url` properties.
   * @param {Object} payload - The event payload to send.
   * @param {number} [attempt=1] - Current attempt number (1-indexed, internal use).
   * @returns {Promise<Object>} Delivery result object.
   */
  async deliverWebhook(webhook, payload, attempt = 1) {
    let lastError = null;
    let lastResponse = null;

    try {
      const response = await axios.post(webhook.url, payload, {
        timeout: this.timeoutMs,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "StellarKit-Webhook/1.0",
          "X-Webhook-Event": payload.event,
        },
        // Treat non-2xx as errors so we can retry them
        validateStatus: (status) => status >= 200 && status < 300,
      });

      logger.info(
        {
          webhookId: webhook.id,
          url: webhook.url,
          statusCode: response.status,
          attempt,
        },
        "Webhook delivered successfully",
      );

      return {
        webhookId: webhook.id,
        url: webhook.url,
        success: true,
        statusCode: response.status,
        attempt,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      lastError = error;
      // Capture status from non-2xx axios errors (response was received but status failed)
      lastResponse = (error && error.response) ? error.response : null;
    }

    // Determine if we have retries left.
    // attempt is 1-indexed; we allow MAX_ATTEMPTS total (1 initial + 3 retries).
    const retriesRemaining = MAX_ATTEMPTS - attempt;

    if (retriesRemaining > 0) {
      // retryIndex is 0-based: attempt 1 failure → index 0 → 5 000 ms
      const retryIndex = attempt - 1;
      const delayMs = this._retryDelays[retryIndex] ?? this._retryDelays[this._retryDelays.length - 1];

      logger.warn(
        {
          webhookId: webhook.id,
          url: webhook.url,
          attempt,
          retriesRemaining,
          delayMs,
          error: lastError.message,
          statusCode: lastResponse ? lastResponse.status : null,
        },
        "Webhook delivery failed, retrying...",
      );

      await new Promise((resolve) => setTimeout(resolve, delayMs));

      return this.deliverWebhook(webhook, payload, attempt + 1);
    }

    // All retries exhausted — permanently failed
    logger.error(
      {
        webhookId: webhook.id,
        url: webhook.url,
        lastError: lastError.message,
        statusCode: lastResponse ? lastResponse.status : null,
      },
      "Webhook delivery permanently failed after 3 retries",
    );

    return {
      webhookId: webhook.id,
      url: webhook.url,
      success: false,
      error: lastError.message,
      statusCode: lastResponse ? lastResponse.status : null,
      attempt,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Deliver a contract event payload to all relevant webhook subscribers.
   * Delegates to triggerWebhooks with the contract event payload.
   *
   * @param {Object} payload - Normalised contract.event payload.
   * @returns {Promise<void>}
   */
  async deliverContractEvent(payload) {
    // Contract event delivery is fire-and-forget at the poller level.
    // This stub allows contractEventPoller to call deliverContractEvent
    // without error; production implementations would look up subscribers
    // from a registry and trigger delivery.
    if (process.env.NODE_ENV !== "test") {
      logger.debug({ contractId: payload.contractId }, "Contract event delivery skipped (no subscriber registry)");
    }
  }
}

module.exports = new WebhookDelivery();
