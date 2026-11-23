# Claimable Balances Guide

This guide explains the claimable balance endpoints exposed by the API and how to use them to build claiming tools. It covers how to list balances, determine which balances an account can claim right now, summarize balances, find balances by sponsor, and how to actually claim a balance on-chain.

## Overview of endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /account/:id/claimable-balances` | List all claimable balances where the account is a claimant (eligible, pending, and expired). |
| `GET /account/:id/claimable-balances/eligible` | List balances for the account, categorised as `eligible`, `not-yet-claimable`, or `expired`. |
| `GET /account/:id/claimable-balance-summary` | Aggregate counts and totals of the account's claimable balances. |
| `GET /claimable-balances/by-sponsor/:address` | List balances sponsored by a given address. |
| `GET /claimable-balances/:id/evaluate/:accountId` | Evaluate a single balance for a specific account (eligibility check). |

All endpoints return JSON. Paginated endpoints accept `limit`, `cursor`, and `order` query parameters and return a `meta` object with pagination info.

### Common query parameters

- `limit` — maximum number of records to return (default and maximum vary by endpoint; typically `10`–`200`).
- `cursor` — opaque pagination cursor returned in `meta.next`/`meta.prev` of a previous response.
- `order` — `asc` or `desc` (default `desc`).
- `fresh` — when `true`, bypasses any cached data and fetches fresh state from the network. Useful right before claiming.

---

## GET /account/:id/claimable-balances

Returns every claimable balance where `:id` appears as a claimant, regardless of whether it is currently claimable. This is the broadest listing and is useful for building a full inventory of balances for an account.

### Query parameters

- `limit` — max records (default `10`, max `200`).
- `cursor` — pagination cursor.
- `order` — `asc` or `desc` (default `desc`).
- `fresh` — `true` to bypass cache.

### curl example

```bash
curl "https://api.example.com/account/GABC...XYZ/claimable-balances?limit=20&order=desc"
```

### Sample response

```json
{
  "balances": [
    {
      "balanceId": "00000000da0d57da7d4850e7fc10d2a9d0ebc731f7afb40574c03395b17d49149b91f5be",
      "asset": "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      "amount": "100.0000000",
      "sponsor": "GSPONSOR...ABC",
      "claimants": [
        {
          "destination": "GABC...XYZ",
          "predicate": {
            "not": {
              "abs_before": "2025-01-01T00:00:00Z"
            }
          }
        }
      ],
      "lastModifiedLedger": 1234567,
      "createdAt": "2024-12-01T12:00:00Z"
    }
  ],
  "meta": {
    "limit": 20,
    "order": "desc",
    "next": "cursor-token-for-next-page",
    "prev": null
  }
}
```

---

## GET /account/:id/claimable-balances/eligible

Returns the account's claimable balances, but categorises each one by whether the account can claim it **right now**. This is the endpoint you should use when building a "claim" button, because it tells you which balances are actionable.

### Categories

- `eligible` — the account is a claimant and the predicate is satisfied now; the balance can be claimed immediately.
- `not-yet-claimable` — the account is a claimant but the predicate is not yet satisfied (e.g. `abs_before`/`abs_after` time window not reached, or a `not` predicate still blocking). These are the "pending" balances.
- `expired` — the predicate can no longer be satisfied (e.g. an `abs_before` deadline has passed), so the balance can never be claimed by this account.

### Query parameters

- `limit` — max records (default `10`, max `200`).
- `cursor` — pagination cursor.
- `order` — `asc` or `desc` (default `desc`).
- `fresh` — `true` to bypass cache. Recommended before claiming.

### curl example

```bash
curl "https://api.example.com/account/GABC...XYZ/claimable-balances/eligible?fresh=true"
```

### Sample response

