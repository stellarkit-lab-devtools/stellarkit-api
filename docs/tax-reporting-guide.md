# Stellar Tax Reporting Guide

Tax tools built on Stellar need the same raw inputs as any crypto tax engine: every taxable event (payments, trades, conversions), the fees paid to execute them, and periodic balances to reconcile against. This guide shows which StellarKit endpoints to use for each input and how to combine them.

> This guide covers data collection only. It does not provide tax advice. Cost-basis methods (FIFO, LIFO, HIFO, specific identification) and taxable-event definitions vary by jurisdiction — confirm with a tax professional.

All examples use `http://localhost:3000`; replace it with your deployment's base URL. Every endpoint returns the standard envelope `{ "success": true, "data": ... }`. See [Response Format](./response-format.md).

---

## Endpoint map

| Tax input | Endpoint | Why |
|---|---|---|
| Full transaction history | `GET /account/:id/transactions` | Every transaction with fee, memo, success flag; `?type=` filters to one operation type |
| Payment and conversion legs | `GET /account/:id/payments` | Payments plus `path_payment_*` legs with `sourceAsset`/`sourceAmount` — the cross-asset view |
| DEX trades (both sides + price) | `GET /account/:id/trades` | Sold/bought amounts and execution price per trade |
| Cross-asset conversions | Payments endpoint filtered to `path_payment_*` (see below) | No separate route is needed |
| Fee spending by operation type | `GET /account/:id/fee-spending` | Total and average fees paid, broken down by operation type |
| Balance snapshots for reconciliation | `GET /account/:id/historical-balances` | Reconstructed snapshots; approximations, not ledger truth |

---

## 1. Transaction history — `GET /account/:id/transactions`

Paginated history with fee and memo per transaction.

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/transactions?limit=50&order=asc"
```

Query params: `limit` (default 20, max 200), `order` (`asc`|`desc`), `cursor`, `type` (for example `?type=payment`, `?type=path_payment_strict_send`).

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "12884905984",
        "hash": "3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c1234",
        "ledger": 52834901,
        "createdAt": "2026-09-20T14:32:11.000Z",
        "sourceAccount": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
        "fee": { "charged": "100", "chargedInXLM": "0.0000100" },
        "operationCount": 1,
        "memoType": "none",
        "memo": null,
        "successful": true
      }
    ],
    "total": 1,
    "limit": 50,
    "cursor": "12884905984-1"
  }
}
```

**Tax use:** walk the full history with `order=asc` and cursor pagination to build the chronological event ledger. Keep `hash`, `createdAt`, `successful`, and `fee.chargedInXLM` for every entry. Filter with `?type=payment` when you only want payment-containing transactions.

> Note: `GET /transactions/:id` (under `/transactions`) also returns history for an **account address** — `:id` there is an account, not a transaction hash. It is the same data source as the account route; prefer the `/account/:id/transactions` form in new tax code.

---

## 2. Trades — `GET /account/:id/trades`

Normalized DEX trades showing both sides from the account's perspective.

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/trades?limit=50&order=asc"
```

Query params: `limit`, `order`, `cursor`, `startDate` / `endDate` (ISO 8601 on `ledgerCloseTime`), `fresh`.

```json
{
  "success": true,
  "data": {
    "trades": [
      {
        "tradeId": "216532748304662529-0",
        "ledgerCloseTime": "2026-09-20T14:32:11Z",
        "selling": { "code": "XLM", "issuer": null, "type": "native" },
        "buying": { "code": "USDC", "issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN", "type": "credit_alphanum4" },
        "soldAmount": "100.0000000",
        "boughtAmount": "8.5000000",
        "price": "0.0850000",
        "offerId": "12345"
      }
    ]
  },
  "meta": { "count": 1, "limit": 50, "order": "asc", "nextCursor": "216532748304662529-0", "hasMore": false }
}
```

**Tax use:** each trade is a disposal (sold asset) plus an acquisition (bought asset) at `ledgerCloseTime`. Record `soldAmount`, `boughtAmount`, and `price` — these are the inputs to the cost-basis example below. Use `startDate`/`endDate` to pull one tax year at a time.

---

## 3. Fee spending — `GET /account/:id/fee-spending`

Aggregates network fees the account actually paid (as fee payer), broken down by operation type. Fees are often deductible as costs or added to cost basis depending on jurisdiction.

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/fee-spending?days=90"
```

Query params: `days` (1–90, default 30). Only transactions where the account paid the fee are counted; multi-operation fees are split evenly across operation types.

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "period": { "days": 90, "from": "2026-07-20T10:00:00.000Z", "to": "2026-10-18T10:00:00.000Z" },
    "transactionCount": 42,
    "totalFeesXLM": "0.0042000",
    "averageFeeXLM": "0.0001000",
    "breakdown": [
      { "type": "payment", "count": 30, "transactionCount": 28, "totalFeesXLM": "0.0030000", "averageFeeXLM": "0.0001071" },
      { "type": "manage_sell_offer", "count": 12, "transactionCount": 12, "totalFeesXLM": "0.0012000", "averageFeeXLM": "0.0001000" }
    ]
  }
}
```

**Tax use:** pull `days=90` repeatedly (or the maximum window your reporting period needs) to cover the full tax year, then sum `totalFeesXLM`. Attribute per-type totals when your engine treats transfer fees differently from trading fees.

---

## 4. Historical balances — `GET /account/:id/historical-balances`

Reconstructed balance snapshots for reconciliation (did we miss any events?).

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/historical-balances?resolution=30d"
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/historical-balances?asset=USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN&resolution=7d"
```

