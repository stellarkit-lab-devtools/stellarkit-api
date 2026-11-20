# SEP-10 Authentication Guide

SEP-10 (Stellar Web Authentication) is a challenge-response protocol that proves control of a Stellar account and returns a JSON Web Token (JWT). This guide shows how to use StellarKit alongside a SEP-10 anchor to complete the full flow.

> Scope: StellarKit helps you **discover** the anchor's SEP-10 service, **preflight** the account and network, and **inspect** the challenge — it does not issue challenges, hold private keys, sign anything, or validate session tokens. The anchor's `WEB_AUTH_ENDPOINT` issues the challenge and the JWT. For the broader SEP-10/24/31 picture, see the [SEP Integration Guide](./sep-integration.md).

All StellarKit examples use `http://localhost:3000` (or `$STELLARKIT_URL`). Anchor calls go to the anchor's domain. Placeholders: `$ANCHOR_DOMAIN` (for example `anchor.example`), `$ACCOUNT` (wallet `G...`), `$HOME_DOMAIN` (usually the anchor domain).

---

## How SEP-10 works

1. The wallet asks the anchor's `WEB_AUTH_ENDPOINT` for a challenge. The anchor returns a transaction envelope (XDR) with sequence number `0`, signed with the `SIGNING_KEY` from its `stellar.toml`.
2. The wallet validates the challenge (network, source, sequence, time bounds, operations, domains) and signs it with sufficient account signers.
3. The wallet posts the signed envelope back. The anchor verifies signatures and returns a JWT for SEP-24/SEP-31 calls.

The challenge must **never** be submitted to Stellar — it is authentication only.

### StellarKit endpoint map

| Step | StellarKit endpoint | Role |
|---|---|---|
| Discover SEP-10 service | `GET /stellar-toml/:domain` | Returns normalized `webAuthEndpoint` and `signingKey` |
| Confirm network | `GET /network-status` | Ensures wallet, anchor, and StellarKit agree on testnet/mainnet |
| Preflight signers | `GET /account/:id/signers` | Current weights/thresholds so the wallet picks enough signers |
| Inspect challenge | `POST /utils/decode-xdr` | Human-readable view of source, sequence, time bounds, operations |
| Reconcile later | `GET /transactions/:id`, `GET /account/:id/payments` | On-chain history if you need to audit post-auth activity |

> Availability note: there is no `GET /account/:id/sep10-challenge` route. StellarKit never generates challenges — the anchor does. Request the challenge from the anchor's `WEB_AUTH_ENDPOINT` discovered via `GET /stellar-toml/:domain`, and use StellarKit for discovery, preflight, and inspection around it.

---

## Step 1 — Discover the SEP-10 service

```bash
export STELLARKIT_URL="http://localhost:3000"
export ANCHOR_DOMAIN="anchor.example"
export ACCOUNT="GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"

TOML_JSON=$(curl -fsS "$STELLARKIT_URL/stellar-toml/$ANCHOR_DOMAIN?fresh=true")
WEB_AUTH_ENDPOINT=$(printf '%s' "$TOML_JSON" | jq -r '.data.webAuthEndpoint')
SERVER_SIGNING_KEY=$(printf '%s' "$TOML_JSON" | jq -r '.data.signingKey')

test "$WEB_AUTH_ENDPOINT" != "null"
test "$SERVER_SIGNING_KEY" != "null"
```

Use `?fresh=true` at the start of a session so you do not act on a cached service URL. Require HTTPS for production endpoints and never silently replace the discovered host.

Confirm the network matches what the wallet and anchor expect:

```bash
curl -fsS "$STELLARKIT_URL/network-status"
```

---

## Step 2 — Preflight the account's signers

For an existing account, check weights and thresholds so the wallet knows how many signatures are needed:

```bash
curl -fsS "$STELLARKIT_URL/account/$ACCOUNT/signers"
```

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4...",
    "signers": [
      { "key": "GAAZI4...", "weight": 1, "type": "ed25519_public_key" }
    ],
    "thresholds": { "lowThreshold": 0, "medThreshold": 0, "highThreshold": 0 }
  }
}
```

A `404 AccountNotFound` does not necessarily block SEP-10 — anchors may authenticate not-yet-created accounts as a matter of policy. Follow the anchor's rules.

---

## Step 3 — Request the challenge from the anchor

This is an anchor call, not a StellarKit call:

```bash
CHALLENGE_JSON=$(curl -fsS --get "$WEB_AUTH_ENDPOINT" \
  --data-urlencode "account=$ACCOUNT" \
  --data-urlencode "home_domain=$ANCHOR_DOMAIN")

CHALLENGE_XDR=$(printf '%s' "$CHALLENGE_JSON" | jq -r '.transaction')
NETWORK_PASSPHRASE=$(printf '%s' "$CHALLENGE_JSON" | jq -r '.network_passphrase')
```

Include `memo` for shared-account flows or `client_domain` for client-domain verification when the anchor requires them (see SEP-10).

---

## Step 4 — Inspect the challenge with StellarKit

```bash
jq -n --arg xdr "$CHALLENGE_XDR" '{xdr: $xdr}' | \
  curl -fsS -X POST "$STELLARKIT_URL/utils/decode-xdr" \
    -H "Content-Type: application/json" \
    --data-binary @-