```json
{
  "eligible": [
    {
      "balanceId": "00000000da0d57da7d4850e7fc10d2a9d0ebc731f7afb40574c03395b17d49149b91f5be",
      "asset": "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      "amount": "100.0000000",
      "claimants": [
        {
          "destination": "GABC...XYZ",
          "predicate": {
            "not": {
              "abs_before": "2025-01-01T00:00:00Z"
            }
          }
        }
      ],
      "createdAt": "2024-12-01T12:00:00Z"
    }
  ],
  "notYetClaimable": [
    {
      "balanceId": "00000000a1b2c3d4e5f6...",
      "asset": "native",
      "amount": "50.0000000",
      "claimants": [
        {
          "destination": "GABC...XYZ",
          "predicate": {
            "abs_after": "2025-06-01T00:00:00Z"
          }
        }
      ],
      "createdAt": "2024-12-15T08:30:00Z"
    }
  ],
  "expired": [
    {
      "balanceId": "00000000ffeeddccbbaa...",
      "asset": "native",
      "amount": "10.0000000",
      "claimants": [
        {
          "destination": "GABC...XYZ",
          "predicate": {
            "abs_before": "2024-01-01T00:00:00Z"
          }
        }
      ],
      "createdAt": "2023-11-01T00:00:00Z"
    }
  ],
  "meta": {
    "limit": 10,
    "order": "desc",
    "next": null,
    "prev": null
  }
}
```

---

## GET /account/:id/claimable-balance-summary

Returns aggregate information about the account's claimable balances: counts per category and totals per asset. This is useful for dashboards and for showing a user "you have N balances worth X".

### Query parameters

- `fresh` — `true` to bypass cache.

### curl example

```bash
curl "https://api.example.com/account/GABC...XYZ/claimable-balance-summary"
```

### Sample response

```json
{
  "account": "GABC...XYZ",
  "counts": {
    "total": 3,
    "eligible": 1,
    "notYetClaimable": 1,
    "expired": 1
  },
  "totals": [
    {
      "asset": "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      "eligible": "100.0000000",
      "notYetClaimable": "0.0000000",
      "expired": "0.0000000"
    },
    {
      "asset": "native",
      "eligible": "0.0000000",
      "notYetClaimable": "50.0000000",
      "expired": "10.0000000"
    }
  ]
}
```

---

## GET /claimable-balances/by-sponsor/:address

Returns all claimable balances sponsored by `:address`. Sponsors pay the reserve for a balance; this endpoint is useful for sponsors auditing what they are funding and for tooling that tracks sponsored balances.

### Query parameters

- `limit` — max records (default `10`, max `200`).
- `cursor` — pagination cursor.
- `order` — `asc` or `desc` (default `desc`).
- `fresh` — `true` to bypass cache.

### curl example

```bash
curl "https://api.example.com/claimable-balances/by-sponsor/GSPONSOR...ABC?limit=50"
```

### Sample response

```json
{
  "balances": [
    {
      "balanceId": "00000000da0d57da7d4850e7fc10d2a9d0ebc731f7afb40574c03395b17d49149b91f5be",
      "asset": "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      "amount": "100.0000000",
      "claimants": [
        {
          "destination": "GABC...XYZ",
          "predicate": {
            "not": {
              "abs_before": "2025-01-01T00:00:00Z"
            }
          }
        }
      ],
      "createdAt": "2024-12-01T12:00:00Z"
    }
  ],
  "meta": {
    "limit": 50,
    "order": "desc",
    "next": null,
    "prev": null
  }
}
```

---

## GET /claimable-balances/:id/evaluate/:accountId

Evaluates a single claimable balance for a specific account and returns whether that account can claim it, along with the reason. This is handy for a per-balance eligibility check (e.g. when a user clicks a specific balance).

### curl example

```bash
curl "https://api.example.com/claimable-balances/00000000da0d57da.../evaluate/GABC...XYZ"
```

### Sample response

```json
{
  "balanceId": "00000000da0d57da7d4850e7fc10d2a9d0ebc731f7afb40574c03395b17d49149b91f5be",
  "account": "GABC...XYZ",
  "status": "eligible",
  "claimable": true,
  "reason": null,
  "asset": "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  "amount": "100.0000000"
}
```

For a pending balance, `status` would be `not-yet-claimable`, `claimable` would be `false`, and `reason` would describe the unmet predicate (e.g. `"abs_after predicate not satisfied until 2025-06-01T00:00:00Z"`).

