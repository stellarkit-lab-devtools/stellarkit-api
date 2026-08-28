const logger = require("../utils/logger");

/**
 * In-memory webhook registry and delivery service.
 * Stores webhook subscriptions and triggers deliveries for trustline events.
 */
class WebhookService {
  constructor() {
    // Map of accountId -> { url, events: ["trustline.changed"], ...}
    this.webhooks = new Map();
    this.webhookId = 0;
  }

  /**
   * Register a webhook for an account and event type.
   * @param {string} accountId - Stellar account ID
   * @param {string} url - Webhook delivery URL
   * @param {string[]} events - Event types to subscribe to
   * @returns {object} Registered webhook with id
   */
  registerWebhook(accountId, url, events = ["trustline.changed"]) {
    if (!accountId || !url) {
      throw new Error("accountId and url are required");
    }

    const webhookId = ++this.webhookId;
    const key = accountId;

    if (!this.webhooks.has(key)) {
      this.webhooks.set(key, []);
    }

    const webhook = {
      id: webhookId,
      accountId,
      url,
      events,
      createdAt: new Date().toISOString(),
      deliveryCount: 0,
      lastDeliveryAt: null,
    };

    this.webhooks.get(key).push(webhook);
    logger.debug(`Webhook registered: ${accountId} -> ${url}`);
    return webhook;
  }

  /**
   * Get all webhooks for an account.
   * @param {string} accountId - Stellar account ID
   * @returns {object[]} Array of webhooks
   */
  getWebhooksForAccount(accountId) {
    return this.webhooks.get(accountId) || [];
  }

  /**
   * Trigger delivery for trustline change event.
   * @param {string} accountId - Account that had trustline change
   * @param {object} payload - Event payload
   * @returns {Promise<void>}
   */
  async triggerTrustlineWebhooks(accountId, payload) {
    const webhooks = this.getWebhooksForAccount(accountId);

    for (const webhook of webhooks) {
      if (!webhook.events.includes("trustline.changed")) continue;

      await this.deliverWebhook(webhook, payload);
    }
  }

  /**
   * Deliver webhook with exponential backoff retry.
   * @param {object} webhook - Webhook configuration
   * @param {object} payload - Event payload
   * @returns {Promise<void>}
   */
  async deliverWebhook(webhook, payload) {
    const maxAttempts = 3;
    const delays = [5000, 10000]; // 5s, 10s

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await fetch(webhook.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          timeout: 10000,
        });

        if (response.ok) {
          webhook.deliveryCount++;
          webhook.lastDeliveryAt = new Date().toISOString();
          logger.debug(`Webhook delivered: ${webhook.id} to ${webhook.url}`);
          return;
        }

        logger.warn(
          `Webhook delivery failed (${response.status}): ${webhook.id}`
        );

        if (attempt < maxAttempts - 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, delays[attempt] || 10000)
          );
        }
      } catch (err) {
        logger.warn(`Webhook delivery error: ${webhook.id} - ${err.message}`);

        if (attempt < maxAttempts - 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, delays[attempt] || 10000)
          );
        } else {
          logger.error(
            `Webhook delivery failed after ${maxAttempts} attempts: ${webhook.id}`
          );
        }
      }
    }
  }

  /**
   * Delete a webhook.
   * @param {string} accountId - Stellar account ID
   * @param {number} webhookId - Webhook ID to delete
   * @returns {boolean} True if deleted
   */
  deleteWebhook(accountId, webhookId) {
    const webhooks = this.webhooks.get(accountId);
    if (!webhooks) return false;

    const index = webhooks.findIndex((w) => w.id === webhookId);
    if (index === -1) return false;

    webhooks.splice(index, 1);
    logger.debug(`Webhook deleted: ${webhookId}`);
    return true;
  }

  /**
   * Clear all webhooks (for testing).
   */
  clear() {
    this.webhooks.clear();
    this.webhookId = 0;
  }
}

// Export singleton instance
module.exports = new WebhookService();