```

Check that the decoded envelope shows sequence `0`, present time bounds, and the expected `manageData` operations. This is debugging only:

> `POST /utils/decode-xdr` does **not** verify the server signature or prove the challenge is valid. Full validation must happen in SEP-10 client code (next step).

---

## Step 5 — Validate, sign, and exchange (Node.js)

The snippet below uses `@stellar/stellar-sdk` for validation and signing. Keep secret keys out of StellarKit requests, logs, and browser storage. Install with `npm install @stellar/stellar-sdk`.

```javascript
const { TransactionBuilder, Keypair, Networks } = require("@stellar/stellar-sdk");

async function sep10Authenticate({ webAuthEndpoint, challengeXdr, networkPassphrase, serverSigningKey, clientSecret, homeDomain }) {
  // 1. Parse the challenge on the expected network.
  const challengeTx = TransactionBuilder.fromXDR(challengeXdr, networkPassphrase);

  // 2. Minimum SEP-10 checks (implement the full current SEP-10 list in production):
  if (Number(challengeTx.sequence) !== 0) throw new Error("Challenge sequence must be 0");
  if (!challengeTx.timeBounds || new Date(challengeTx.timeBounds.maxTime * 1000) < new Date()) {
    throw new Error("Challenge is expired or missing time bounds");
  }
  const serverKeypair = Keypair.fromPublicKey(serverSigningKey);
  if (challengeTx.source !== serverSigningKey) throw new Error("Challenge source must be the server signing key");
  if (!challengeTx.signatures.some((s) => serverKeypair.verify(challengeTx.hash(), s.signature()))) {
    throw new Error("Missing valid server signature");
  }
  const firstOp = challengeTx.operations[0];
  if (firstOp.type !== "manageData" || firstOp.name !== `${homeDomain} auth`) {
    throw new Error("First operation must be the home-domain manageData challenge");
  }
  // Also verify: network passphrase, web_auth_domain, no unexpected
  // fund-moving operations, client_domain if used, and nonce uniqueness.

  // 3. Sign with the client's account key(s). Add all signatures needed
  //    to meet the account's thresholds (see GET /account/:id/signers).
  const clientKeypair = Keypair.fromSecret(clientSecret);
  challengeTx.sign(clientKeypair);
  const signedXdr = challengeTx.toEnvelope().toXDR("base64");

  // 4. Exchange the signed challenge for a JWT at the anchor.
  const res = await fetch(webAuthEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: signedXdr }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Token exchange failed: HTTP ${res.status}`);
  if (!body.token) throw new Error("Anchor did not return a token");
  return body.token; // Authorization: Bearer <token> for SEP-24 / SEP-31
}

sep10Authenticate({
  webAuthEndpoint: process.env.WEB_AUTH_ENDPOINT,
  challengeXdr: process.env.CHALLENGE_XDR,
  networkPassphrase: process.env.NETWORK_PASSPHRASE || Networks.TESTNET,
  serverSigningKey: process.env.SERVER_SIGNING_KEY,
  clientSecret: process.env.CLIENT_SECRET,
  homeDomain: process.env.HOME_DOMAIN || "anchor.example",
}).then((token) => console.log(JSON.stringify({ token: `${token.slice(0, 12)}…` })))
  .catch((err) => { console.error(err.message); process.exit(1); });
```

Verification of the **signed response** happens on the anchor: it checks that the envelope carries valid client signatures with weight meeting the account's thresholds, that the challenge has not expired or been replayed, and that the transaction was not submitted to the network. Wallets should likewise verify the JWT's issuer, expiry, and audience before use, and re-authenticate when it expires.

---

## Common pitfalls

| Pitfall | What goes wrong | How to avoid |
|---|---|---|
| Challenge expiry | `TransactionExpired` — the client signs after `maxTime` | Request, validate, and sign promptly; check `timeBounds` before signing |
| Wrong network passphrase | Valid-looking signatures that the anchor rejects | Compare `GET /network-status` with the anchor's `network_passphrase` before signing |
| Sequence is not `0` | Not a SEP-10 challenge; could be a real payment | Reject any challenge whose sequence is not `0` |
| Unexpected operations | Challenge could move funds or change signers | Allowlist only the expected `manageData` ops; reject anything else |
| Wrong `home_domain` / `web_auth_domain` | Phishing anchor or mismatched session | Verify both domains against the discovered TOML values |
| Memo omitted for shared accounts | Anchor cannot map the user | Include the SEP-10 `memo` when the anchor uses muxed/shared accounts |
| `client_domain` not verified | Client-app attestation bypassed | Implement the SEP-10 client-domain flow when your integration uses it |
| Challenge submitted to Stellar | Sequence-`0` transaction fails or clogs history | Never submit the challenge envelope; it is off-ledger |
| JWT reuse across anchors | Token accepted by the wrong service | Bind tokens to the intended anchor and respect `exp` |

---

## Production checklist

- [ ] Pin the expected network and compare with `GET /network-status`
- [ ] Fetch `stellar.toml` from the intended domain with `?fresh=true`
- [ ] Require HTTPS for production anchor services
- [ ] Fully validate every challenge with a maintained SEP-10 implementation before signing
- [ ] Select enough signers via `GET /account/:id/signers` to meet thresholds
- [ ] Keep private keys and bearer tokens out of StellarKit requests and logs
- [ ] Enforce exact `stellar_memo` handling for downstream SEP-24/SEP-31 steps
- [ ] Handle expiry, replay, and re-authentication

---

## Related documentation

- [SEP Integration Guide](./sep-integration.md) — SEP-10/24/31 workflows with StellarKit
- [Account Endpoints](./account-endpoints.md) — signers and account reference
- [Utilities](./utilities.md) — `decode-xdr` and inspection helpers
- [Error Reference](./error-reference.md) — error types and handling
