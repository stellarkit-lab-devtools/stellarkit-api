# Anchor Integration Guide

This guide walks developers through building Stellar anchor workflows with StellarKit. It covers the complete lifecycle: discovering anchors, fetching anchor metadata, checking SEP support, and initiating deposit/withdrawal flows using the account endpoints.

## Overview

Stellar anchors are on/off-ramp services that connect the Stellar network to external payment rails (bank accounts, mobile money, etc.). Integrating with anchors typically involves:

1. **Discovery** — Find anchors that support the assets you care about.
2. **Metadata** — Fetch anchor details, including supported SEPs and endpoints.
3. **Capability checks** — Confirm the anchor supports the SEP you need (e.g. SEP-24 for interactive deposits).
4. **Account checks** — Verify the user's account can receive the asset and has sufficient balances.
5. **Flow initiation** — Kick off a deposit or withdrawal.

StellarKit exposes each of these steps as HTTP endpoints.

## Prerequisites

- A running StellarKit instance (default base URL `http://localhost:3000`).
- A Stellar account ID (public key) for the user performing the flow.
- The asset code and issuer you want to work with.

All examples below use `curl`. Replace `$BASE_URL` with your StellarKit base URL.

```bash
export BASE_URL="http://localhost:3000"
```

## Step 1: Discover Anchors

Use `GET /network/anchor-directory` to list anchors known to the network. You can filter by asset to narrow the results.

### Request

```bash
curl "$BASE_URL/network/anchor-directory?asset=USDC"
```

### Response

```json
{
  "anchors": [
    {
      "name": "Example USDC Anchor",
      "homeDomain": "anchor.example.com",
      "assets": [
        {
          "code": "USDC",
          "issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
        }
      ],
      "sepSupport": ["SEP-10", "SEP-24", "SEP-31"]
    },
    {
      "name": "Another Anchor",
      "homeDomain": "another-anchor.example",
      "assets": [
        {
          "code": "USDC",
          "issuer": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
        }
      ],
      "sepSupport": ["SEP-10", "SEP-6"]
    }
  ]
}
```

Each entry includes the anchor's `homeDomain`, the `assets` it supports, and a `sepSupport` array listing the SEPs it advertises.

> **Tip:** The `homeDomain` is the canonical identifier for an anchor. Use it alongside the asset code/issuer when fetching detailed anchor info.

## Step 2: Fetch Anchor Info

Once you've identified a candidate anchor, fetch its detailed metadata with `GET /asset/:code/:issuer/anchor-info`. This returns the anchor's SEP endpoints, supported operations, and limits.

### Request

```bash
curl "$BASE_URL/asset/USDC/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN/anchor-info"
```

### Response

```json
{
  "anchor": {
    "name": "Example USDC Anchor",
    "homeDomain": "anchor.example.com",
    "asset": {
      "code": "USDC",
      "issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
    },
    "sepSupport": ["SEP-10", "SEP-24", "SEP-31"],
    "endpoints": {
      "sep10": "https://anchor.example.com/auth",
      "sep24": "https://anchor.example.com/sep24",
      "sep31": "https://anchor.example.com/sep31"
    },
    "limits": {
      "deposit": { "min": "10", "max": "10000" },
      "withdraw": { "min": "10", "max": "10000" }
    }
  }
}
```

The `endpoints` object gives you the URLs for each supported SEP, and `limits` describes the minimum and maximum amounts for deposit and withdrawal operations.

## Step 3: Check SEP Support

Before initiating a flow, confirm the anchor supports the SEP you need. The `sepSupport` array from Step 2 is the authoritative list.

| SEP | Purpose | When to use |
|-----|---------|-------------|
| **SEP-10** | Stellar authentication | Required by most anchors to authenticate the user's account before any deposit/withdrawal. |
| **SEP-24** | Interactive deposit/withdrawal | Hosted web flows where the user completes KYC and payment details in the anchor's UI. Best for wallets and apps that don't want to build custom flows. |
| **SEP-31** | Cross-border payments | Programmatic, API-driven payments between senders and receivers. Best for remittance and B2B use cases. |

### Checking support in code

```javascript
async function supportsSep(anchorInfo, sep) {
  return anchorInfo.anchor.sepSupport.includes(sep);
}

const info = await fetch(
  `${BASE_URL}/asset/USDC/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN/anchor-info`
).then((r) => r.json());

if (await supportsSep(info, "SEP-24")) {
  console.log("Anchor supports interactive deposits via SEP-24");
}
```

If the anchor does not advertise the SEP you need, fall back to another anchor from the directory or use a different flow.

## Step 4: Verify the Account

Before initiating a deposit, verify that the user's account can receive the asset and check its current balances.

### Check whether the account can receive the asset

