"use strict";

const NodeCache = require("node-cache");

const _store = new NodeCache({ useClones: false });

/**
 * Get a cached value by key.
 * @param {string} key
 * @returns {any|undefined}
 */
function get(key) {
  return _store.get(key);
}

/**
 * Store a value with an optional TTL.
 * @param {string} key
 * @param {any} value
 * @param {number} [ttlSeconds=5]
 */
function set(key, value, ttlSeconds = 5) {
  _store.set(key, value, ttlSeconds);
}

/**
 * Delete a cached entry.
 * @param {string} key
 */
function del(key) {
  _store.del(key);
}

/**
 * Flush (clear) all cached entries.
 */
function flush() {
  _store.flushAll();
}

module.exports = { get, set, del, flush };
