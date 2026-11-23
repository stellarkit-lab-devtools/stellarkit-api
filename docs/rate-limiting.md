# Rate Limiting

StellarKit uses a **cost-based token-bucket** rate limiter. Each request is
charged a cost based on its route, and the total cost per window must not
exceed the budget.

## How it works

| Concept | Value |
|---|---|
| Budget per window | `RATE_LIMIT_BUDGET` (defaults to `RATE_LIMIT_MAX`, i.e. 100 for global, 500 per account) |
| Window duration | `RATE_LIMIT_WINDOW_MS` (default: 900000 ms / 15 min) |
| Client identification | `X-Account-ID` header (if present), otherwise `req.ip` |
| Default cost | 1 |
| Cache-hit refund | Down to cost 1 when `X-Cache: HIT` |

## Cost table

Costs are defined in `src/config/routeCosts.js`.

### Default cost (1)

All routes not listed below cost 1 per request.

### Aggregate / fan-out cost (5)

Endpoints that make multiple Horizon calls, scan large histories, or combine
several data sources:

| Method | Route pattern | Cost |
|---|---|---|
| GET | `/account/:id/counterparties` | 5 |
| GET | `/account/:id/pool-positions` | 5 |
| GET | `/account/:id/liquidity-contribution` | 5 |
| GET | `/account/:id/balance-velocity` | 5 |
| GET | `/account/:id/historical-balances` | 5 |
| GET | `/account/:id/reserve-breakdown` | 5 |
| GET | `/account/:id/summary` | 5 |
| GET | `/account/:id/timeline` | 5 |
| GET | `/account/:id/volume` | 5 |
| GET | `/account/:id/subentry-health` | 5 |
| GET | `/account/:id/operation-breakdown` | 5 |
| GET | `/account/:id/risk` | 5 |
| GET | `/account/:id/payment-counterparty-risk` | 5 |
| GET | `/account/:id/offers-summary` | 5 |
| GET | `/account/:id/merge-eligibility` | 5 |
| GET | `/account/:id/inactivity` | 5 |
| GET | `/account/:id/trustline-health` | 5 |
| POST | `/account/:id/multisig-plan` | 5 |
| GET | `/dex/arbitrage/:code/:issuer` | 5 |
| GET | `/dex/top-markets` | 5 |
| GET | `/dex/volume-leaders` | 5 |
| GET | `/asset/:code/:issuer/holders` | 5 |
| GET | `/network/soroban-stats` | 5 |
| GET | `/liquidity-pools/:id/profitability` | 5 |
| GET | `/liquidity-pools/:id/reserve-ratio` | 5 |
| GET | `/liquidity-pools/:id/activity` | 5 |

### Batch cost (item count)

Batch endpoints cost the number of items in the request body:

| Method | Route pattern | Body field | Cost |
|---|---|---|---|
| POST | `/accounts/native-balances` | `addresses` | `addresses.length` |
| POST | `/accounts/effects` | `addresses` | `addresses.length` |
| POST | `/accounts/trust-status` | `addresses` | `addresses.length` |
| POST | `/accounts/signers` | `addresses` | `addresses.length` |
| POST | `/accounts/transaction-counts` | `addresses` | `addresses.length` |
| POST | `/accounts/multisig-info` | `accountIds` | `accountIds.length` |
| POST | `/transactions/batch-status` | `hashes` | `hashes.length` |

## Cache-hit refund

When a response is served from cache (`X-Cache: HIT`), the charged cost is
refunded down to 1. This means cached responses only consume the default cost,
regardless of the route's nominal cost.

## Response headers

Every response includes:

| Header | Description |
|---|---|
| `X-RateLimit-Cost` | The cost charged for this request |
| `X-RateLimit-Limit` | The total budget for this client |
| `X-RateLimit-Remaining` | Remaining budget in the current window |
| `X-RateLimit-Reset` | ISO 8601 timestamp when the window resets |

When the budget is exhausted, the response is `429 Too Many Requests` with:

| Header | Description |
|---|---|
| `Retry-After` | Seconds until the window resets |

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `RATE_LIMIT_BUDGET` | `RATE_LIMIT_MAX` (100) | Token budget per window for requests without `X-Account-ID` |
| `RATE_LIMIT_MAX` | 100 | Legacy fallback for `RATE_LIMIT_BUDGET` |
| `ACCOUNT_RATE_LIMIT_MAX` | 500 | Token budget per window for requests with `X-Account-ID` |
| `RATE_LIMIT_WINDOW_MS` | 900000 (15 min) | Duration of the rate-limit window |

## Adding new routes

To assign a cost to a new route, add it to `src/config/routeCosts.js`:

- Add to `AGGREGATE_ROUTES` for cost-5 endpoints.
- Add to `BATCH_ROUTES` for batch endpoints (cost = body item count).
- If not listed, the route defaults to cost 1.
