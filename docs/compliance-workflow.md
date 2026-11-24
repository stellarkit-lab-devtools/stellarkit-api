# Compliance Workflow Guide (KYC/AML)

This guide shows how to chain StellarKit endpoints together into a complete KYC/AML workflow for a Stellar account: risk scoring, watchlist screening, transaction velocity analysis, an aggregated compliance check, freeze status verification, and finally a single compliance report your team can store or review.

For the full reference of each endpoint (all fields, error shapes, rate limits), see the [Compliance Endpoints Guide](./compliance-endpoints.md).

---

## Workflow at a Glance

```text
            ┌──────────────────────────────┐
            │  New account G... to onboard │
            └──────────────┬───────────────┘
                           │
   1. GET /account/:id/risk-score             → score, rating, factors
   2. GET /account/:id/watchlist-status       → onWatchlist, sources, reason
   3. GET /account/:id/transaction-velocity   → activity rate, burst detection
   4. GET /account/:id/compliance-check       → passed, recommendation
   5. GET /account/:id/freeze-check           → frozen trustlines
                           │
            ┌──────────────▼───────────────┐
            │  Compliance report:          │
            │  allow | review | deny       │
            └──────────────────────────────┘
```

Steps 1, 2, 3 and 5 are independent and can run in parallel. Step 4 is a server-side aggregate of risk score and freeze flags, so it is a useful cross-check rather than a replacement for the individual signals.

All examples use `http://localhost:3000`; replace it with your deployment's base URL. Every endpoint returns the standard envelope `{ "success": true, "data": { ... } }` and a `404 AccountNotFound` error when the account does not exist — treat a 404 as an automatic **deny** (or "unfunded account") in onboarding flows.

---

## Step 1: Account Risk Score

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/risk-score"
```

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "score": 35,
    "label": "high",
    "rating": "high",
    "factors": [
      { "name": "Account Age", "value": "3 days", "impact": "negative", "detail": "Account is very new (less than 1 month)" },
      { "name": "Home Domain", "value": "Not set", "impact": "neutral", "detail": "No home domain configured" },
      { "name": "Multi-signature", "value": "Single signer", "impact": "neutral", "detail": "Account uses single signature" },
      { "name": "Trustline Count", "value": "2 trustlines", "impact": "positive", "detail": "Low number of trustlines" },
      { "name": "Recent Activity", "value": "4 transactions in last limit", "impact": "positive", "detail": "Low recent transaction activity" }
    ]
  }
}
```

The score runs from 0 to 100, where **higher is safer**: `score >= 70` is `"low"` risk, `40–69` is `"medium"`, and below 40 is `"high"`.

**Decision logic**

| `rating` | Action |
| -------- | ------ |
| `low` | Continue |
| `medium` | Continue, mark for review if other signals are weak |
| `high` | Enhanced due diligence (EDD) required |

Keep the `factors` array — it is the human-readable justification auditors will ask for.

---

## Step 2: Watchlist Screening

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/watchlist-status"
```

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "onWatchlist": false,
    "sources": [],
    "reason": null,
    "checkedAt": "2026-10-18T10:30:00.000Z"
  }
}
```

The response is cached for 60 seconds and carries an `X-Cache: HIT | MISS` header. Pass `?fresh=true` to force a new lookup — do this at the moment of an onboarding decision so the report reflects a fresh screen.

**Decision logic**

- `onWatchlist === true` → **deny** (or escalate to your sanctions team); record `sources` and `reason`.
- `onWatchlist === false` → continue.

---

## Step 3: Transaction Velocity Analysis

Velocity analysis looks for unusual bursts of activity — for example a brand-new account that suddenly sends dozens of payments, a common pattern for mule accounts and structuring.

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/transaction-velocity"
```

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "transactionsLast24h": 4,
    "transactionsLast7d": 4,
    "averagePerDay": 0.57,
    "isBurst": false
  }
}
```

