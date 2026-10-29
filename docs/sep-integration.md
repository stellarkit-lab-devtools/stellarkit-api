# SEP Integration Guide: SEP-10, SEP-24, and SEP-31

Stellar Ecosystem Proposals (SEPs) define interoperable protocols around the Stellar network. StellarKit supports these workflows by providing discovery, account and asset checks, fee guidance, and on-chain monitoring. It does **not** replace an anchor's SEP server.

This guide explains how to use StellarKit alongside:

- [SEP-10: Stellar Web Authentication](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md)
- [SEP-24: Hosted Deposit and Withdrawal](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md)
- [SEP-31: Cross-Border Payments API](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0031.md)

> **See also:** [Anchor Integration Guide](anchor-integration.md) for the end-to-end anchor discovery and deposit/withdrawal workflow, including discovering anchors with `GET /network/anchor-directory`, fetching anchor info, checking SEP support, and initiating a deposit flow.

## Responsibilities and boundaries

A production integration has three distinct components:

1. **Your application** owns user interaction, private-key handling, SEP client logic, and business state.
2. **The anchor's servers** expose SEP-10, SEP-24, SEP-31, and any related SEP-12/SEP-38 endpoints.
3. **StellarKit** reads the configured Stellar network through Horizon and exposes normalized REST endpoints for discovery, preflight checks, and ledger monitoring.

StellarKit does not:

- issue or validate SEP-10 session tokens;
- perform all security checks required for a SEP-10 challenge;
- hold private keys, sign challenges, or sign payments;
- expose an anchor's SEP-24 or SEP-31 API;
- collect KYC data or provide quotes;
- submit transactions to Stellar; or
- determine the authoritative business status of an anchor transfer.

Use a maintained SEP client library or the Stellar SDK for protocol validation, signing, and transaction submission. Treat the anchor's SEP transaction endpoint as the authoritative source for the off-chain transfer state. StellarKit reports the related **on-chain** state.

> **Network requirement:** A StellarKit process targets one network, configured by `STELLAR_NETWORK` and `HORIZON_URL`. The wallet, the anchor, the challenge network passphrase, the asset issuer, and StellarKit must all refer to the same Stellar network. Check `GET /network-status` before moving value.

## Common setup and discovery

The examples use these placeholders:

```bash
export STELLARKIT_URL="http://localhost:3000"
export ANCHOR_DOMAIN="anchor.example"
export ACCOUNT="G..."          # wallet or sending-anchor account
export ASSET_CODE="USDC"
export ASSET_ISSUER="G..."
```

If StellarKit API-key authentication is enabled, add `-H "X-API-Key: $STELLARKIT_API_KEY"` to each StellarKit request. Never send the StellarKit API key to an anchor.

First confirm the network and discover the anchor's services:

```bash
curl -sS "$STELLARKIT_URL/network-status"

curl -sS \
  "$STELLARKIT_URL/stellar-toml/$ANCHOR_DOMAIN?fresh=true"
```

StellarKit returns its standard `{ "success": true, "data": ... }` envelope and normalizes `stellar.toml` keys to camel case:

| SEP | `stellar.toml` key | StellarKit response field |
| --- | --- | --- |
| SEP-10 | `WEB_AUTH_ENDPOINT` | `data.webAuthEndpoint` |
| SEP-10 | `SIGNING_KEY` | `data.signingKey` |
| SEP-24 | `TRANSFER_SERVER_SEP0024` | `data.transferServerSep0024` |
| SEP-31 | `DIRECT_PAYMENT_SERVER` | `data.directPaymentServer` |
| Related SEP-12 | `KYC_SERVER` | `data.kycServer` |
| Related SEP-38 | `ANCHOR_QUOTE_SERVER` | `data.anchorQuoteServer` |

Use `fresh=true` at the start of a new session when current service URLs are important; otherwise the TOML endpoint can return a cached response.

Validate all discovered service URLs before using them. Production SEP-24 and SEP-31 services must use HTTPS. Do not silently replace a discovered host with one supplied by a user.

