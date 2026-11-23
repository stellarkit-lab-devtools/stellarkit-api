# Staying Within Rate Limits: A Practical Strategies Guide

Building a high-volume application on StellarKit API? This guide is for you. It turns the rate-limit rules from [Rate Limiting](rate-limiting.md) into concrete tactics: batching, caching, the `?fresh=true` escape hatch, which endpoints to poll and how often, and a copy-pasteable exponential-backoff client.

If you only read one section, skim the [Quick Checklist](#quick-checklist) at the bottom.

---

## Table of Contents

1. [Know your budget](#1-know-your-budget)
2. [Request batching](#2-request-batching)
3. [Lean on the caching layer](#3-lean-on-the-caching-layer)
4. [When to use `?fresh=true`](#4-when-to-use-freshtrue)
5. [Endpoint polling priority](#5-endpoint-polling-priority)
6. [Exponential backoff with jitter](#6-exponential-backoff-with-jitter)
7. [Quick checklist](#quick-checklist)

---

## 1. Know your budget

StellarKit applies per-IP rate limits. The defaults (see [Rate Limiting](rate-limiting.md#default-limits)) are:

| Limiter | Applies to | Default / 15 min |
| --- | --- | --- |
| Global | Every route except `/health` | 100 |
| Account summary | `GET /account/:id/summary` | 20 |
| Asset holders | `GET /asset/:code/:issuer/holders` | 10 |

That is roughly **6–7 requests per minute** on the global limiter before you start seeing `429`s. High-volume apps blow through that in seconds if they fan out one Horizon call per account. The rest of this guide is about doing more with fewer requests.

Treat a `429` as a *late* signal — by the time you receive one, you're already over budget. The headers on a `429` (`Retry-After`, `X-RateLimit-Reset`) tell you how long to wait, but the goal is to never need them.

---

## 2. Request batching

The single biggest lever. StellarKit exposes three batch endpoints that collapse many identical lookups into one HTTP call. Each batch runs its Horizon work in parallel on the server, so you also save wall-clock latency.

| Endpoint | Input | Cap | Replaces |
| --- | --- | --- | --- |
| `POST /accounts/trust-status` | `addresses` + `asset` | 30 | 30× `GET /account/:id/can-receive/...` |
| `POST /account/freeze-status` | `addresses` + `asset` | 20 | 20× `GET /account/:id/freeze-status/...` |
| `POST /transactions/batch-status` | `hashes` | 20 | 20× `GET /transactions/:id` |

See the [Batch Endpoints Guide](batch-endpoints.md) for full request/response shapes and per-entry error handling.

### Example: checking an airdrop allowlist

Naive — one request per address, 30 addresses = 30 requests (a third of your global budget gone in one operation):

```js
for (const address of allowlist) {
  const res = await fetch(
    `/account/${address}/can-receive/${code}/${issuer}`
  );
  // ...
}
```

Batched — one request for up to 30 addresses, **1 request** instead of 30:

```js
const res = await fetch("/accounts/trust-status", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    addresses: allowlist.slice(0, 30), // max 30 per call
    asset: { code: "USDC", issuer: ISSUER },
  }),
});
const { data } = await res.json();

for (const [address, row] of Object.entries(data.results)) {
  if (row.hasTrustline && row.isAuthorized) {
    // eligible for airdrop
  }
}
```

### Chunking oversized lists

If your list is larger than the cap, page it yourself in chunks — never send 200 keys in one body (it's rejected with `400`):

```js
async function checkTrustlines(addresses, asset) {
  const CHUNK = 30; // trust-status cap
  const out = {};
  for (let i = 0; i < addresses.length; i += CHUNK) {
    const slice = addresses.slice(i, i + CHUNK);
    const res = await fetch("/accounts/trust-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addresses: slice, asset }),
    });
    const { data } = await res.json();
    Object.assign(out, data.results);
  }
  return out;
}
```

### When *not* to batch

- You need a **single** account's full payload (signers, offers, operations) — the batch APIs return a slim row, not the full record. Use `GET /account/:id`.
- You're polling one in-flight transaction in a tight loop — a `GET /transactions/:id` is clearer than batching a list of one.
- You need fields the batch doesn't return (memos, effects, operations).

---

## 3. Lean on the caching layer

Every cached endpoint stores its Horizon response server-side for a TTL. A cache **HIT** serves instantly and still counts as one request against your rate limit, but it does *not* trigger a Horizon call — so it keeps the upstream healthy and your latency low. The trick is to **never poll faster than the cache TTL**, otherwise every call is a `MISS` that does real Horizon work.

### Detecting hits with `X-Cache`

Every cached response includes an `X-Cache` header:

```
X-Cache: HIT   → served from cache (fast, no Horizon call)
X-Cache: MISS  → fetched from Horizon and just cached
```

Log this header during development to see how often you're actually hitting Horizon. If you see `MISS` on every call, you're polling faster than the TTL.

### Per-endpoint TTL reference

A subset of the [Caching Strategy](caching-strategy.md#cached-endpoints-reference) table — the ones that matter for polling:

| Endpoint | Default TTL | Poll at most every… |
| --- | --- | --- |
| `/network-status`, `/network/base-fee`, `/network/fee-percentiles` | 5 s | 5 s |
| `/fee-estimate`, `/fee-estimate/surge-status`, `/fee-estimate/trends` | 5 s | 5 s |
| `/dex/arbitrage` | 5 s | 5 s |
| `/asset/:code/:issuer/price` | 5 s | 5 s |
| `/account/:id` | 10 s | 10 s |
| `/account/:id/sequence` | 20 s | 20 s |
| `/account/:id/transaction-count` | 20 s | 20 s |
| `/asset/:code/:issuer` (metadata) | 30 s | 30 s |
| `/asset/:code/:issuer/holders` | 30 s | 30 s |
| `/account/:id/effects` | 30 s | 30 s |
| `/network/validators` | 300 s | 5 min |
| `/dex/top-markets` | 60 s | 60 s |

Polling `/fee-estimate` every second wastes 4 of every 5 requests as `MISS`es that all return the same cached value after the first. Align your poll interval to the TTL.

### Client-side caching

For data that changes slowly (asset metadata, validators, TOML), cache it in your own process too. There's no point re-fetching `/asset/USDC/:issuer` every 30 seconds if your service only displays the issuer name on a dashboard that refreshes hourly.

---

## 4. When to use `?fresh=true`

Most cached endpoints accept `?fresh=true` to bypass the server cache and fetch live data from Horizon. It's an escape hatch, not a default — every `fresh=true` call is a `MISS` that does real Horizon work, so it's the most expensive request you can make against that endpoint.

### Use `fresh=true` when…

- **Right before submitting a transaction.** Fee estimates and the account sequence number must be current, or your transaction will fail with `tx_bad_seq` or an insufficient-fee error. A stale cached sequence is the #1 cause of submission failures.
- **Right after submitting a transaction.** To confirm the new sequence number or that a balance changed, bypass the cache so you don't see the pre-tx state.
- **Debugging suspected stale data.** If a value looks wrong, `fresh=true` tells you whether the cache is the problem.

### Do *not* use `fresh=true` when…

- **Rendering a user-facing dashboard.** Cached data is 5–30 s old at most; that's fine for display.
- **Running background jobs or bulk scans.** You don't need fresh data for every account in a 10k-address sweep.
- **Polling on a timer.** A scheduled poll with `fresh=true` defeats the cache on every tick.

### A practical pattern

Use the cache by default, and reach for `fresh=true` only in the narrow window around a transaction submission:

```js
// 1. Read with cache (cheap) for display
const account = await getAccount(address);

// 2. Bypass cache ONLY right before signing/submission
const freshSeq = await getSequence(address, { fresh: true });
const freshFee = await getFeeEstimate({ fresh: true });

// 3. Submit, then bypass cache once to confirm
await submitTx(builtTx);
const confirmed = await getAccount(address, { fresh: true });
```

That's at most 3 `fresh=true` calls per submission — a tiny fraction of your budget.

---

## 5. Endpoint polling priority

Not all endpoints deserve the same polling cadence. Group your polling by how time-sensitive the data is, and spend your budget on the tier-1 endpoints that actually need it.

### Tier 1 — Poll frequently (every ~5 s, aligned to TTL)

Time-sensitive data that drives transaction submission and real-time UX:

- `/fee-estimate` and `/fee-estimate/surge-status` — fee changes each ledger
- `/network-status` and `/network/base-fee` — ledger health and base fee
- `/dex/arbitrage` — opportunities expire in seconds

### Tier 2 — Poll occasionally (every 10–30 s)

State that changes on user action, not on every ledger:

- `/account/:id` — balances, after a transaction lands
- `/asset/:code/:issuer/price` — market price for display
- `/dex/spread/:sell/:buy`, `/dex/depth/:sell/:buy` — order book for a trading UI
- `/account/:id/sequence` — only if you're sequencing submissions

### Tier 3 — Fetch on demand (not on a timer)

Slow-changing or one-shot data — fetch once and cache client-side:

- `/asset/:code/:issuer` (metadata), `/asset/:code/:issuer/verify`, `/asset/:code/:issuer/distribution`
- `/account/:id/signers`, `/account/:id/analytics`, `/account/:id/risk-score`
- `/network/validators`, `/dex/top-markets`
- `/soroban/contract/:id` and its sub-endpoints

### Tier 4 — Don't poll; stream

For real-time updates, polling is the wrong tool entirely. Use the streaming endpoints instead:

- `/stream/transactions/:id` (SSE) — live transactions for an account
- `/stream/payments/:id` (SSE) — live payments for an account
- `/stream/ledgers` (WebSocket) — live ledger closes

Streaming pushes events as they happen with one long-lived connection, so it consumes far fewer rate-limit slots than polling. See the [Streaming Guide](streaming.md).

### Suggested budget allocation

For a wallet or dashboard app with a 100-request / 15-min global budget, a reasonable split is:

| Bucket | Requests / 15 min | What |
| --- | --- | --- |
| Fee + network polling | ~30 | `/fee-estimate`, `/network-status` every 30 s |
| Account state | ~20 | `/account/:id` after user activity |
| Batch checks | ~10 | one or two `/accounts/trust-status` batches |
| On-demand lookups | ~20 | asset metadata, verify, etc. |
| Headroom / retries | ~20 | buffer for backoff and spikes |

---

## 6. Exponential backoff with jitter

Even with batching and caching you'll occasionally hit a `429` (or a transient `5xx`). Handle it gracefully with exponential backoff plus jitter — never retry in a tight loop, and never retry at a fixed interval (synchronized retries from multiple clients create thundering-herd spikes).

### The rules

1. On a `429`, read `Retry-After` (seconds) or `X-RateLimit-Reset` (timestamp) and wait **at least** that long.
2. On a `5xx` or network error, wait an exponentially growing delay.
3. Add **jitter** (randomized spread) so concurrent clients don't retry in lockstep.
4. Cap the maximum delay so a failure doesn't pause your app for minutes.
5. Give up after a bounded number of attempts and surface the error.

### Complete implementation

```js
/**
 * Fetch wrapper with exponential backoff and jitter for StellarKit API.
 *
 * - Honours `Retry-After` on 429 responses.
 * - Retries 429, 5xx, and network errors with exponential backoff + jitter.
 * - Bounded max attempts; throws the last error when exhausted.
 *
 * @param {string} url     - The StellarKit API URL to fetch.
 * @param {Object} [opts]  - fetch options plus backoff controls.
 * @param {number} [opts.maxRetries=5]     - Max retry attempts after the first try.
 * @param {number} [opts.baseDelayMs=1000]  - Initial backoff delay.
 * @param {number} [opts.maxDelayMs=30000]  - Upper bound on a single delay.
 * @param {number} [opts.jitterMs=500]      - Max random jitter added to each delay.
 * @returns {Promise<Response>} The successful fetch Response.
 * @throws {Error} The last error if all attempts are exhausted.
 */
async function stellarkitFetch(url, opts = {}) {
  const {
    maxRetries = 5,
    baseDelayMs = 1000,
    maxDelayMs = 30_000,
    jitterMs = 500,
    ...fetchOpts
  } = opts;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, fetchOpts);

      // 429 — rate limited: honour Retry-After, then retry.
      if (res.status === 429) {
        const retryAfterSec = Number(res.headers.get("Retry-After"));
        const retryAfterMs =
          Number.isFinite(retryAfterSec) && retryAfterSec > 0
            ? retryAfterSec * 1000
            : Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);

        if (attempt === maxRetries) {
          throw Object.assign(new Error(`Rate limited after ${attempt + 1} attempts`), {
            status: 429,
            response: res,
          });
        }

        await sleep(retryAfterMs + Math.random() * jitterMs);
        continue;
      }

      // 5xx — transient server error: exponential backoff, then retry.
      if (res.status >= 500 && res.status < 600) {
        if (attempt === maxRetries) {
          throw Object.assign(new Error(`Server error ${res.status}`), {
            status: res.status,
            response: res,
          });
        }
        const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
        await sleep(delay + Math.random() * jitterMs);
        continue;
      }

      // 2xx / 3xx / 4xx (non-429) — return as-is for the caller to handle.
      return res;
    } catch (err) {
      // Network failure (ECONNRESET, ETIMEDOUT, DNS, etc.) — retry with backoff.
      const isNetworkError = err instanceof TypeError || err.code === "ECONNRESET" || err.code === "ETIMEDOUT";
      if (!isNetworkError && err.status !== 429 && err.status == null) {
        // A deliberate throw from above (e.g. exhausted 429) — re-raise.
        throw err;
      }
      lastError = err;
      if (attempt === maxRetries) break;
      const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      await sleep(delay + Math.random() * jitterMs);
    }
  }

  throw lastError || new Error(`Request to ${url} failed after ${maxRetries + 1} attempts`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { stellarkitFetch };
```

### Using it

```js
const { stellarkitFetch } = require("./stellarkitFetch");

// Normal cached call (honours cache automatically)
const res = await stellarkitFetch(`/asset/USDC/${ISSUER}`);
const { data } = await res.json();

// Bypass cache right before a transaction submission
const feeRes = await stellarkitFetch(`/fee-estimate?fresh=true`);
const fee = await feeRes.json();

// Batch call that retries on 429/5xx
const batchRes = await stellarkitFetch("/accounts/trust-status", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ addresses, asset }),
  maxRetries: 3,
});
```

### Why jitter matters

Without jitter, every client that received a `429` at the same instant retries at the exact same moment — re-triggering the limit in a synchronized wave. Adding `Math.random() * jitterMs` spreads retries across a window so load smooths out instead of spiking. This is called *full jitter* and it's the single most effective change you can make to a retry loop.

---

## Quick checklist

Run through this before shipping a high-volume integration:

- [ ] **Batched** multi-account lookups via `/accounts/trust-status`, `/account/freeze-status`, or `/transactions/batch-status` instead of N individual calls.
- [ ] **Poll interval ≥ cache TTL** for every cached endpoint (no faster than the values in the table above).
- [ ] **`?fresh=true` only** around transaction submission — never on a timer or background sweep.
- [ ] **Streaming** (`/stream/transactions/:id`, `/stream/payments/:id`, `/stream/ledgers`) instead of polling for live updates.
- [ ] **Exponential backoff with jitter** on every client (see the implementation above), honouring `Retry-After` on `429`.
- [ ] **Client-side cache** for slow-changing data (asset metadata, validators, TOML).
- [ ] **Budget headroom** — leave ~20% of your rate-limit budget for retries and spikes.

---

## Related Docs

- [Rate Limiting](rate-limiting.md) — default limits, configuration, `429` response shape, and headers
- [Batch Endpoints Guide](batch-endpoints.md) — full batch request/response reference and when to batch vs individual
- [Caching Strategy](caching-strategy.md) — per-endpoint TTLs, `X-Cache` header, and `CACHE_TTL_*` configuration
- [Streaming Guide](streaming.md) — SSE and WebSocket endpoints as a polling alternative
- [Error Reference](error-reference.md) — `RateLimitExceeded` and other error types
