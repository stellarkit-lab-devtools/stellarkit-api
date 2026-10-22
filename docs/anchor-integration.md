# Anchor Integration Guide

This guide explains how to use StellarKit to build Stellar anchor workflows. It covers discovering anchors, inspecting asset metadata, checking account readiness, and initiating SEP-24 deposit flows.

StellarKit reads the Stellar network through Horizon and provides normalized REST endpoints for discovery and preflight checks. It does **not** replace the anchor's SEP server, issue session tokens, sign transactions, or submit payments.

## Prerequisites

```bash
export STELLARKIT_URL="http://localhost:3000"
export ASSET_CODE="USDC"
export ASSET_ISSUER="GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
export WALLET="G..."   # your user's Stellar account
```

If API-key authentication is enabled, add `-H "X-API-Key: $STELLARKIT_API_KEY"` to each request.

---

## Step 1 — Confirm the network

Before moving value, verify which Stellar network StellarKit is connected to:

```bash
curl -sS "$STELLARKIT_URL/network-status" | jq '.data.network'
# "testnet"
```

The wallet, the anchor, and StellarKit must all target the same network.

---

## Step 2 — Discover the USDC anchor

### 2a. Fetch asset metadata

```bash
curl -sS "$STELLARKIT_URL/asset/$ASSET_CODE/$ASSET_ISSUER" | jq
```

**Sample response:**

```json
{
  "success": true,
  "data": {
    "asset": { "code": "USDC", "issuer": "GA5Z...", "type": "credit_alphanum4" },
    "homeDomain": "centre.io",
    "isVerified": true
  }
}
```

The `homeDomain` is the domain that hosts the anchor's `stellar.toml`.

### 2b. Read the anchor's stellar.toml

```bash
ANCHOR_DOMAIN="centre.io"
curl -sS "$STELLARKIT_URL/stellar-toml/$ANCHOR_DOMAIN" | jq
```

**Sample response (abbreviated):**

```json
{
  "success": true,
  "data": {
    "TRANSFER_SERVER_SEP0024": "https://api.centre.io/sep24",
    "WEB_AUTH_ENDPOINT": "https://api.centre.io/auth",
    "CURRENCIES": [
      {
        "code": "USDC",
        "issuer": "GA5Z...",
        "name": "USD Coin",
        "desc": "A fully reserved stablecoin pegged 1:1 to the US dollar"
      }
    ]
  }
}
```

The `TRANSFER_SERVER_SEP0024` value is the anchor's deposit/withdrawal endpoint. `WEB_AUTH_ENDPOINT` is where SEP-10 authentication happens.

### 2c. Verify the asset

```bash
curl -sS "$STELLARKIT_URL/asset/$ASSET_CODE/$ASSET_ISSUER/verify" | jq '.data.isVerified'
# true
```

A verified asset means the issuer's `stellar.toml` lists this asset and the issuer account's `home_domain` resolves correctly.

---

## Step 3 — Check SEP-24 support

Read the parsed TOML entry for the asset to confirm SEP-24 is offered:

```bash
curl -sS "$STELLARKIT_URL/asset/$ASSET_CODE/$ASSET_ISSUER/toml" | jq
```

**Sample response:**

```json
{
  "success": true,
  "data": {
    "code": "USDC",
    "issuer": "GA5Z...",
    "name": "USD Coin",
    "description": "A fully reserved stablecoin pegged 1:1 to the US dollar",
    "anchorAssetType": "fiat",
    "conditions": "Supported in 180+ countries. KYC required for amounts over $1,000."
  }
}
```

Confirm `anchorAssetType` is present and the anchor's `stellar.toml` lists `TRANSFER_SERVER_SEP0024`. If that key is absent, the anchor does not support SEP-24.

---

## Step 4 — Check the user's account readiness

Before initiating a deposit you need to confirm:

1. The user's account exists on the network.
2. The account holds a trustline for USDC.
3. The trustline is authorized.

### 4a. Fetch trustlines

```bash
curl -sS "$STELLARKIT_URL/account/$WALLET/trustlines" | jq '.data.trustlines'
```

Look for an entry where `asset.code == "USDC"` and `isAuthorized == true`.

### 4b. Check receiving capability

```bash
curl -sS "$STELLARKIT_URL/account/$WALLET/can-receive/$ASSET_CODE/$ASSET_ISSUER" | jq
```

**Sample response:**

```json
{
  "success": true,
  "data": {
    "canReceive": true,
    "reason": "Account holds an authorized trustline for USDC."
  }
}
```

