"use strict";

/**
 * Single-flight (request coalescing) helper.
 *
 * Multiple concurrent requests for the same cache key share one upstream
 * promise instead of each issuing an identical Horizon call. The in-flight
 * entry is removed as soon as the promise settles (success *or* failure), so
 * errors reach every waiter but are never cached or reused by a later call.
 */
const inFlight = new Map();
let coalescedRequests = 0;

/**
 * Run `fn` once per key while a previous call for that key is still pending.
 *
 * @param {string} key - Cache key identifying the upstream call.
 * @param {() => Promise<any>} fn - Function producing the upstream result.
 * @returns {Promise<any>} The shared promise for this key.
 */
function singleFlight(key, fn) {
  const pending = inFlight.get(key);
  if (pending) {
    coalescedRequests++;
    return pending;
  }

  // Defer fn to a microtask so the map is always populated before it runs,
  // including when fn throws synchronously.
  const promise = Promise.resolve()
    .then(fn)
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

/** Number of requests that joined an existing in-flight call. */
function getCoalescedRequests() {
  return coalescedRequests;
}

/** Number of keys currently in flight (useful for leak assertions in tests). */
function getInFlightCount() {
  return inFlight.size;
}

/** Reset counters and map — intended for tests only. */
function reset() {
  inFlight.clear();
  coalescedRequests = 0;
}

module.exports = { singleFlight, getCoalescedRequests, getInFlightCount, reset };