## StellarKit endpoint map

| StellarKit endpoint | SEP-10 | SEP-24 | SEP-31 | Role in the workflow |
| --- | :---: | :---: | :---: | --- |
| `GET /network-status` | ✓ | ✓ | ✓ | Confirm StellarKit's selected network and Horizon health. |
| `GET /stellar-toml/:domain` | ✓ | ✓ | ✓ | Discover the anchor's normalized SEP service URLs and signing key. |
| `POST /utils/decode-xdr` | ✓ |  |  | Inspect a challenge's source, sequence, time bounds, and operations. This is not complete SEP-10 verification. |
| `GET /account/:id/signers` | ✓ |  | ✓ | Read current signer weights and thresholds for an existing authentication or sending account. |
| `GET /asset/:code/:issuer` |  | ✓ | ✓ | Confirm that an issued asset exists and inspect its issuer metadata. |
| `GET /asset/:code/:issuer/verify` |  | ✓ | ✓ | Check issuer existence, home domain, reachable TOML, and the asset's TOML listing. |
| `GET /account/:id/can-receive/:code/:issuer` |  | ✓ | ✓ | Check trustline presence, authorization, and available trustline capacity before an issued-asset payment. Use `XLM/native` for native XLM. |
| `GET /account/:id/balances` |  | ✓ | ✓ | Check available on-chain balances. Amount and reserve policy must still be enforced by the application. |
| `GET /fee-estimate?operations=N` |  | ✓ | ✓ | Select a network fee before building the on-chain payment. |
| `GET /account/:id/payments` |  | ✓ | ✓ | Reconcile historical payments and obtain their transaction hashes. Supports `assetCode` and `assetIssuer` filters. |
| `GET /stream/payments/:id` |  | ✓ | ✓ | Observe new payment events for an account over SSE. The stream starts at `now`. |
| `GET /transactions/:id` |  | ✓ | ✓ | Inspect account transaction history, including transaction hashes and memos. Here `:id` is an **account address**, not a transaction ID. |
| `POST /transactions/batch-status` |  | ✓ | ✓ | Confirm up to 20 known Stellar transaction hashes. |

The paths above are StellarKit paths. Similar-looking paths on the anchor have different meanings. In particular:

- StellarKit `GET /transactions/:id` takes a Stellar account address and returns its on-chain history.
- SEP-24 `GET <TRANSFER_SERVER_SEP0024>/transaction?id=...` takes an anchor transaction ID.
- SEP-31 `GET <DIRECT_PAYMENT_SERVER>/transactions/:id` takes a receiving anchor's transaction ID.

Do not interchange these identifiers or endpoints.

---

## SEP-10: Stellar Web Authentication

### What SEP-10 does

SEP-10 is a challenge-response protocol that proves control of a Stellar account and returns a JSON Web Token (JWT). The anchor creates a specially formed transaction with sequence number `0`, signs it with the `SIGNING_KEY` published in its `stellar.toml`, and returns it as XDR. The client validates the challenge, adds signatures from the account being authenticated, and posts it back to the anchor's `WEB_AUTH_ENDPOINT`. The anchor verifies the signatures and issues a JWT.

The challenge is for authentication only and must never be submitted to Stellar.

SEP-24 and SEP-31 use the resulting JWT as a bearer token. SEP-10 also supports muxed accounts, shared accounts identified by an ID memo, and optional client-domain verification; use a SEP-10 implementation that supports the features your integration needs.

### Relevant StellarKit endpoints

- `GET /stellar-toml/:domain` discovers `webAuthEndpoint` and `signingKey`.
- `GET /network-status` helps prevent signing a challenge for an unexpected network.
- `GET /account/:id/signers` shows signer weights and thresholds for an existing classic account. This helps a wallet choose enough signers, but it does not verify challenge signatures.
- `POST /utils/decode-xdr` makes the XDR readable for debugging and preflight inspection.

### Worked example: authenticate a wallet

#### 1. Discover the SEP-10 service with StellarKit

