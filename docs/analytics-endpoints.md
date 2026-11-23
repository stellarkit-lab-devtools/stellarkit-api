# Account Analytics Endpoints Guide

StellarKit exposes a family of account analytics endpoints that answer different questions about the same account: how active is it, how much value moved, who it interacts with, and whether it looks suspicious. This guide groups them by use case, shows what each one returns, and ends with a worked example that combines them into an account health dashboard.

All examples use `http://localhost:3000`. Every endpoint returns the standard envelope `{ "success": true, "data": ... }` and `400 InvalidAccountId` for malformed keys plus `404 AccountNotFound` for unfunded accounts. See [Response Format](./response-format.md).

---

## Use cases at a glance

| Use case | Endpoints |
|---|---|
| Activity monitoring | `analytics`, `inactivity`, `timeline`, `transaction-stats`, `operation-breakdown` |
| Volume analysis | `volume`, `net-flow`, `payment-summary`, `transaction-count` |
| Compliance monitoring | `risk-score`, `payment-counterparty-risk`, `counterparties`, `inactivity` |

---

## Activity monitoring

### `GET /account/:id/analytics`

Lightweight activity summary: transaction frequency and first/last seen timestamps.

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/analytics"
```

```json
{
  "success": true,
  "data": {
    "totalSent": 0,
    "totalReceived": 0,
    "topAssets": [],
    "avgTransactionsPerDay": 1.33,
    "firstSeen": "2026-09-18T10:00:00.000Z",
    "lastSeen": "2026-09-21T10:00:00.000Z"
  }
}
```

Use when you need a single "how busy is this account" number without paging history. For burst detection, prefer `transaction-stats` below.

### `GET /account/:id/inactivity`

Days since the last transaction plus a status label.

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/inactivity"
```

```json
{
  "success": true,
  "data": {
    "lastTransactionAt": "2026-08-15T09:22:00.000Z",
    "lastTransactionHash": "abc123...",
    "daysSinceLastTransaction": 42,
    "status": "idle"
  }
}
```

Statuses: `"active"` (< 30 days), `"idle"` (30–180 days), `"dormant"` (> 180 days), `"no_transactions"` (never transacted). Use for churn, re-engagement, and dormancy compliance checks.

### `GET /account/:id/timeline`

Human-readable activity feed. Each operation becomes one feed item (`payment_sent`, `payment_received`, `account_created`, `trustline_added`, `offer_created`, `offer_removed`, …) with a description, amount, asset, and counterparty.

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/timeline?limit=20"
```

Query params: `limit`, `cursor`, `order` via standard pagination.

```json
{
  "success": true,
  "data": [
    {
      "id": "216532748304662529",
      "timestamp": "2026-09-20T14:32:11.000Z",
      "transactionHash": "abc123...",
      "type": "payment_received",
      "description": "Received 50.0000000 USDC from GBBD47...",
      "amount": "50.0000000",
      "asset": "USDC",
      "counterparty": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
    }
  ],
  "meta": { "count": 1, "limit": 20, "nextCursor": "216532748304662529-0", "hasMore": true }
}
```

Use for user-facing activity screens. For machine-readable audit trails, use `/transactions`, `/payments`, or `/effects` instead.

### `GET /account/:id/transaction-stats`

Success/failure counts and per-type totals over the most recent transactions.

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/transaction-stats?limit=50"
```

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "limit": 50,
    "counts": { "total": 12, "successful": 11, "failed": 1 },
    "firstSeenAt": "2026-09-18T10:00:00.000Z",
    "lastSeenAt": "2026-09-21T10:00:00.000Z",
    "byType": [
      { "category": "payment", "txCount": 10, "successfulCount": 10, "failedCount": 0, "totalFeeChargedXlm": "0.0010000" }
    ]
  }
}
```

Use as the fallback velocity signal: `averagePerDay = total / max(1, days between firstSeenAt and lastSeenAt)`. A high rate on a young account suggests burst behaviour (see the dashboard example).

### `GET /account/:id/operation-breakdown`

Distribution of operation types over the last 200 operations.

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/operation-breakdown"
```