Query params: `asset` (`CODE:ISSUER`, default native XLM), `resolution` (`7d`|`30d`, default `7d`).

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "asset": { "code": "XLM", "issuer": null, "type": "native" },
    "resolution": "30d",
    "snapshots": [
      { "timestamp": "2026-07-20T10:00:00.000Z", "balance": "120.0000000" },
      { "timestamp": "2026-10-18T10:00:00.000Z", "balance": "250.5000000" }
    ]
  }
}
```

**Tax use:** compare the reconstructed closing balance against the live `GET /account/:id/balances` and your engine's computed balance. Snapshots are approximations — only payment and trade history is replayed (fees, claimable balances, and pool deposits are not) — so treat drift as a signal to look for missing event types, not as ledger truth.

---

## 5. Cross-asset conversions (path payments)

> Availability note: there is no `GET /account/:id/cross-asset-trades` route. Cross-asset conversions on Stellar are `path_payment_strict_send` / `path_payment_strict_receive` operations, and they are already included in the payments and transactions endpoints. Use the pattern below instead of a dedicated route.

Filter payments to path payments — each entry carries both the destination leg and the source leg:

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/payments?limit=200&order=asc"
```

Then keep entries where `type` is `path_payment_strict_send` or `path_payment_strict_receive`:

```json
{
  "success": true,
  "data": {
    "payments": [
      {
        "paymentId": "216532748304662530",
        "type": "path_payment_strict_send",
        "from": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
        "to": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        "asset": { "code": "USDC", "issuer": "GA5Z...", "type": "credit_alphanum4" },
        "amount": "50.0000000",
        "sourceAsset": { "code": "XLM", "issuer": null, "type": "native" },
        "sourceAmount": "588.2352941",
        "createdAt": "2026-09-21T09:00:00.000Z",
        "transactionHash": "def456..."
      }
    ]
  }
}
```

**Tax use:** treat the `sourceAsset`/`sourceAmount` as the disposal and `asset`/`amount` as the acquisition — the same as a trade. Combine these with `/trades` output to get the complete conversion history (order-book trades + path payments).

---

## Worked example: FIFO cost basis for a Stellar trade

Scenario: the account bought 1,000 XLM at $0.10/XLM (lot A), then later sold 100 XLM for 8.5 USDC when XLM was $0.085. What is the gain?

```javascript
// node cost-basis.js GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
const API_BASE = process.env.STELLARKIT_URL || "http://localhost:3000";

async function getAll(path) {
  const items = [];
  let cursor = null;
  for (;;) {
    const url = new URL(`${API_BASE}${path}`);
    url.searchParams.set("limit", "200");
    url.searchParams.set("order", "asc");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url);
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
    const page = body.data.trades || body.data.payments || body.data.items || [];
    items.push(...page);
    cursor = body.meta?.nextCursor || body.data?.cursor || null;
    if (!cursor || page.length === 0) break;
  }
  return items;
}

async function main(accountId) {
  const id = encodeURIComponent(accountId);
  const trades = await getAll(`/account/${id}/trades`);

  // Simplified FIFO: one acquisition lot, one disposal trade.
  // A production engine repeats this across every lot in chronological order.
  const lots = [{ amount: 1000, unitCostUSD: 0.10 }]; // 1,000 XLM @ $0.10
  const trade = trades[0]; // { soldAmount, boughtAmount, price, ... }
  let toSell = parseFloat(trade.soldAmount);
  let costUSD = 0;
  while (toSell > 0 && lots.length > 0) {
    const lot = lots[0];
    const take = Math.min(lot.amount, toSell);
    costUSD += take * lot.unitCostUSD;
    lot.amount -= take;
    toSell -= take;
    if (lot.amount === 0) lots.shift();
  }
  const proceedsUSD = parseFloat(trade.boughtAmount); // USDC ≈ $1
  const gainUSD = proceedsUSD - costUSD;
  console.log(JSON.stringify({
    trade,
    disposedXLM: trade.soldAmount,
    costBasisUSD: Number(costUSD.toFixed(2)),
    proceedsUSD: Number(proceedsUSD.toFixed(2)),
    gainUSD: Number(gainUSD.toFixed(2)),
  }, null, 2));
}

main(process.argv[2]).catch((err) => { console.error(err.message); process.exit(1); });
```

```bash
node cost-basis.js GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
```

```json
{
  "disposedXLM": "100.0000000",
  "costBasisUSD": 10.0,
  "proceedsUSD": 8.5,
  "gainUSD": -1.5
}
```

The 100 XLM came from the $0.10 lot (cost $10.00), proceeds were 8.5 USDC (≈ $8.50), for a $1.50 capital loss. Add the transaction's `fee.chargedInXLM` (from `/transactions`) to the cost basis if your jurisdiction allows it, and repeat the FIFO loop for every disposal (trades + path payments + outgoing payments).

---

## Operational tips

- Pull with `order=asc` + cursor for complete, gap-free histories; `desc` is for UIs, `asc` is for ledgers.
- Use `startDate`/`endDate` on `/payments` and `/trades` to scope one tax year per export.
- `days` on `/fee-spending` caps at 90 — loop consecutive windows to cover a full year.
- Cache `X-Cache: HIT` responses aggressively for reconciliation views, but use `?fresh=true` for the final export before filing.
- Store `transactionHash` with every event so auditors can trace each line back to Horizon.

---

## Related documentation

- [Account Endpoints](./account-endpoints.md) — full account reference
- [Transaction Endpoints](./transaction-endpoints.md) — explorers and submission tools
- [Analytics Endpoints](./analytics-endpoints.md) — account health dashboards
- [Response Format](./response-format.md) — envelopes, pagination, assets
- [Error Reference](./error-reference.md) — error types and handling