`GET /account/:id/can-receive` returns whether the account has a trustline for the asset and is otherwise eligible to receive it.

```bash
curl "$BASE_URL/account/GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW/balances"
```

### Response

```json
{
  "account": "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW",
  "balances": [
    { "asset": "native", "balance": "100.0000000" },
    {
      "asset": "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "balance": "0.0000000"
    }
  ]
}
```

If the asset does not appear in the balances, the account has no trustline and cannot receive it. The user must establish a trustline before depositing.

## Worked Example: USDC Deposit via SEP-24

Let's put it all together. We'll discover a USDC anchor, fetch its info, confirm SEP-24 support, verify the account, and initiate a deposit.

### 1. Discover a USDC anchor

```bash
curl "$BASE_URL/network/anchor-directory?asset=USDC"
```

Pick the anchor whose `homeDomain` and `issuer` match your intended asset. For this example we'll use `anchor.example.com` with issuer `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`.

### 2. Fetch anchor info

```bash
curl "$BASE_URL/asset/USDC/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN/anchor-info"
```

Confirm the response includes `"SEP-24"` in `sepSupport` and a `sep24` endpoint URL.

### 3. Verify the account can receive USDC

```bash
curl "$BASE_URL/account/GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW/can-receive?asset=USDC&issuer=GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
```

### Response

```json
{
  "account": "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW",
  "asset": "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  "canReceive": true,
  "reason": null
}
```

If `canReceive` is `false`, the `reason` field explains why (e.g. missing trustline, account not funded).

### 4. Check balances

```bash
curl "$BASE_URL/account/GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW/balances"
```

Confirm the account has a USDC trustline (a `USDC:...` entry in `balances`). A zero balance is fine — that's what the deposit will fund.

### 5. Initiate the deposit

With SEP-24 confirmed and the account ready, initiate the deposit through the anchor's SEP-24 endpoint returned in Step 2. StellarKit surfaces the anchor's SEP-24 URL so your app can redirect the user to the interactive flow:

```bash
curl -X POST "$BASE_URL/account/GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW/deposit" \
  -H "Content-Type: application/json" \
  -d '{
    "assetCode": "USDC",
    "assetIssuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "amount": "100",
    "sep": "SEP-24"
  }'
```

### Response

```json
{
  "deposit": {
    "id": "dep_1234567890",
    "status": "pending_user_transfer_start",
    "anchor": "anchor.example.com",
    "sep": "SEP-24",
    "interactiveUrl": "https://anchor.example.com/sep24/transactions/dep_1234567890",
    "asset": "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "amount": "100"
  }
}
```

Redirect the user to `interactiveUrl` to complete KYC and payment details in the anchor's hosted UI. Poll the deposit status (or listen for the anchor's callback) until it reaches `completed`.

## Withdrawal Flows

Withdrawals follow the same pattern. After discovering the anchor and confirming SEP support, verify the account holds the asset:

```bash
curl "$BASE_URL/account/GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW/balances"
```

Then initiate the withdrawal:

```bash
curl -X POST "$BASE_URL/account/GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW/withdraw" \
  -H "Content-Type: application/json" \
  -d '{
    "assetCode": "USDC",
    "assetIssuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "amount": "50",
    "sep": "SEP-24"
  }'
```

The response includes an `interactiveUrl` for the user to complete the off-ramp details.

## Endpoint Reference

| Endpoint | Purpose |
|----------|---------|
| `GET /network/anchor-directory` | List anchors, optionally filtered by `asset`. |
| `GET /asset/:code/:issuer/anchor-info` | Fetch anchor metadata, SEP endpoints, and limits. |
| `GET /account/:id/can-receive` | Check whether an account can receive a given asset. |
| `GET /account/:id/balances` | List an account's balances and trustlines. |
| `POST /account/:id/deposit` | Initiate a deposit flow with an anchor. |
| `POST /account/:id/withdraw` | Initiate a withdrawal flow with an anchor. |

## Best Practices

- **Cache anchor info.** Anchor metadata changes infrequently; cache `anchor-info` responses for a few minutes to reduce latency.
- **Always check `can-receive` first.** Deposits to accounts without a trustline will fail. Surface a clear message so users can establish the trustline.
- **Validate SEP support before initiating.** Don't assume an anchor supports SEP-24; check `sepSupport` from the anchor info response.
- **Handle interactive flows gracefully.** SEP-24 requires redirecting the user to the anchor's hosted UI. Provide a clear return path and poll for status updates.
- **Respect limits.** Check the `limits` object from anchor info and reject amounts outside the min/max range before initiating.

## Related Documentation

- [SEP Integration](./sep-integration.md) — Details on SEP-10, SEP-24, and SEP-31 support in StellarKit.
- [README](../README.md) — Project overview and getting started.