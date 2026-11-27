/**
 * mapLimit — bounded-concurrency async map.
 *
 * Runs `fn` over `items` with at most `limit` concurrent calls at a time.
 * Preserves input order in the returned results.
 *
 * @template T, R
 * @param {T[]} items - Input array.
 * @param {number} limit - Maximum number of concurrent fn calls.
 * @param {(item: T, index: number) => Promise<R>} fn - Async mapper function.
 * @param {{ settle?: boolean }} [options]
 *   - settle: when true, returns { status: "fulfilled", value } | { status: "rejected", reason }
 *     for every item instead of rejecting on the first error.
 * @returns {Promise<R[] | Array<{status:"fulfilled",value:R}|{status:"rejected",reason:any}>>}
 */
async function mapLimit(items, limit, fn, { settle = false } = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const results = new Array(items.length);
  let nextIndex = 0;
  let rejected = false;
  let firstError = null;

  async function runNext() {
    while (nextIndex < items.length) {
      if (!settle && rejected) return;

      const index = nextIndex;
      nextIndex += 1;

      try {
        const value = await fn(items[index], index);
        if (settle) {
          results[index] = { status: "fulfilled", value };
        } else {
          results[index] = value;
        }
      } catch (reason) {
        if (settle) {
          results[index] = { status: "rejected", reason };
        } else {
          rejected = true;
          firstError = reason;
          return;
        }
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => runNext(),
  );
  await Promise.all(workers);

  if (!settle && rejected) {
    throw firstError;
  }

  return results;
}

/** Default upstream concurrency limit (overridden by UPSTREAM_CONCURRENCY env var). */
const UPSTREAM_CONCURRENCY = (() => {
  const parsed = parseInt(process.env.UPSTREAM_CONCURRENCY, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 5;
})();

module.exports = { mapLimit, UPSTREAM_CONCURRENCY };