```bash
TOML_JSON=$(curl -fsS \
  "$STELLARKIT_URL/stellar-toml/$ANCHOR_DOMAIN?fresh=true")

WEB_AUTH_ENDPOINT=$(printf '%s' "$TOML_JSON" | jq -r '.data.webAuthEndpoint')
SERVER_SIGNING_KEY=$(printf '%s' "$TOML_JSON" | jq -r '.data.signingKey')

test "$WEB_AUTH_ENDPOINT" != "null"
test "$SERVER_SIGNING_KEY" != "null"
```

Also compare `GET /network-status` with the network expected by the wallet and anchor.

#### 2. Optionally inspect the account's current signers with StellarKit

```bash
curl -fsS "$STELLARKIT_URL/account/$ACCOUNT/signers"
```

A `404` does not necessarily make SEP-10 impossible: SEP-10 permits an anchor to authenticate a not-yet-created account. Whether the anchor supports that behavior is its policy.

#### 3. Request the challenge from the anchor

This is an anchor call, not a StellarKit call:

```bash
CHALLENGE_JSON=$(curl -fsS --get "$WEB_AUTH_ENDPOINT" \
  --data-urlencode "account=$ACCOUNT" \
  --data-urlencode "home_domain=$ANCHOR_DOMAIN")

CHALLENGE_XDR=$(printf '%s' "$CHALLENGE_JSON" | jq -r '.transaction')
NETWORK_PASSPHRASE=$(printf '%s' "$CHALLENGE_JSON" | jq -r '.network_passphrase')
```

An anchor may require additional parameters or authorization for the challenge request. Include `memo` for a supported shared-account flow or `client_domain` for client-domain verification as defined by SEP-10.

#### 4. Inspect the challenge with StellarKit

```bash
jq -n --arg xdr "$CHALLENGE_XDR" '{xdr: $xdr}' | \
  curl -fsS -X POST "$STELLARKIT_URL/utils/decode-xdr" \
    -H "Content-Type: application/json" \
    --data-binary @-
```

The decoded response is useful for checking that the sequence is `0`, time bounds exist, and the operations look like the expected `manageData` challenge operations.

> `POST /utils/decode-xdr` is an inspection utility, **not a SEP-10 validator**. It does not establish that the server signed the envelope or that every SEP-10 operation, source account, domain, nonce, and time bound is valid.

#### 5. Fully validate and sign locally

Before signing, a SEP-10 client must perform all checks required by the current SEP-10 specification, including at least:

- the challenge network passphrase is the expected passphrase;
- the transaction source and server signature correspond to the discovered `SERVER_SIGNING_KEY`;
- sequence number is `0`;
- time bounds are present and currently valid;
- the first operation is the required `manageData` operation for `$ANCHOR_DOMAIN auth`, sourced by the authenticating account;
- `web_auth_domain`, `client_domain`, and any additional operations follow SEP-10 rules; and
- no unexpected operation can move funds or change account state.

Use an SEP-10 library or Stellar SDK logic to perform those checks and sign the original XDR with sufficient client-account signer weight. Keep secret keys out of StellarKit, logs, shell history, and browser storage.

#### 6. Exchange the signed challenge for a JWT at the anchor

```bash
TOKEN_JSON=$(jq -n --arg transaction "$SIGNED_CHALLENGE_XDR" \
  '{transaction: $transaction}' | \
  curl -fsS -X POST "$WEB_AUTH_ENDPOINT" \
    -H "Content-Type: application/json" \
    --data-binary @-)

SEP10_JWT=$(printf '%s' "$TOKEN_JSON" | jq -r '.token')
```

Use `Authorization: Bearer $SEP10_JWT` only with the intended anchor services. Validate token claims and expiry according to your application's security policy, and re-authenticate when the token expires.

---

## SEP-24: Hosted Deposit and Withdrawal

### What SEP-24 does

SEP-24 lets a wallet start an anchor-hosted deposit or withdrawal while keeping the experience inside a popup or webview. The interactive page collects KYC and transfer details. The wallet uses the anchor API to create the transfer and track its business status.

