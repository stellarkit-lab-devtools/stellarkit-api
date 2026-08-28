/**
 * In-process webhook registration store.
 *
 * Stores webhook registrations in a plain Map keyed by webhookId.
 * Each entry has the shape:
 *   {
 *     webhookId:    string,   // UUID-like unique identifier
 *     url:          string,   // Callback URL to deliver events to
 *     events:       string[], // Event types this webhook subscribes to
 *     accountId:    string|null, // Optional Stellar account this webhook is scoped to
 *     createdAt:    string,   // ISO 8601 creation timestamp
 *     registeredAt: string,   // Alias of createdAt (backward compatible)
 *   }
 *
 * This is an in-process store — data is lost on server restart.
 * For production use, replace the Map with a database-backed store.
 *
 * Usage:
 *   const store = require('./services/webhookStore');
 *   const wh = store.register({ url: 'https://...', events: ['payment'] });
 *   store.find(wh.webhookId);   // → entry
 *   store.remove(wh.webhookId); // → true | false
 *   store.list();               // → entry[]
 */

let _counter = 0;

/**
 * Generate a short unique ID.
 * In production this would be a UUID library call; we keep it dependency-free.
 *
 * @returns {string}
 */
function generateId() {
  _counter++;
  const rand = Math.random().toString(36).slice(2, 10);
  return `wh_${Date.now()}_${rand}_${_counter}`;
}

class WebhookStore {
  constructor() {
    /** @type {Map<string, object>} */
    this._store = new Map();
  }

  /**
   * Register a new webhook and return the stored entry.
   *
   * @param {{ url: string, events: string[], accountId?: string|null }} params
   * @returns {{ webhookId: string, url: string, events: string[], accountId: string|null, createdAt: string, registeredAt: string }}
   */
  register({ url, events, accountId }) {
    const webhookId    = generateId();
    const createdAt    = new Date().toISOString();
    const entry        = {
      webhookId,
      url,
      events: Array.isArray(events) ? events : [],
      accountId: accountId || null,
      createdAt,
      registeredAt: createdAt,
    };
    this._store.set(webhookId, entry);
    return entry;
  }

  /**
   * Find a webhook by ID.
   *
   * @param {string} webhookId
   * @returns {object|undefined}
   */
  find(webhookId) {
    return this._store.get(webhookId);
  }

  /**
   * Remove a webhook by ID.
   *
   * @param {string} webhookId
   * @returns {boolean} true when the entry existed and was removed, false when not found.
   */
  remove(webhookId) {
    return this._store.delete(webhookId);
  }

  /**
   * Return registered webhooks as an array.
   * When `accountId` is provided, only webhooks scoped to that account are returned.
   *
   * @param {string} [accountId]
   * @returns {object[]}
   */
  list(accountId) {
    const all = Array.from(this._store.values());
    if (!accountId) {
      return all;
    }
    return all.filter((entry) => entry.accountId === accountId);
  }

  /**
   * Remove every entry — used in tests.
   */
  clear() {
    this._store.clear();
  }

  /** Number of registered webhooks. */
  get size() {
    return this._store.size;
  }
}

module.exports = new WebhookStore();
