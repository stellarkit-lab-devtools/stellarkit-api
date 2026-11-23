/**
 * Route cost table for the token-bucket rate limiter.
 *
 * The default cost is 1.  Fan-out and aggregate endpoints that make multiple
 * Horizon calls or combine many data sources cost 5.  Batch endpoints cost
 * their item count (determined from the request body).
 *
 * Costs are matched against the raw request path before route handlers run,
 * so patterns use regexes against `req.path`.
 */

/** Cost charged for aggregate / fan-out endpoints. */
const AGGREGATE_COST = 5;

/**
 * Aggregate and fan-out routes (cost 5).
 *
 * These endpoints make multiple Horizon calls per request, scan large
 * histories, or combine several data sources into one response.
 */
const AGGREGATE_ROUTES = [
  // Account aggregate endpoints
  { method: "GET", pattern: /^\/account\/[^/]+\/counterparties$/ },
  { method: "GET", pattern: /^\/account\/[^/]+\/pool-positions$/ },
  { method: "GET", pattern: /^\/account\/[^/]+\/liquidity-contribution$/ },
  { method: "GET", pattern: /^\/account\/[^/]+\/balance-velocity$/ },
  { method: "GET", pattern: /^\/account\/[^/]+\/historical-balances$/ },
  { method: "GET", pattern: /^\/account\/[^/]+\/reserve-breakdown$/ },
  { method: "GET", pattern: /^\/account\/[^/]+\/summary$/ },
  { method: "GET", pattern: /^\/account\/[^/]+\/timeline$/ },
  { method: "GET", pattern: /^\/account\/[^/]+\/volume$/ },
  { method: "GET", pattern: /^\/account\/[^/]+\/subentry-health$/ },
  { method: "GET", pattern: /^\/account\/[^/]+\/operation-breakdown$/ },
  { method: "GET", pattern: /^\/account\/[^/]+\/risk$/ },
  { method: "GET", pattern: /^\/account\/[^/]+\/payment-counterparty-risk$/ },
  { method: "GET", pattern: /^\/account\/[^/]+\/offers-summary$/ },
  { method: "GET", pattern: /^\/account\/[^/]+\/merge-eligibility$/ },
  { method: "GET", pattern: /^\/account\/[^/]+\/inactivity$/ },
  { method: "GET", pattern: /^\/account\/[^/]+\/trustline-health$/ },
  { method: "POST", pattern: /^\/account\/[^/]+\/multisig-plan$/ },

  // DEX fan-out endpoints
  { method: "GET", pattern: /^\/dex\/arbitrage\/[^/]+\/[^/]+$/ },
  { method: "GET", pattern: /^\/dex\/top-markets$/ },
  { method: "GET", pattern: /^\/dex\/volume-leaders$/ },

  // Asset fan-out endpoints
  { method: "GET", pattern: /^\/asset\/[^/]+\/[^/]+\/holders$/ },

  // Network aggregate endpoints
  { method: "GET", pattern: /^\/network\/soroban-stats$/ },

  // Liquidity pool aggregate endpoints
  { method: "GET", pattern: /^\/liquidity-pools\/[^/]+\/profitability$/ },
  { method: "GET", pattern: /^\/liquidity-pools\/[^/]+\/reserve-ratio$/ },
  { method: "GET", pattern: /^\/liquidity-pools\/[^/]+\/activity$/ },
];

/**
 * Batch endpoints — cost equals the number of items in the request body.
 *
 * `bodyField` is the property name of the array in `req.body`.
 */
const BATCH_ROUTES = [
  { method: "POST", pattern: /^\/accounts\/native-balances$/, bodyField: "addresses" },
  { method: "POST", pattern: /^\/accounts\/effects$/, bodyField: "addresses" },
  { method: "POST", pattern: /^\/accounts\/trust-status$/, bodyField: "addresses" },
  { method: "POST", pattern: /^\/accounts\/signers$/, bodyField: "addresses" },
  { method: "POST", pattern: /^\/accounts\/transaction-counts$/, bodyField: "addresses" },
  { method: "POST", pattern: /^\/accounts\/multisig-info$/, bodyField: "accountIds" },
  { method: "POST", pattern: /^\/transactions\/batch-status$/, bodyField: "hashes" },
];

/**
 * Determine the rate-limit cost for a request.
 *
 * @param {import('express').Request} req
 * @returns {number} The cost to charge against the token bucket.
 */
function getRouteCost(req) {
  // Check batch routes first (cost = item count from body)
  for (const route of BATCH_ROUTES) {
    if (req.method === route.method && route.pattern.test(req.path)) {
      const body = req.body || {};
      const arr = body[route.bodyField];
      if (Array.isArray(arr) && arr.length > 0) {
        return arr.length;
      }
      return 1;
    }
  }

  // Check aggregate routes (cost 5)
  for (const route of AGGREGATE_ROUTES) {
    if (req.method === route.method && route.pattern.test(req.path)) {
      return AGGREGATE_COST;
    }
  }

  // Default cost
  return 1;
}

module.exports = { getRouteCost, AGGREGATE_COST };