```json
{
  "success": true,
  "data": {
    "total": 40,
    "breakdown": [
      { "type": "payment", "count": 30, "percentage": 75.0 },
      { "type": "change_trust", "count": 10, "percentage": 25.0 }
    ],
    "mostUsedOperation": "payment",
    "leastUsedOperation": "change_trust"
  }
}
```

Use to characterise accounts (payments-only wallet vs. active trader with many `manage_sell_offer` entries).

> Availability notes: there are no `GET /account/:id/transaction-velocity` or `GET /account/:id/activity-heatmap` routes in this deployment. Derive velocity from `/transaction-stats` (`counts.total`, `firstSeenAt`, `lastSeenAt`) or `/analytics` (`avgTransactionsPerDay`), and derive heatmaps by bucketing `/timeline` or `/transactions` timestamps client-side (see the [Compliance Workflow](./compliance-workflow.md) fallback pattern).

---

## Volume analysis

### `GET /account/:id/volume?days=30`

Total sent/received per asset over a window (`days` 1–90, default 30).

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/volume?days=30"
```

```json
{
  "success": true,
  "data": {
    "period": { "days": 30, "from": "2026-09-18T10:00:00.000Z", "to": "2026-10-18T10:00:00.000Z" },
    "totalTransactions": 12,
    "volumeByAsset": [
      {
        "asset": { "code": "USDC", "issuer": "GA5Z...", "type": "credit_alphanum4" },
        "totalSent": "500.0000000",
        "totalReceived": "750.0000000"
      }
    ]
  }
}
```

Use for "how much moved" questions. For direction-aware flow, use `net-flow` next.

### `GET /account/:id/net-flow?days=30`

Inbound, outbound, and net (`inbound − outbound`) per asset. Positive net means accumulation.

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/net-flow?days=30"
```

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "period": { "days": 30, "from": "2026-09-18T10:00:00.000Z", "to": "2026-10-18T10:00:00.000Z" },
    "flows": [
      {
        "asset": { "code": "USDC", "issuer": "GA5Z...", "type": "credit_alphanum4" },
        "inbound": "750.0000000",
        "outbound": "500.0000000",
        "net": "250.0000000"
      }
    ]
  }
}
```

Self-payments are excluded. Use for treasury tracking, accumulation/distribution detection, and inflow-outflow dashboards.

### `GET /account/:id/payment-summary`

Lifetime payment counts, volumes, top counterparty, and top asset.

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/payment-summary"
```

```json
{
  "success": true,
  "data": {
    "totalSent": 8,
    "totalReceived": 4,
    "volumeSent": "1000.0000000",
    "volumeReceived": "750.0000000",
    "topCounterparty": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    "topAsset": { "code": "USDC", "issuer": "GA5Z...", "type": "credit_alphanum4" }
  }
}
```

Use for KYC "source of funds" screens and wallet overviews. Pair with `counterparties` for the full counterparty list.

### `GET /account/:id/transaction-count`

Total transaction count plus first/last timestamps.

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/transaction-count"
```

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "count": 42,
    "firstSeen": "2025-11-20T10:00:00.000Z",
    "lastSeen": "2026-10-18T10:00:00.000Z"
  }
}
```

Cached for ~20 seconds. Use for sorting, ranking, and tenure displays.

---

## Compliance monitoring

### `GET /account/:id/risk-score`

Computed 0–100 score (higher is safer) with human-readable factors.

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/risk-score"
```

Ratings: `"low"` (≥ 70), `"medium"` (40–69), `"high"` (< 40). Keep the `factors` array for audit trails. See [Compliance Endpoints](./compliance-endpoints.md).

### `GET /account/:id/payment-counterparty-risk`

Top payment counterparties with per-counterparty risk levels.

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/payment-counterparty-risk?limit=10"
```

```json
{
  "success": true,
  "data": {
    "counterparties": [
      {
        "accountId": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        "txCount": 9,
        "riskLevel": "low",
        "riskFactors": ["established account"]
      }
    ]
  }
}
```

Query params: `limit` (default 10, max 20).

### `GET /account/:id/counterparties`