> **Availability note:** `/transaction-velocity` is part of the compliance roadmap. If your StellarKit deployment does not expose it yet (it returns `404 Not Found` for the route), derive velocity from [`GET /account/:id/transaction-stats`](./account-endpoints.md) — which returns `counts.total`, `firstSeenAt` and `lastSeenAt` for the most recent transactions — or from `GET /account/:id/analytics`, which returns average transactions per day. The worked example below shows that fallback.

**Decision logic**

- Many transactions in a short window on a young account → **review**.
- Normal, steady activity → continue.

---

## Step 4: Aggregated Compliance Check

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/compliance-check"
```

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "passed": false,
    "recommendation": "deny",
    "riskScore": 35,
    "riskRating": "high",
    "checks": {
      "riskScore": { "passed": false, "detail": "Risk rating is \"high\" (score: 35)" },
      "freezeFlags": { "passed": true, "frozenAssets": [] }
    }
  }
}
```

`recommendation` is `"allow"`, `"review"` or `"deny"`:

- any frozen trustline → `deny`
- `riskRating === "high"` → `deny`
- `riskRating === "medium"` → `review`
- otherwise → `allow`

Use this as the server's baseline recommendation, then let the watchlist and velocity signals escalate it (never downgrade it).

---

## Step 5: Freeze Status Verification

A frozen trustline means an issuer has revoked authorization for that asset on the account — often a sign the issuer itself has flagged the holder.

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/freeze-check"
```

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "isFrozen": false,
    "frozenAssets": []
  }
}
```

> **Availability note:** for an asset-specific check, use `GET /account/:id/freeze-status/:assetCode/:assetIssuer`, which returns `isFrozen`, `isAuthorized` and `canTransact` for one trustline. The account-wide list of frozen trustlines is also returned by Step 4 in `checks.freezeFlags.frozenAssets`, which the worked example uses as a fallback.

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/freeze-status/USDC/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
```

**Decision logic**

- Any frozen trustline → **deny** for flows involving that asset; record the asset list.
- None frozen → continue.

---

## Worked Example: Compliance Report for a New Account

The script below onboards a newly created account, runs all five checks, applies the decision logic above, and produces a single JSON compliance report. It uses Node.js 18+ (built-in `fetch`) and falls back gracefully when an optional endpoint is not available on your deployment.

```javascript
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

// Returns null instead of throwing when the route is not deployed.
async function getOptional(path) {
  try {
    return await getData(path);
  } catch (err) {
    if (err.status === 404 && err.type !== "AccountNotFound") return null;
    throw err;
  }
}

const SEVERITY = { allow: 0, review: 1, deny: 2 };
const escalate = (current, next) =>
  SEVERITY[next] > SEVERITY[current] ? next : current;

async function buildComplianceReport(accountId) {
  const id = encodeURIComponent(accountId);

  // Steps 1, 2, 3 and 5 are independent — run them in parallel.
  const [risk, watchlist, velocity, compliance, freeze] = await Promise.all([
    getData(`/account/${id}/risk-score`),
    getData(`/account/${id}/watchlist-status?fresh=true`),
    getOptional(`/account/${id}/transaction-velocity`),
    getData(`/account/${id}/compliance-check`),
    getOptional(`/account/${id}/freeze-check`),
  ]);

  // Velocity fallback: derive a rate from /transaction-stats
  let velocitySummary = velocity;
  if (!velocitySummary) {
    const stats = await getData(`/account/${id}/transaction-stats?limit=50`);
    const spanDays = stats.firstSeenAt
      ? Math.max(1, (Date.parse(stats.lastSeenAt) - Date.parse(stats.firstSeenAt)) / 86400000)
      : 1;
    const averagePerDay = stats.counts.total / spanDays;
    velocitySummary = {
      source: "transaction-stats",
      transactions: stats.counts.total,
      averagePerDay: Number(averagePerDay.toFixed(2)),
      isBurst: averagePerDay > 20,
    };
  }

  // Freeze fallback: use the frozen-asset list from /compliance-check
  const frozenAssets = freeze
    ? freeze.frozenAssets || []
    : compliance.checks.freezeFlags.frozenAssets;

  // ── Decision ───────────────────────────────────────────────────────────
  const reasons = [];
  let decision = compliance.recommendation; // server baseline

  if (risk.rating === "high") reasons.push(`High risk rating (score ${risk.score})`);

  if (watchlist.onWatchlist) {
    decision = escalate(decision, "deny");
    reasons.push(`On watchlist: ${watchlist.reason}`);
  }

  if (velocitySummary.isBurst) {
    decision = escalate(decision, "review");
    reasons.push(`Unusual transaction velocity (${velocitySummary.averagePerDay}/day)`);
  }

  if (frozenAssets.length > 0) {
    decision = escalate(decision, "deny");
    reasons.push(`Frozen trustlines: ${frozenAssets.join(", ")}`);
  }

  return {
    accountId,
    generatedAt: new Date().toISOString(),
    decision, // "allow" | "review" | "deny"
    reasons,
    checks: {
      riskScore: { score: risk.score, rating: risk.rating, factors: risk.factors },
      watchlist: {
        onWatchlist: watchlist.onWatchlist,
        sources: watchlist.sources,
        checkedAt: watchlist.checkedAt,
      },
      velocity: velocitySummary,
      complianceCheck: {
        passed: compliance.passed,
        recommendation: compliance.recommendation,
      },
      freeze: { frozenAssets },
    },
  };
}

