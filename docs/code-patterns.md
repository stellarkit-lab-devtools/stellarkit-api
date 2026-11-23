# Code Patterns Guide

Every StellarKit endpoint follows the same five patterns. Code review catches it when they're missed, but by then you have to rework the route. Read this before you add an endpoint, and check your route against the [checklist](#checklist) before you open a PR.

Each section shows the wrong approach, the correct one, and the helper to use.

| # | Pattern | Use |
|---|---|---|
| 1 | [Horizon instance usage](#1-horizon-instance-usage) | `server`, `horizonUrl`, `sorobanServer` from [`src/config/stellar.js`](../src/config/stellar.js) |
| 2 | [Response envelope shape](#2-response-envelope-shape) | `success()` from [`src/utils/response.js`](../src/utils/response.js) |
| 3 | [Amount formatting](#3-amount-formatting) | `formatAmount()` from [`src/utils/formatAmount.js`](../src/utils/formatAmount.js), `parseStellarAmount()` from [`src/utils/parseStellarAmount.js`](../src/utils/parseStellarAmount.js) |
| 4 | [Cache integration](#4-cache-integration) | `cacheService` from [`src/services/cache.js`](../src/services/cache.js), TTLs from [`src/config/cacheConfig.js`](../src/config/cacheConfig.js) |
| 5 | [Error handling flow](#5-error-handling-flow) | Validators from [`src/utils/validators.js`](../src/utils/validators.js), [`StellarKitError`](../src/utils/StellarKitError.js), the [`errorHandler`](../src/middleware/errorHandler.js) middleware |

---

## 1. Horizon instance usage

**Rule:** Never construct your own `Horizon.Server` or `rpc.Server`. Import the shared instances from `src/config/stellar.js`.

The shared instance is built from `STELLAR_NETWORK` and `HORIZON_URL`, so it follows the deployment's network. Every test mocks this module (`jest.mock("../../src/config/stellar", ...)`). A route that creates its own server ignores the configured network, and it calls the live network during tests.

### ❌ Wrong

```js
const { Horizon } = require("@stellar/stellar-sdk");

// Hard-coded to testnet, invisible to jest.mock, and a new client per module
const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");

router.get("/:id/thing", async (req, res, next) => {
  const account = await horizon.loadAccount(req.params.id);
  // ...
});
```

### ✅ Correct

```js
const { server } = require("../config/stellar");

router.get("/:id/thing", async (req, res, next) => {
  try {
    const account = await withHorizonTiming(req, () => server.loadAccount(req.params.id));
    // ...
  } catch (err) {
    next(err);
  }
});
```

### Related helpers

- `server`: the shared `Horizon.Server`.
- `horizonUrl`: the configured Horizon base URL. Use it only for raw `fetch()` calls to endpoints the SDK doesn't wrap. Never hard-code the URL.
- `sorobanServer`: the shared Soroban `rpc.Server`. It is `null` when no RPC URL is configured, so check for that first. In `src/routes/soroban.js`, call `requireSorobanServer()` to get it.
- `NETWORK`: the active network name. Use it in error messages.
- `withHorizonTiming(req, fn)`: wraps a Horizon call so that the request log includes `horizonResponseTimeMs`. Each route file defines it. Wrap every Horizon call in it.

---

## 2. Response envelope shape

**Rule:** Send every success response with `success(res, data)`. Never build an error response by hand. Pass the error to `next(err)` and let the error handler format it.

Clients rely on one envelope everywhere:

```jsonc
// success
{ "success": true, "data": { ... } }

// error (built by the errorHandler middleware)
{ "success": false, "error": { "type": "...", "message": "...", "suggestion": "..." }, "requestId": "..." }
```

### ❌ Wrong

```js
// Bare payload: no envelope, so clients can't branch on `success`
res.json({ balance: account.balances[0].balance });

// A different envelope with its own key names
res.status(200).send({ ok: true, result: data });

// Hand-built error: no requestId, not counted in /metrics, and not sanitised in production
res.status(400).json({ error: "bad limit" });
```

### ✅ Correct

```js
const { success } = require("../utils/response");

return success(res, { accountId: id, balance });

// Optional top-level metadata, e.g. for pagination
return success(res, records, { pagination: { cursor, limit } });
```

### Related helpers

- `success(res, data, meta?)`: builds the success envelope.
- `toISOTimestamp(value)`: use it for every timestamp field so that dates are always ISO 8601.
- `stripLinks(record)`: removes Horizon `_links` before you return a raw record.

> A few older handlers still build their own error bodies, for example the `limit` check in `/network/ledger-history`. Don't copy them. New code throws, as described in [pattern 5](#5-error-handling-flow).

---

## 3. Amount formatting

**Rule:** Return every asset amount as a **seven-decimal string**, such as `"12.5000000"`. Never return a JavaScript number. When you add amounts together, add integer stroops, not floats.

Stellar amounts have exactly seven decimal places. JavaScript numbers can't hold that exactly: `0.1 + 0.2` is `0.30000000000000004`. A number also drops trailing zeros, so clients receive `"12.5"` from one endpoint and `"12.5000000"` from another.

### ❌ Wrong

```js
// Float output: 12.5, not "12.5000000"
balance: parseFloat(b.balance),

// Manual stroop conversion, repeated in every route that needs it
feeXLM: (feeStroops / 10000000).toString(),          // "0.00001"

// Float accumulation: drift appears after a few additions
const total = offers.reduce((sum, o) => sum + parseFloat(o.amount), 0);
```

### ✅ Correct

```js
const { formatAmount } = require("../utils/formatAmount");
const { parseStellarAmount } = require("../utils/parseStellarAmount");

// A Horizon decimal string (or number) normalised to 7 decimals
balance: formatAmount(b.balance),                    // "12.5000000"

// Integer stroops converted to an XLM string
feeXLM: parseStellarAmount(feeStroops),              // "0.0000100"
```

To sum amounts, convert each one to integer stroops, add them as `BigInt` (or as `Number` while totals stay below `Number.MAX_SAFE_INTEGER`), and format the total once at the end. `/account/:id/offers-summary` in [`src/routes/account.js`](../src/routes/account.js) shows the full approach, including exact price ratios from `price_r`.

### Related helpers

- `formatAmount(value)`: takes a decimal string or number and returns a seven-decimal string. It rounds half-up and leaves blank or non-numeric input unchanged.
- `parseStellarAmount(stroops)`: takes integer stroops and returns a seven-decimal XLM string.
- `normalizeAmountFields()` in `src/utils/response.js`: a safety net that `src/index.js` applies to every response. It only formats keys that end in `amount`, `balance`, `price`, `fee` or `liabilities`. Keys such as `feeRevenueXLM` or `lockedValue` pass through as they are, so don't rely on it. Format amounts in the route.

---

## 4. Cache integration

**Rule:** Cache an endpoint's result with the shared `cacheService` whenever it can safely be reused for a few seconds. Set `X-Cache: HIT` or `X-Cache: MISS` on every response, support `?fresh=true`, and read the TTL from `cacheConfig`.

Monitoring, rate-limit tuning and the `/cache/stats` endpoint all use the `X-Cache` header and the shared hit and miss counters. A private `NodeCache` doesn't appear in any of them, and an endpoint without `?fresh=true` can't be read live right after a transaction.

### ❌ Wrong

```js
const NodeCache = require("node-cache");
const myCache = new NodeCache();                     // a private cache that /cache/stats can't see

router.get("/:id/thing", async (req, res, next) => {
  const cached = myCache.get(req.params.id);         // key has no endpoint namespace, so it can collide
  if (cached) return success(res, cached);           // no X-Cache header and no way to bypass

  const data = await buildThing(req.params.id);
  myCache.set(req.params.id, data, 30);              // magic TTL that can't be changed per deployment
  return success(res, data);
});
```

### ✅ Correct

```js
const cacheService = require("../services/cache");
const cacheTTL = require("../config/cacheConfig");

router.get("/:id/thing", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);                           // validate before you touch the cache

    const cacheKey = `thing:${id}`;                  // "<endpoint>:<variable parts>"
    const fresh = req.query.fresh === true || req.query.fresh === "true";

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    const data = await buildThing(req, id);

    cacheService.set(cacheKey, data, cacheTTL.thing); // only successful results are cached
    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    next(err);
  }
});
```

To add a TTL, put an entry in `src/config/cacheConfig.js` with an environment override (`CACHE_TTL_THING_MS`), document the variable in the file's header comment, and add a row to [caching-strategy.md](caching-strategy.md).

### Related helpers

- `cacheService.get(key)` and `cacheService.set(key, value, ttlSeconds)`: the shared cache. Its hits and misses are reported by `/cache/stats`.
- `cacheTTL.<name>`: per-endpoint TTLs in seconds, each with a default and an environment override.
- `coerceQueryParams` middleware: turns `"true"` into `true`, so check `fresh` against both forms as the example does.

> Never cache errors. If you cache a 404 or a timeout, clients get it again until the TTL expires.

---

## 5. Error handling flow

**Rule:** Validate input with `src/utils/validators.js`. Throw `StellarKitError` for domain errors. Send everything else to `next(err)`. The `errorHandler` middleware is the only code that writes error responses.

The handler already knows how to translate each kind of error:

| Thrown error | Response |
|---|---|
| A Horizon or SDK error with `response.data` | Status mapped from the Horizon result code, with a human-readable translation |
| `ECONNREFUSED`, `ENOTFOUND` or `ECONNRESET` | `503 HorizonUnavailable` |
| A Horizon timeout | `504 HorizonTimeout` |
| `StellarKitError` | Its own `statusCode`, `type` and `suggestion` |
| `makeAccountNotFoundError()` | `404 AccountNotFound` |
| Anything else | `500`, with the message sanitised in production |

The handler also adds the `requestId`, records error metrics per endpoint, and logs at the right level. A route that builds its own error response skips all of that.

### ❌ Wrong

```js
router.get("/:id/thing", async (req, res) => {
  if (!req.params.id.startsWith("G")) {              // home-made validation
    return res.status(400).json({ error: "bad id" });
  }
  try {
    const account = await server.loadAccount(req.params.id);
    // ...
  } catch (err) {
    // Every failure becomes a 500. A missing account (404) and a Horizon
    // timeout (504) both disappear, and internal messages can leak to clients.
    res.status(500).json({ error: err.message });
  }
});
```

### ✅ Correct

```js
const { validateAccountId, validateLimit } = require("../utils/validators");
const StellarKitError = require("../utils/StellarKitError");

router.get("/:id/thing", async (req, res, next) => {
  try {
    const { id } = req.params;
    validateAccountId(id);                           // throws a structured 400
    const limit = validateLimit(req.query.limit ?? 20, 200);

    const account = await withHorizonTiming(req, () => server.loadAccount(id));

    if (!account.home_domain) {
      throw new StellarKitError(
        "Account has no home domain set.",
        422,
        "HomeDomainMissing",
        null,
        "Set a home domain with a setOptions operation and try again.",
      );
    }

    return success(res, { accountId: id, limit, homeDomain: account.home_domain });
  } catch (err) {
    handleAccountNotFound(err, next, req.params.id); // account routes; elsewhere use next(err)
  }
});
```

### Related helpers

- `validateAccountId`, `validateContractId`, `validateLimit`, `validateAsset`, `validateCursor` and `validateISODate`: each throws a structured `ValidationError` (400) that names the field, the value received and the expected format.
- `StellarKitError(message, statusCode, type, detail?, suggestion?)`: use it for any error that has a specific status and type.
- `makeAccountNotFoundError(accountId, network)` in [`src/utils/errors.js`](../src/utils/errors.js), and `handleAccountNotFound(err, next, id)` in `src/routes/account.js`: these turn a Horizon 404 into `404 AccountNotFound`.
- [error-reference.md](error-reference.md): the list of existing error types. Reuse one of them before you invent a new type.

---

## Checklist

Before you open a PR for a new endpoint, check that:

- [ ] Horizon and Soroban calls use `server` and `sorobanServer` from `src/config/stellar.js`, wrapped in `withHorizonTiming`
- [ ] Success responses go through `success(res, data)`
- [ ] Every amount is a seven-decimal string from `formatAmount` or `parseStellarAmount`, and sums are done in stroops
- [ ] The endpoint uses `cacheService` with a namespaced key, a TTL from `cacheConfig`, `X-Cache: HIT` or `MISS`, and `?fresh=true`, unless the data must never be cached
- [ ] Input is validated with `src/utils/validators.js`, domain errors throw `StellarKitError`, and the `catch` block calls `next(err)`
- [ ] Tests mock `src/config/stellar` and cover success, empty results, and the 400 and 404 paths

See also: [Project Structure](project-structure.md) · [Testing Guide](testing.md) · [Response Format](response-format.md) · [Caching Strategy](caching-strategy.md) · [Error Reference](error-reference.md)