- A **deposit** moves an external asset, such as fiat in a bank account, into a Stellar asset delivered to the user's account.
- A **withdrawal** sends a Stellar asset to the anchor, which delivers an external asset to the user.

The anchor publishes `TRANSFER_SERVER_SEP0024` in `stellar.toml`. Except for the anchor's `/info` endpoint, SEP-24 calls carrying user data require a SEP-10 or SEP-45 bearer token. This guide uses SEP-10.

### Relevant StellarKit endpoints

- `GET /stellar-toml/:domain` discovers `transferServerSep0024`, `webAuthEndpoint`, and optional related service URLs.
- `GET /asset/:code/:issuer` and `/verify` check the on-chain asset and issuer before presenting it to a user.
- `GET /account/:id/can-receive/:code/:issuer` checks a deposit destination or withdrawal anchor account before an issued-asset payment.
- `GET /account/:id/balances` checks the user's on-chain asset balance before withdrawal.
- `GET /fee-estimate?operations=1` supplies fee tiers for a one-operation payment.
- `GET /stream/payments/:id`, `GET /account/:id/payments`, and `POST /transactions/batch-status` provide on-chain observation after submission.

StellarKit cannot tell whether KYC passed, a bank transfer arrived, or fiat was paid out. Read those states from the anchor's SEP-24 `/transaction` endpoint.

### Worked example: interactive withdrawal

This example withdraws an issued Stellar asset. A native-XLM variation uses `asset_code=native`, omits `asset_issuer`, and uses `XLM/native` in the StellarKit receive check.

#### 1. Discover SEP-10 and SEP-24 with StellarKit

```bash
TOML_JSON=$(curl -fsS \
  "$STELLARKIT_URL/stellar-toml/$ANCHOR_DOMAIN?fresh=true")

WEB_AUTH_ENDPOINT=$(printf '%s' "$TOML_JSON" | jq -r '.data.webAuthEndpoint')
TRANSFER_SERVER=$(printf '%s' "$TOML_JSON" | jq -r '.data.transferServerSep0024')
```

Reject missing or non-HTTPS production endpoints. Obtain `SEP10_JWT` with the SEP-10 flow above.

#### 2. Inspect the asset and the user's balance with StellarKit

```bash
curl -fsS \
  "$STELLARKIT_URL/asset/$ASSET_CODE/$ASSET_ISSUER/verify"

curl -fsS --get \
  "$STELLARKIT_URL/account/$ACCOUNT/balances" \
  --data-urlencode "assets=$ASSET_CODE:$ASSET_ISSUER"
```

Asset verification is a useful trust signal, not a substitute for your own allowlist or compliance checks. Compare the withdrawal amount with the spendable balance and any liabilities; do not rely only on the displayed balance.

For a deposit instead, preflight the user's destination account:

```bash
curl -fsS \
  "$STELLARKIT_URL/account/$ACCOUNT/can-receive/$ASSET_CODE/$ASSET_ISSUER"
```

If `data.canReceive` is `false`, resolve `no_trustline`, `not_authorized`, or `limit_reached` before expecting a normal issued-asset payment. SEP-24 may also support claimable-balance deposit flows, so follow the anchor's `/info` capabilities and the SEP-24 rules.

#### 3. Read capabilities and create the withdrawal at the anchor

These are anchor calls:

```bash
curl -fsS "$TRANSFER_SERVER/info"

INTERACTIVE_JSON=$(curl -fsS -X POST \
  "$TRANSFER_SERVER/transactions/withdraw/interactive" \
  -H "Authorization: Bearer $SEP10_JWT" \
  -F "asset_code=$ASSET_CODE" \
  -F "asset_issuer=$ASSET_ISSUER" \
  -F "account=$ACCOUNT" \
  -F "amount=25.0000000")

INTERACTIVE_URL=$(printf '%s' "$INTERACTIVE_JSON" | jq -r '.url')
SEP24_ID=$(printf '%s' "$INTERACTIVE_JSON" | jq -r '.id')
```

