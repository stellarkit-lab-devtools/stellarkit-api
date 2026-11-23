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

/** Default window (ms) for collecting events into a single delivery batch. */
const DEFAULT_BATCH_WINDOW_MS = 500;

/**
 * Webhook delivery service.
 *
 * Handles sending webhook payloads to registered endpoints with:
 *   - Up to 3 retries on network errors or non-2xx responses
 *   - Exponential backoff: 5 s, 25 s, 125 s between retries
 *   - Permanent failure logging after all retries are exhausted
 *   - Batching: events for the same webhook fired within WEBHOOK_BATCH_WINDOW_MS
 *     (default 500 ms) of each other are collected and delivered as a single
 *     HTTP request with an `events` array, reducing overhead for high-volume
 *     accounts.
 */
class WebhookDelivery {
  constructor() {
    this.timeoutMs = 30000;
    // Allow tests to override delays without real waiting
    this._retryDelays = RETRY_DELAYS_MS;

    // Events fired for the same webhook within this window are collected
    // and delivered as a single HTTP request instead of one per event.
    this._batchWindowMs = Number(process.env.WEBHOOK_BATCH_WINDOW_MS) || DEFAULT_BATCH_WINDOW_MS;
    /**
     * Pending batches keyed by webhook id (falls back to url).
     * @type {Map<string, { webhook: Object, events: Array, resolvers: Array<Function>, timer: NodeJS.Timeout }>}
     */
    this._pendingBatches = new Map();
  }

  /**
   * Trigger webhook delivery for a list of registered webhooks.
   *
   * @param {Array} webhooks - Array of webhook objects with `id` and `url` properties.
   * @param {Object} payload - The event payload to send.
   * @returns {Promise<Array>} Array of delivery result objects.
   */
  matchesPaymentFilters(webhook, payment) {
    if (!webhook || !payment) {
      return false;
    }

    if (webhook.minAmount !== undefined && webhook.minAmount !== null && webhook.minAmount !== "") {
      const paymentAmount = Number(payment.amount ?? payment.starting_balance ?? 0);
      if (!Number.isFinite(paymentAmount) || paymentAmount < Number(webhook.minAmount)) {
        return false;
      }
    }

    if (webhook.assetCode !== undefined && webhook.assetCode !== null && webhook.assetCode !== "") {
      const code = payment.asset && payment.asset.code ? payment.asset.code : (payment.assetCode || payment.asset_code || "");
      if (!String(code || "").trim() || String(code).toUpperCase() !== String(webhook.assetCode).trim().toUpperCase()) {
        return false;
      }
    }

    if (webhook.assetIssuer !== undefined && webhook.assetIssuer !== null && webhook.assetIssuer !== "") {
      const issuer = payment.asset && payment.asset.issuer ? payment.asset.issuer : (payment.assetIssuer || payment.asset_issuer || "");
      if (!String(issuer || "").trim() || String(issuer) !== String(webhook.assetIssuer).trim()) {
        return false;
      }
    }

    return true;
  }

  async triggerWebhooks(webhooks, payload) {
    if (!webhooks || webhooks.length === 0) {
      return [];
    }

    // Filter out paused webhooks
    const activeWebhooks = webhooks.filter((webhook) => webhook.status !== "paused");
    if (activeWebhooks.length === 0) {
      return [];
    }

    const filteredWebhooks = payload && payload.payment
      ? activeWebhooks.filter((webhook) => this.matchesPaymentFilters(webhook, payload.payment))
      : activeWebhooks;

    if (filteredWebhooks.length === 0) {
      return [];
    }

    const deliveryPromises = filteredWebhooks.map((webhook) =>
      this._enqueueForBatch(webhook, payload),
    );

    return Promise.all(deliveryPromises);
  }

  /**
   * Queue an event payload for a webhook, batching it with any other events
   * for the same webhook that arrive within `_batchWindowMs`.
   *
   * The first event for a webhook opens the batch window; every subsequent
   * event for that same webhook arriving before the window closes is
   * collected into the same batch. When the window closes, a single event
   * is delivered with its original (unwrapped) payload shape for backward
   * compatibility; two or more events are delivered as one request with an
   * `{ events: [...] }` body.
   *
   * @param {Object} webhook - Webhook object with `id` and `url` properties.
   * @param {Object} payload - The event payload to send.
   * @returns {Promise<Object>} Resolves with the shared delivery result once
   *   the batch containing this event has been flushed.
   */
  _enqueueForBatch(webhook, payload) {
    const key = webhook.id ?? webhook.url;

    let batch = this._pendingBatches.get(key);
    if (!batch) {
      batch = { webhook, events: [], resolvers: [] };
      batch.timer = setTimeout(() => this._flushBatch(key), this._batchWindowMs);
      this._pendingBatches.set(key, batch);
    }

    batch.events.push(payload);
    return new Promise((resolve) => {
      batch.resolvers.push(resolve);
    });
  }

  /**
   * Deliver a pending batch of events for one webhook and resolve every
   * caller that queued an event into it with the shared result.
   *
   * @param {string} key - The batch key (webhook id or url) to flush.
   * @returns {Promise<void>}
   */
  async _flushBatch(key) {
    const batch = this._pendingBatches.get(key);
    if (!batch) return;
    this._pendingBatches.delete(key);

    const { webhook, events, resolvers } = batch;
    const deliveryPayload = events.length === 1 ? events[0] : { event: "batch", events };

    const result = await this.deliverWebhook(webhook, deliveryPayload);
    resolvers.forEach((resolve) => resolve(result));
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
