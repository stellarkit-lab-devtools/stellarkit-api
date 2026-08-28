const logger = require("../utils/logger");

/**
 * In-memory webhook registry for storing webhook subscriptions.
 * In a production system, this would be backed by a database.
 *
 * Structure:
 * {
 *   "accountId": {
 *     "payment.received": [
 *       { id: "webhook-id", url: "https://example.com/webhook", active: true, createdAt: "..." }
 *     ]
 *   }
 * }
 */
class WebhookRegistry {
  constructor() {
    this.webhooks = {};
  }

  /**
   * Register a webhook for a specific event type on an account.
   * @param {string} accountId - The Stellar account ID
   * @param {string} eventType - The event type (e.g., "payment.received")
   * @param {string} url - The webhook URL to call
   * @returns {Object} The registered webhook object with id
   */
  register(accountId, eventType, url) {
    if (!this.webhooks[accountId]) {
      this.webhooks[accountId] = {};
    }

    if (!this.webhooks[accountId][eventType]) {
      this.webhooks[accountId][eventType] = [];
    }

    const webhook = {
      id: `webhook_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      url,
      active: true,
      createdAt: new Date().toISOString(),
    };

    this.webhooks[accountId][eventType].push(webhook);
    logger.info({ accountId, eventType, webhookId: webhook.id }, "Webhook registered");

    return webhook;
  }

  /**
   * Get all webhooks for a specific event type on an account.
   * @param {string} accountId - The Stellar account ID
   * @param {string} eventType - The event type (e.g., "payment.received")
   * @returns {Array} Array of webhook objects
   */
  getWebhooks(accountId, eventType) {
    if (!this.webhooks[accountId] || !this.webhooks[accountId][eventType]) {
      return [];
    }

    return this.webhooks[accountId][eventType].filter((w) => w.active);
  }

  /**
   * Unregister a webhook by ID.
   * @param {string} accountId - The Stellar account ID
   * @param {string} webhookId - The webhook ID
   * @returns {boolean} True if webhook was found and deactivated
   */
  unregister(accountId, webhookId) {
    if (!this.webhooks[accountId]) {
      return false;
    }

    for (const eventType in this.webhooks[accountId]) {
      const webhookIndex = this.webhooks[accountId][eventType].findIndex((w) => w.id === webhookId);
      if (webhookIndex !== -1) {
        this.webhooks[accountId][eventType][webhookIndex].active = false;
        logger.info({ accountId, webhookId }, "Webhook unregistered");
        return true;
      }
    }

    return false;
  }

  /**
   * Get all webhooks for an account.
   * @param {string} accountId - The Stellar account ID
   * @returns {Object} Object with event types as keys and webhook arrays as values
   */
  getAllWebhooks(accountId) {
    if (!this.webhooks[accountId]) {
      return {};
    }

    const result = {};
    for (const eventType in this.webhooks[accountId]) {
      result[eventType] = this.webhooks[accountId][eventType].filter((w) => w.active);
    }

    return result;
  }

  /**
   * Clear all webhooks (for testing).
   */
  clear() {
    this.webhooks = {};
  }
}

module.exports = new WebhookRegistry();