Open `INTERACTIVE_URL` according to SEP-24's webview security guidance. Do not log the URL because it may contain a short-lived token. After the user completes the interactive form, poll the anchor (or process its signed callback):

```bash
SEP24_TX=$(curl -fsS --get "$TRANSFER_SERVER/transaction" \
  -H "Authorization: Bearer $SEP10_JWT" \
  --data-urlencode "id=$SEP24_ID")
```

Do not send funds until the anchor transaction has status `pending_user_transfer_start`. Use exactly the returned `withdraw_anchor_account`, `withdraw_memo`, `withdraw_memo_type`, asset, and `amount_in`.

#### 4. Preflight the anchor's receiving account with StellarKit

```bash
WITHDRAW_ACCOUNT=$(printf '%s' "$SEP24_TX" | \
  jq -r '.transaction.withdraw_anchor_account')

curl -fsS \
  "$STELLARKIT_URL/account/$WITHDRAW_ACCOUNT/can-receive/$ASSET_CODE/$ASSET_ISSUER"

curl -fsS \
  "$STELLARKIT_URL/fee-estimate?operations=1&fresh=true"
```

Require `data.canReceive=true`. Build one payment with the exact memo and amount supplied by the anchor. Sign it locally and submit it with the Stellar SDK or Horizon. StellarKit does not build, sign, or submit this payment.

#### 5. Confirm the on-chain payment with StellarKit

Once submission returns a 64-character transaction hash:

```bash
jq -n --arg hash "$STELLAR_TX_HASH" '{hashes: [$hash]}' | \
  curl -fsS -X POST "$STELLARKIT_URL/transactions/batch-status" \
    -H "Content-Type: application/json" \
    --data-binary @-
```

A successful response should contain `found: true` and `successful: true` for the hash. For historical reconciliation, query the anchor account's payments:

```bash
curl -fsS --get \
  "$STELLARKIT_URL/account/$WITHDRAW_ACCOUNT/payments" \
  --data-urlencode "assetCode=$ASSET_CODE" \
  --data-urlencode "assetIssuer=$ASSET_ISSUER" \
  --data-urlencode "order=desc" \
  --data-urlencode "limit=20"
```

You may open `GET /stream/payments/$WITHDRAW_ACCOUNT` before submission to observe new payments in real time. The SSE stream begins at `now`, so use the historical endpoint to recover after disconnects.

#### 6. Track completion at the anchor

Continue polling `GET $TRANSFER_SERVER/transaction?id=$SEP24_ID` or process callbacks until the SEP-24 transaction reaches a terminal state. A confirmed Stellar transaction proves only that the on-chain payment succeeded; it does not prove that the anchor completed the off-chain payout.

---

## SEP-31: Cross-Border Payments API

### What SEP-31 does

SEP-31 is a server-to-server protocol for payments between financial accounts outside Stellar. A **Sending Anchor** accepts funds from a sending client, transfers a Stellar asset to a **Receiving Anchor**, and the receiving anchor pays the receiving client through an external rail.

SEP-31 is intended for anchors with a bilateral business relationship; it is not a general wallet-to-anchor API. The receiving anchor publishes `DIRECT_PAYMENT_SERVER`. The sending anchor authenticates with SEP-10 and sends the JWT on all SEP-31 requests. SEP-12 may be used for customer data and SEP-38 may be used for quotes.

For payment matching, SEP-31 requires the receiving anchor's returned Stellar memo to be used. The account used for SEP-10 authentication may differ from the source account that submits the Stellar payment.

### Relevant StellarKit endpoints

- `GET /stellar-toml/:domain` discovers `directPaymentServer`, SEP-10, and optional SEP-12/SEP-38 services.
- `GET /account/:id/signers` lets a sending anchor inspect the current authentication-account signer configuration.
- `GET /asset/:code/:issuer` and `/verify` validate the selected settlement asset's on-chain identity.
- `GET /account/:id/can-receive/:code/:issuer` checks the receiving anchor account before settlement.
- `GET /fee-estimate?operations=1` provides fee guidance for the settlement payment.
- `POST /transactions/batch-status` confirms the submitted transaction hash.
- `GET /account/:id/payments`, `GET /transactions/:id`, and the payment stream support reconciliation. Use account transaction history when the memo must be checked because payment records alone do not include transaction memos.