---

## Eligible vs. pending balances

The distinction matters when building claiming tools:

- **Eligible** balances are those where the account is a claimant **and** the claimant's predicate is satisfied at the current ledger time. These can be claimed immediately by submitting a `claimClaimableBalance` operation.
- **Pending (not-yet-claimable)** balances are those where the account is a claimant but the predicate is not yet satisfied — for example, a time-locked balance with an `abs_after` predicate in the future, or a `not` predicate that is still blocking. These cannot be claimed yet; attempting to claim them will fail.
- **Expired** balances are those whose predicate can no longer be satisfied (e.g. an `abs_before` deadline has passed). They can never be claimed by this account.

The `GET /account/:id/claimable-balances` endpoint returns all of these together. The `GET /account/:id/claimable-balances/eligible` endpoint splits them into the three categories so your UI can show "Claim now" vs. "Available on <date>" vs. "Expired".

---

## Worked example: checking and claiming a balance

This example walks through checking eligibility and then claiming a balance.

### Step 1: Check eligibility

```bash
curl "https://api.example.com/account/GABC...XYZ/claimable-balances/eligible?fresh=true"
```

Suppose the response includes an eligible balance:

```json
{
  "eligible": [
    {
      "balanceId": "00000000da0d57da7d4850e7fc10d2a9d0ebc731f7afb40574c03395b17d49149b91f5be",
      "asset": "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      "amount": "100.0000000",
      "claimants": [
        {
          "destination": "GABC...XYZ",
          "predicate": {
            "not": {
              "abs_before": "2025-01-01T00:00:00Z"
            }
          }
        }
      ],
      "createdAt": "2024-12-01T12:00:00Z"
    }
  ],
  "notYetClaimable": [],
  "expired": [],
  "meta": { "limit": 10, "order": "desc", "next": null, "prev": null }
}
```

You can double-check a single balance with the evaluate endpoint:

```bash
curl "https://api.example.com/claimable-balances/00000000da0d57da.../evaluate/GABC...XYZ"
```

### Step 2: Build a claimClaimableBalance transaction

Using a Stellar SDK, build a transaction with a single `claimClaimableBalance` operation referencing the `balanceId`:

```js
import {
  Horizon,
  Keypair,
  TransactionBuilder,
  Operation,
  Asset,
  BASE_FEE,
  Networks,
} from "@stellar/stellar-sdk";

const server = new Horizon.Server("https://horizon.stellar.org");
const source = Keypair.fromSecret(process.env.SECRET_KEY);
const account = await server.loadAccount(source.publicKey());

const balanceId =
  "00000000da0d57da7d4850e7fc10d2a9d0ebc731f7afb40574c03395b17d49149b91f5be";

const tx = new TransactionBuilder(account, {
  fee: BASE_FEE,
  networkPassphrase: Networks.PUBLIC,
})
  .addOperation(Operation.claimClaimableBalance({ balanceId }))
  .setTimeout(30)
  .build();

tx.sign(source);
```

### Step 3: Submit the transaction

```js
const result = await server.submitTransaction(tx);
console.log("Claimed:", result.hash);
```

Or via curl (after signing and converting to XDR):

```bash
curl -X POST "https://horizon.stellar.org/transactions" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "tx=<base64-encoded-signed-xdr>"
```

### Step 4: Verify

After submission, re-check the account's balances. The claimed balance should no longer appear in the `eligible` list:

```bash
curl "https://api.example.com/account/GABC...XYZ/claimable-balances/eligible?fresh=true"
```

If the claim succeeded, the balance is removed from the claimable balances ledger entry and the asset amount is credited to the account.

### Notes on claiming

- Only a claimant listed on the balance can claim it, and only when its predicate is satisfied.
- Claiming requires the account to have enough XLM for the transaction fee.
- If a claim fails, the transaction returns an error such as `op_not_authorized` (predicate not satisfied or not a claimant) or `op_no_trust` (the account does not trust the asset). Check the `result_codes` in the error response.
- Use `fresh=true` on the eligibility endpoints right before claiming to avoid acting on stale cached data.