If `canReceive` is `false`, the user must add a trustline before the anchor will send funds.

### 4c. Check trustline capacity

```bash
curl -sS "$STELLARKIT_URL/account/$WALLET/trustline-limits" | jq '.data.trustlines'
```

**Sample response:**

```json
[
  {
    "asset": { "code": "USDC", "issuer": "GA5Z...", "type": "credit_alphanum4" },
    "balance": "0.0000000",
    "limit": "922337203685.4775807",
    "usedPercent": 0,
    "nearLimit": false
  }
]
```

If `nearLimit` is `true` the trustline is at or above 90% capacity. The anchor's deposit may be rejected if the incoming amount would exceed the limit. Advise the user to increase their limit before proceeding.

---

## Step 5 — Initiate the SEP-24 deposit flow

StellarKit does not perform SEP-10 or SEP-24 protocol steps — those require signing with the user's private key and communicating with the anchor's servers. Use a maintained SEP client library (for example the JavaScript `@stellar/stellar-sdk` or `@stellar/typescript-wallet-sdk`) for this part.

The typical flow:
1. **SEP-10 authentication** — generate and sign a challenge from `WEB_AUTH_ENDPOINT`, exchange it for a JWT.
2. **Open the SEP-24 interactive deposit URL** — call `POST /sep24/transactions/deposit/interactive` with the JWT.
3. **Present the anchor's web UI** to the user — this is where fiat on-ramp happens.
4. **Poll the anchor's transaction endpoint** — `GET /sep24/transaction?id=<anchorTxId>` until status reaches `pending_external` or `completed`.
5. **Confirm on-chain receipt** — once the anchor marks the transaction complete, verify it landed on-chain:

```bash
curl -sS "$STELLARKIT_URL/account/$WALLET/payments?assetCode=USDC" | jq '.data.payments[0]'
```

---

## Worked example — full USDC anchor discovery and deposit preflight

```bash
STELLARKIT_URL="http://localhost:3000"
ASSET_CODE="USDC"
ASSET_ISSUER="GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
WALLET="GABC..."

# 1. Confirm network
curl -sS "$STELLARKIT_URL/network-status" | jq '.data.network'

# 2. Discover home domain
HOME_DOMAIN=$(curl -sS "$STELLARKIT_URL/asset/$ASSET_CODE/$ASSET_ISSUER" | jq -r '.data.homeDomain')
echo "Anchor domain: $HOME_DOMAIN"

# 3. Read TOML — extract SEP-24 server
TRANSFER_SERVER=$(curl -sS "$STELLARKIT_URL/stellar-toml/$HOME_DOMAIN" | jq -r '.data.TRANSFER_SERVER_SEP0024')
echo "SEP-24 endpoint: $TRANSFER_SERVER"

# 4. Verify the asset
curl -sS "$STELLARKIT_URL/asset/$ASSET_CODE/$ASSET_ISSUER/verify" | jq '.data.isVerified'

# 5. Confirm the user can receive USDC
curl -sS "$STELLARKIT_URL/account/$WALLET/can-receive/$ASSET_CODE/$ASSET_ISSUER" | jq '.data.canReceive'

# 6. Check trustline capacity
curl -sS "$STELLARKIT_URL/account/$WALLET/trustline-limits" | jq '.data.trustlines[] | select(.asset.code == "USDC")'

# 7. If all checks pass, use a SEP client to initiate the deposit with the user's key
```

---

## Related endpoints

| Endpoint | Purpose |
|---|---|
| `GET /network-status` | Confirm the target Stellar network |
| `GET /stellar-toml/:domain` | Fetch and parse a domain's `stellar.toml` |
| `GET /asset/:code/:issuer` | Asset metadata including `homeDomain` |
| `GET /asset/:code/:issuer/toml` | TOML-sourced asset metadata (`anchorAssetType`, `conditions`) |
| `GET /asset/:code/:issuer/verify` | Verify issuer via account flags and `stellar.toml` |
| `GET /account/:id/trustlines` | All trustlines for an account |
| `GET /account/:id/can-receive/:code/:issuer` | Check if account can receive a specific asset |
| `GET /account/:id/trustline-limits` | Trustline capacity utilization and `nearLimit` flag |
| `GET /account/:id/payments` | Payment history filtered by asset |

---

## Related documentation

- [SEP Integration Guide](sep-integration.md) — SEP-10, SEP-24, and SEP-31 workflows in detail
- [Account Endpoints Guide](account-endpoints.md)
- [Asset Endpoints Guide](asset-endpoints.md)
- [Error Reference](error-reference.md)