### Worked example: sending-anchor settlement

#### 1. Discover services and authenticate

```bash
TOML_JSON=$(curl -fsS \
  "$STELLARKIT_URL/stellar-toml/$ANCHOR_DOMAIN?fresh=true")

WEB_AUTH_ENDPOINT=$(printf '%s' "$TOML_JSON" | jq -r '.data.webAuthEndpoint')
DIRECT_PAYMENT_SERVER=$(printf '%s' "$TOML_JSON" | jq -r '.data.directPaymentServer')
KYC_SERVER=$(printf '%s' "$TOML_JSON" | jq -r '.data.kycServer')
QUOTE_SERVER=$(printf '%s' "$TOML_JSON" | jq -r '.data.anchorQuoteServer')
```

Confirm the network with `GET /network-status`, require HTTPS, and obtain a SEP-10 token using the sending anchor's approved authentication account. The receiving anchor must recognize that account under the bilateral agreement.

#### 2. Check SEP-31 capabilities and the settlement asset

The capability call goes to the receiving anchor:

```bash
SEP31_INFO=$(curl -fsS "$DIRECT_PAYMENT_SERVER/info" \
  -H "Authorization: Bearer $SEP10_JWT")
```

Use the response to select a supported asset, funding method, and customer types. Complete required SEP-12 customer records and optional SEP-38 quote steps at the discovered anchor services.

Then inspect the selected Stellar asset with StellarKit:

```bash
curl -fsS \
  "$STELLARKIT_URL/asset/$ASSET_CODE/$ASSET_ISSUER"

curl -fsS \
  "$STELLARKIT_URL/asset/$ASSET_CODE/$ASSET_ISSUER/verify"
```

The SEP-31 `/info` response and any SEP-38 quote remain authoritative for what the receiving anchor accepts.

#### 3. Create the SEP-31 transaction at the receiving anchor

This is an anchor call. Use the funding method and customer IDs returned by the preceding SEP-31/SEP-12 flow:

```bash
SEP31_TX=$(jq -n \
  --argjson amount 100.0 \
  --arg asset_code "$ASSET_CODE" \
  --arg asset_issuer "$ASSET_ISSUER" \
  --arg destination_asset "iso4217:NGN" \
  --arg funding_method "$FUNDING_METHOD" \
  --arg sender_id "$SENDER_CUSTOMER_ID" \
  --arg receiver_id "$RECEIVER_CUSTOMER_ID" \
  '{amount: $amount,
    asset_code: $asset_code,
    asset_issuer: $asset_issuer,
    destination_asset: $destination_asset,
    funding_method: $funding_method,
    sender_id: $sender_id,
    receiver_id: $receiver_id}' | \
  curl -fsS -X POST "$DIRECT_PAYMENT_SERVER/transactions" \
    -H "Authorization: Bearer $SEP10_JWT" \
    -H "Content-Type: application/json" \
    --data-binary @-)

SEP31_ID=$(printf '%s' "$SEP31_TX" | jq -r '.id')
```

If the response does not yet contain payment instructions, poll:

```bash
SEP31_TX=$(curl -fsS \
  "$DIRECT_PAYMENT_SERVER/transactions/$SEP31_ID" \
  -H "Authorization: Bearer $SEP10_JWT")
```

Wait for `pending_sender` and require `stellar_account_id`, `stellar_memo`, and `stellar_memo_type`. Do not invent or reuse a memo.

#### 4. Preflight the receiving account and fee with StellarKit