buildComplianceReport(process.argv[2])
  .then((report) => console.log(JSON.stringify(report, null, 2)))
  .catch((err) => {
    if (err.type === "AccountNotFound") {
      console.log(JSON.stringify({
        accountId: process.argv[2],
        decision: "deny",
        reasons: ["Account does not exist on the network"],
      }, null, 2));
      return;
    }
    console.error("Compliance check failed:", err.message);
    process.exit(1);
  });
```

Run it against a freshly funded account:

```bash
node compliance-report.js GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
```

### Sample report

A three-day-old account with no home domain, not on any watchlist, low activity and no frozen trustlines:

```json
{
  "accountId": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
  "generatedAt": "2026-10-18T10:30:02.114Z",
  "decision": "deny",
  "reasons": ["High risk rating (score 35)"],
  "checks": {
    "riskScore": {
      "score": 35,
      "rating": "high",
      "factors": [
        { "name": "Account Age", "value": "3 days", "impact": "negative", "detail": "Account is very new (less than 1 month)" },
        { "name": "Home Domain", "value": "Not set", "impact": "neutral", "detail": "No home domain configured" }
      ]
    },
    "watchlist": { "onWatchlist": false, "sources": [], "checkedAt": "2026-10-18T10:30:01.870Z" },
    "velocity": { "source": "transaction-stats", "transactions": 4, "averagePerDay": 1.33, "isBurst": false },
    "complianceCheck": { "passed": false, "recommendation": "deny" },
    "freeze": { "frozenAssets": [] }
  }
}
```

New accounts very often score `"high"` simply because they are young. A common policy is to treat **new account + high risk + no other red flags** as `review` (request extra KYC documents) instead of a hard `deny`; adjust the decision block to match your own risk appetite.

---

## Operational Tips

- **Store the whole report**, not just the decision. Regulators expect you to show which signals were checked and when (`generatedAt`, `checkedAt`).
- **Re-screen periodically.** Watchlists and freeze flags change; re-run the workflow on a schedule or on each high-value payment.
- **Check counterparties too.** `GET /account/:id/payment-counterparty-risk` returns a risk level for each of an account's top payment counterparties, which helps spot accounts that mostly transact with risky addresses.
- **Mind rate limits.** One report costs five to six requests; see [Rate Limiting](./rate-limiting.md) and the batch endpoints in the [Batch Endpoints Guide](./batch-endpoints.md) when screening many accounts.

---

## Related Documentation

- [Compliance Endpoints Guide](./compliance-endpoints.md) — reference for every compliance endpoint
- [Account Endpoints Guide](./account-endpoints.md) — full list of account endpoints
- [Batch Endpoints Guide](./batch-endpoints.md) — batch freeze-status and trust-status checks
- [Error Reference](./error-reference.md) — error types and handling