Frequent payment counterparties ranked by transaction count. Use when you need the raw ranking without risk labels.

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/counterparties"
```

> Availability note: there is no `GET /account/:id/payment-channels` route in this deployment. Derive channel-like insight from `/counterparties` (who), `/payment-summary` (top counterparty + volumes), and `/payment-counterparty-risk` (risk per counterparty). If you need per-channel volumes over time, bucket `/payments` by counterparty client-side.

---

## Worked example: account health dashboard

Combine one call from each group into a single health view: activity (is it alive?), volume (what moved?), compliance (should we worry?).

```javascript
// node account-health.js GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
const API_BASE = process.env.STELLARKIT_URL || "http://localhost:3000";

async function getData(path) {
  const res = await fetch(`${API_BASE}${path}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.type = body?.error?.type;
    throw err;
  }
  return body.data;
}

async function buildHealth(accountId) {
  const id = encodeURIComponent(accountId);

  // Independent — run in parallel.
  const [analytics, inactivity, volume, netFlow, risk, counterpartyRisk, stats] =
    await Promise.all([
      getData(`/account/${id}/analytics`),
      getData(`/account/${id}/inactivity`),
      getData(`/account/${id}/volume?days=30`),
      getData(`/account/${id}/net-flow?days=30`),
      getData(`/account/${id}/risk-score`),
      getData(`/account/${id}/payment-counterparty-risk?limit=5`),
      getData(`/account/${id}/transaction-stats?limit=50`),
    ]);

  const spanDays = stats.firstSeenAt
    ? Math.max(1, (Date.parse(stats.lastSeenAt) - Date.parse(stats.firstSeenAt)) / 86400000)
    : 1;
  const velocityPerDay = Number((stats.counts.total / spanDays).toFixed(2));

  const status = inactivity.status; // active | idle | dormant | no_transactions
  const health =
    risk.rating === "high" || status === "dormant" ? "needs-review"
    : risk.rating === "medium" || status === "idle" ? "watch"
    : "healthy";

  return {
    accountId,
    health,
    activity: {
      status,
      daysSinceLastTransaction: inactivity.daysSinceLastTransaction,
      avgTransactionsPerDay: analytics.avgTransactionsPerDay,
      velocityPerDay,
      lastSeen: analytics.lastSeen,
    },
    volume30d: {
      totalTransactions: volume.totalTransactions,
      byAsset: volume.volumeByAsset,
      netFlows: netFlow.flows,
    },
    compliance: {
      riskScore: risk.score,
      riskRating: risk.rating,
      topCounterparties: counterpartyRisk.counterparties ?? counterpartyRisk,
    },
  };
}

buildHealth(process.argv[2])
  .then((h) => console.log(JSON.stringify(h, null, 2)))
  .catch((err) => {
    if (err.type === "AccountNotFound") {
      console.log(JSON.stringify({ decision: "unknown", reason: "Account does not exist" }));
      return;
    }
    console.error("Health check failed:", err.message);
    process.exit(1);
  });
```

```bash
node account-health.js GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
```

```json
{
  "accountId": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
  "health": "healthy",
  "activity": {
    "status": "active",
    "daysSinceLastTransaction": 3,
    "avgTransactionsPerDay": 1.33,
    "velocityPerDay": 1.33,
    "lastSeen": "2026-09-21T10:00:00.000Z"
  },
  "volume30d": {
    "totalTransactions": 12,
    "byAsset": [{ "asset": { "code": "USDC" }, "totalSent": "500.0000000", "totalReceived": "750.0000000" }],
    "netFlows": [{ "asset": { "code": "USDC" }, "inbound": "750.0000000", "outbound": "500.0000000", "net": "250.0000000" }]
  },
  "compliance": { "riskScore": 80, "riskRating": "low", "topCounterparties": [] }
}
```

Tune the `health` rule to your policy — for example, treat `dormant + high velocity on return` as `needs-review` (possible takeover) rather than healthy.

---

## Related documentation

- [Account Endpoints](./account-endpoints.md) — full account reference
- [Tax Reporting Guide](./tax-reporting-guide.md) — trades, fees, historical balances
- [Compliance Endpoints](./compliance-endpoints.md) — risk and freeze checks
- [Compliance Workflow](./compliance-workflow.md) — end-to-end KYC/AML report
- [Response Format](./response-format.md) — envelopes and pagination