```bash
RECEIVING_ACCOUNT=$(printf '%s' "$SEP31_TX" | jq -r '.stellar_account_id')
STELLAR_MEMO=$(printf '%s' "$SEP31_TX" | jq -r '.stellar_memo')
STELLAR_MEMO_TYPE=$(printf '%s' "$SEP31_TX" | jq -r '.stellar_memo_type')
AMOUNT_IN=$(printf '%s' "$SEP31_TX" | jq -r '.amount_in')

curl -fsS \
  "$STELLARKIT_URL/account/$RECEIVING_ACCOUNT/can-receive/$ASSET_CODE/$ASSET_ISSUER"

curl -fsS \
  "$STELLARKIT_URL/fee-estimate?operations=1&fresh=true"
```

Require `data.canReceive=true`. Build a payment using exactly `RECEIVING_ACCOUNT`, `AMOUNT_IN`, `STELLAR_MEMO`, and `STELLAR_MEMO_TYPE`. Sign and submit it outside StellarKit. If a SEP-38 firm quote was used, also enforce its asset, amount, fee, and expiry constraints before submission.

#### 5. Confirm and reconcile the settlement with StellarKit

```bash
jq -n --arg hash "$STELLAR_TX_HASH" '{hashes: [$hash]}' | \
  curl -fsS -X POST "$STELLARKIT_URL/transactions/batch-status" \
    -H "Content-Type: application/json" \
    --data-binary @-
```

For an audit, fetch the receiving account's transaction history and select the exact hash:

```bash
curl -fsS --get \
  "$STELLARKIT_URL/transactions/$RECEIVING_ACCOUNT" \
  --data-urlencode "order=desc" \
  --data-urlencode "limit=20"
```

Verify that the matching item is successful and that its `memoType` and `memo` exactly match the SEP-31 instructions. Then inspect the corresponding payment in:

```bash
curl -fsS --get \
  "$STELLARKIT_URL/account/$RECEIVING_ACCOUNT/payments" \
  --data-urlencode "assetCode=$ASSET_CODE" \
  --data-urlencode "assetIssuer=$ASSET_ISSUER" \
  --data-urlencode "order=desc" \
  --data-urlencode "limit=20"
```

Match the payment's `transactionHash`, destination, asset, and amount to the already memo-verified transaction. This two-step check matters because StellarKit's payment item does not itself carry the transaction memo.

#### 6. Track the cross-border payout at the receiving anchor

Continue polling `GET $DIRECT_PAYMENT_SERVER/transactions/$SEP31_ID` or use a SEP-31 callback until completion. Submit the `stellar_transaction_id` to the receiving anchor only as allowed by the current SEP-31 flow. The receiving anchor's SEP-31 state is authoritative for the external payout, refund, or error; StellarKit's ledger confirmation is not a substitute.

---

## Production checklist

- [ ] Pin the expected Stellar network and compare it with `GET /network-status`.
- [ ] Fetch `stellar.toml` from the intended home domain and use the normalized discovery fields.
- [ ] Require HTTPS for production anchor services and validate discovered URLs.
- [ ] Fully validate every SEP-10 challenge with a maintained SEP-10 implementation before signing.
- [ ] Keep private keys and anchor bearer tokens out of StellarKit requests and logs.
- [ ] Verify asset code **and issuer**; asset codes are not globally unique.
- [ ] Check destination trustline authorization and capacity immediately before an issued-asset payment.
- [ ] Use the exact anchor-provided destination, amount, memo, and memo type.
- [ ] Make transaction creation idempotent and persist both the anchor transaction ID and Stellar transaction hash.
- [ ] Reconcile after stream disconnects with historical StellarKit endpoints.
- [ ] Treat SEP-24 or SEP-31 transaction state—not only ledger state—as authoritative for off-chain completion.
- [ ] Handle refunds, timeouts, expired JWTs/quotes, and terminal error states according to the relevant SEP.

## Related documentation

- [SEP-10 Authentication Guide](sep10-authentication.md) — complete challenge-response flow with Node.js signing example and pitfalls
- [Getting Started](getting-started.md)
- [Account Endpoints](account-endpoints.md)
- [Streaming](streaming.md)
- [Error Reference](error-reference.md)
- [Environment Configuration](environment-configuration.md)
