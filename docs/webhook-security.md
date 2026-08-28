# Webhook Security — Signature Verification

When StellarKit delivers a webhook payload to your endpoint, it signs the request body with a shared secret using **HMAC-SHA256**. Verifying that signature before processing the payload is the single most important step in securing your webhook integration — it proves the request came from StellarKit and that the body was not modified in transit.

---

## Table of Contents

1. [How signatures work](#how-signatures-work)
2. [The `X-StellarKit-Signature` header](#the-x-stellarkit-signature-header)
3. [Verification examples](#verification-examples)
   - [Node.js](#nodejs)
   - [Python](#python)
   - [Go](#go)
4. [Handling invalid signatures](#handling-invalid-signatures)
5. [Timestamp tolerance and replay protection](#timestamp-tolerance-and-replay-protection)
6. [Secret storage best practices](#secret-storage-best-practices)
7. [Dual-secret rotation pattern](#dual-secret-rotation-pattern)
8. [Testing your endpoint locally](#testing-your-endpoint-locally)

---

## How signatures work

For every outbound webhook delivery, StellarKit:

1. Reads the raw request body as a UTF-8 byte string.
2. Reads the Unix timestamp (seconds) at the time of delivery.
3. Builds a **signed payload** string: `{timestamp}.{raw body}`.
4. Computes `HMAC-SHA256(secret, signedPayload)` where `secret` is the webhook secret you were issued at registration.
5. Hex-encodes the digest and sends it in the `X-StellarKit-Signature` header alongside a `t=` timestamp prefix.

The header format is:

```
X-StellarKit-Signature: t=1722000000,v1=3d9e4f1a...c7b2
```

| Part | Description |
|------|-------------|
| `t`  | Unix timestamp (seconds) used when computing the signature |
| `v1` | Hex-encoded HMAC-SHA256 digest of `{t}.{raw body}` |

The `t=` value is included in both the header and the signed payload so that an attacker cannot replay an old valid signature against a fresh delivery without changing the timestamp. Your server should reject requests where `t` is too far in the past (see [Timestamp tolerance](#timestamp-tolerance-and-replay-protection)).

---

## The `X-StellarKit-Signature` header

A complete header looks like this:

```
X-StellarKit-Signature: t=1722000000,v1=3d9e4f1a8b5c2d6e9f0a1b4c7d2e5f8a3b6c9d0e1f4a7b2c5d8e1f4a7b0c3d6
```

Steps to manually verify:

1. Split on `,` to extract `t` and `v1`.
2. Concatenate `t + "." + rawBody` to reconstruct the signed payload.
3. Compute `HMAC-SHA256(yourSecret, signedPayload)` and hex-encode the result.
4. Compare your digest to `v1` using a **constant-time comparison** (see below for why this matters).
5. Check that the age of the request (`now - t`) is within your acceptable tolerance window (recommended: 300 seconds).

---

## Verification examples

### Node.js

```js
// webhook-verify.js
const crypto = require('crypto');

/**
 * Verify a StellarKit webhook signature.
 *
 * @param {string} rawBody      - The raw, unparsed request body (UTF-8 string).
 * @param {string} header       - The full X-StellarKit-Signature header value.
 * @param {string} secret       - Your webhook secret.
 * @param {number} [toleranceSec=300] - Max age of the request in seconds.
 * @returns {{ valid: boolean, reason?: string }}
 */
function verifyWebhookSignature(rawBody, header, secret, toleranceSec = 300) {
  // 1. Parse the header
  const parts = Object.fromEntries(
    header.split(',').map((part) => part.split('='))
  );
  const timestamp = parts['t'];
  const receivedSig = parts['v1'];

  if (!timestamp || !receivedSig) {
    return { valid: false, reason: 'malformed_header' };
  }

  // 2. Check timestamp tolerance
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (age > toleranceSec) {
    return { valid: false, reason: 'timestamp_too_old' };
  }

  // 3. Recompute the signature
  const signedPayload = `${timestamp}.${rawBody}`;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');

  // 4. Constant-time comparison — prevents timing attacks
  const sigBuffer = Buffer.from(receivedSig, 'hex');
  const expectedBuffer = Buffer.from(expectedSig, 'hex');

  if (sigBuffer.length !== expectedBuffer.length) {
    return { valid: false, reason: 'signature_mismatch' };
  }

  const match = crypto.timingSafeEqual(sigBuffer, expectedBuffer);
  return match ? { valid: true } : { valid: false, reason: 'signature_mismatch' };
}

// ── Express usage ─────────────────────────────────────────────────────────────
// IMPORTANT: use express.raw() (or bodyParser.raw()) to get the unparsed body.
// express.json() will parse and re-serialize the body, which may change byte
// order or whitespace and break signature verification.

const express = require('express');
const app = express();

app.post(
  '/webhooks/stellarkit',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    const header = req.headers['x-stellarkit-signature'];
    const secret = process.env.STELLARKIT_WEBHOOK_SECRET;

    if (!header) {
      return res.status(400).json({ error: 'missing_signature_header' });
    }

    const result = verifyWebhookSignature(
      req.body.toString('utf8'),
      header,
      secret
    );

    if (!result.valid) {
      return res.status(401).json({ error: 'invalid_signature', reason: result.reason });
    }

    // Safe to parse and process the body now
    const payload = JSON.parse(req.body);
    console.log('Received event:', payload.event);

    res.status(200).json({ received: true });
  }
);
```

> **Why `express.raw()` and not `express.json()`?**  
> The HMAC is computed over the exact bytes StellarKit sent. If you let Express parse the JSON first, the body buffer is gone. Always capture the raw bytes before handing off to a JSON parser.

---

### Python

```python
# webhook_verify.py
import hashlib
import hmac
import time
from flask import Flask, request, abort

TOLERANCE_SECONDS = 300


def verify_webhook_signature(
    raw_body: bytes,
    header: str,
    secret: str,
    tolerance_sec: int = TOLERANCE_SECONDS,
) -> tuple[bool, str]:
    """
    Verify a StellarKit webhook signature.

    Args:
        raw_body:      The raw, unparsed request body bytes.
        header:        The X-StellarKit-Signature header value.
        secret:        Your webhook secret string.
        tolerance_sec: Maximum acceptable age of the request in seconds.

    Returns:
        (is_valid, reason) — reason is an empty string when valid.
    """
    # 1. Parse the header
    parts = dict(part.split("=", 1) for part in header.split(","))
    timestamp = parts.get("t")
    received_sig = parts.get("v1")

    if not timestamp or not received_sig:
        return False, "malformed_header"

    # 2. Check timestamp tolerance
    age = int(time.time()) - int(timestamp)
    if age > tolerance_sec:
        return False, "timestamp_too_old"

    # 3. Recompute the signature
    signed_payload = f"{timestamp}.{raw_body.decode('utf-8')}".encode("utf-8")
    expected_sig = hmac.new(
        secret.encode("utf-8"), signed_payload, hashlib.sha256
    ).hexdigest()

    # 4. Constant-time comparison — prevents timing attacks
    match = hmac.compare_digest(expected_sig, received_sig)
    return (True, "") if match else (False, "signature_mismatch")


# ── Flask usage ───────────────────────────────────────────────────────────────
app = Flask(__name__)


@app.post("/webhooks/stellarkit")
def handle_webhook():
    import os, json

    header = request.headers.get("X-StellarKit-Signature", "")
    secret = os.environ["STELLARKIT_WEBHOOK_SECRET"]

    if not header:
        abort(400, description="missing_signature_header")

    # request.get_data() returns the raw body bytes without parsing
    raw_body = request.get_data()
    valid, reason = verify_webhook_signature(raw_body, header, secret)

    if not valid:
        abort(401, description=f"invalid_signature: {reason}")

    payload = json.loads(raw_body)
    print("Received event:", payload.get("event"))

    return {"received": True}, 200
```

> **Django note:** Use `request.body` (bytes) instead of `request.read()` and skip any middleware that parses the body before the view runs.

---

### Go

```go
// webhookverify/verify.go
package webhookverify

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// ErrInvalidSignature is returned when the computed digest does not match.
var ErrInvalidSignature = errors.New("invalid signature")

// ErrTimestampTooOld is returned when the request is outside the tolerance window.
var ErrTimestampTooOld = errors.New("timestamp too old")

// ErrMalformedHeader is returned when the header cannot be parsed.
var ErrMalformedHeader = errors.New("malformed X-StellarKit-Signature header")

const defaultToleranceSec = 300

// Verify checks the X-StellarKit-Signature header against the raw body and secret.
//
// rawBody is the exact bytes received in the HTTP request body.
// header  is the full value of the X-StellarKit-Signature header.
// secret  is your webhook secret.
func Verify(rawBody []byte, header, secret string, toleranceSec ...int) error {
	tol := defaultToleranceSec
	if len(toleranceSec) > 0 {
		tol = toleranceSec[0]
	}

	// 1. Parse the header
	parts := make(map[string]string)
	for _, part := range strings.Split(header, ",") {
		kv := strings.SplitN(part, "=", 2)
		if len(kv) == 2 {
			parts[kv[0]] = kv[1]
		}
	}

	timestamp, hasT := parts["t"]
	receivedSig, hasV1 := parts["v1"]
	if !hasT || !hasV1 {
		return ErrMalformedHeader
	}

	// 2. Check timestamp tolerance
	ts, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return ErrMalformedHeader
	}
	age := time.Now().Unix() - ts
	if age > int64(tol) {
		return ErrTimestampTooOld
	}

	// 3. Recompute the signature
	signedPayload := fmt.Sprintf("%s.%s", timestamp, string(rawBody))
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(signedPayload))
	expectedSig := hex.EncodeToString(mac.Sum(nil))

	// 4. Constant-time comparison — prevents timing attacks
	receivedBytes, err := hex.DecodeString(receivedSig)
	if err != nil {
		return ErrInvalidSignature
	}
	expectedBytes, _ := hex.DecodeString(expectedSig)

	if !hmac.Equal(receivedBytes, expectedBytes) {
		return ErrInvalidSignature
	}
	return nil
}
```

```go
// main.go — net/http handler usage
package main

import (
	"encoding/json"
	"io"
	"net/http"
	"os"

	"yourmodule/webhookverify"
)

func webhookHandler(w http.ResponseWriter, r *http.Request) {
	// Read the raw body before anything else touches it
	rawBody, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "cannot read body", http.StatusBadRequest)
		return
	}

	header := r.Header.Get("X-StellarKit-Signature")
	secret := os.Getenv("STELLARKIT_WEBHOOK_SECRET")

	if header == "" {
		http.Error(w, "missing signature header", http.StatusBadRequest)
		return
	}

	if err := webhookverify.Verify(rawBody, header, secret); err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}

	var payload map[string]any
	if err := json.Unmarshal(rawBody, &payload); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"received": true})
}

func main() {
	http.HandleFunc("/webhooks/stellarkit", webhookHandler)
	http.ListenAndServe(":8080", nil)
}
```

---

## Handling invalid signatures

When signature verification fails, your endpoint should:

| Situation | Recommended response | Notes |
|-----------|----------------------|-------|
| Missing `X-StellarKit-Signature` header | `400 Bad Request` | Likely a misconfigured proxy stripping headers |
| Malformed header (missing `t` or `v1`) | `400 Bad Request` | Do not attempt partial verification |
| Signature mismatch | `401 Unauthorized` | Do not reveal which part failed |
| Timestamp too old | `403 Forbidden` | Signals a likely replay attempt; log it |

**Always respond quickly.** StellarKit retries deliveries on non-`2xx` responses, but a slow endpoint increases the replay window. Aim to verify, respond, and enqueue work within 5 seconds; do the heavy processing asynchronously.

**Do not log the raw signature value** alongside the secret in the same log line — a log aggregator compromise would expose both halves of the verification equation.

**Do not short-circuit on the first mismatching byte.** Always use a constant-time comparison function (`crypto.timingSafeEqual` in Node.js, `hmac.compare_digest` in Python, `hmac.Equal` in Go). A standard `===` or `==` comparison leaks timing information that lets an attacker brute-force the expected signature one byte at a time.

---

## Timestamp tolerance and replay protection

The `t=` value in the header is the Unix timestamp (in seconds) at which StellarKit generated the signature. Because the timestamp is part of the signed payload, a valid signature is only valid for that specific `(timestamp, body)` pair — it cannot be reused with a different timestamp.

**Recommended tolerance: 300 seconds (5 minutes).** This window is wide enough to absorb reasonable clock skew and network delays, and narrow enough to limit the usefulness of a replayed delivery.

If your system has stricter requirements (for example, financial operations), you can lower the window to 60 seconds. Going below 30 seconds is not recommended because legitimate retries from StellarKit may arrive outside that window.

```
Age of request = server's current time (Unix seconds) - t
Reject if age > tolerance
```

To prevent replays entirely within the tolerance window, your server can store seen `(timestamp, body hash)` pairs in a short-lived cache (TTL equal to your tolerance window) and reject duplicates. This is optional for most use cases but worth implementing for high-value event types.

---

## Secret storage best practices

Your webhook secret is a symmetric key. Treat it with the same care as a database password.

**Do:**

- Store it in an environment variable (`STELLARKIT_WEBHOOK_SECRET`) loaded at startup.
- Use a secrets manager (AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault, Doppler) in production environments.
- Restrict access to the secret to only the processes that need to verify signatures — not your entire application.
- Rotate the secret periodically, or immediately if you suspect it was exposed (see [Dual-secret rotation pattern](#dual-secret-rotation-pattern)).
- Use a secret of at least 32 random bytes (256 bits). StellarKit-generated secrets meet this requirement.

**Do not:**

- Hardcode the secret in source code or commit it to a repository, even a private one.
- Log the secret value at any log level.
- Transmit the secret over unencrypted channels.
- Reuse a webhook secret across multiple applications or environments.
- Store the secret in a client-side bundle, browser local storage, or any location accessible to end users.

**Example `.env` entry:**

```dotenv
# .env (never commit this file)
STELLARKIT_WEBHOOK_SECRET=sk_whsec_your64characterhexsecrethere
```

**Example secrets manager lookup (Node.js / AWS):**

```js
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

async function getWebhookSecret() {
  const client = new SecretsManagerClient({ region: 'us-east-1' });
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: 'stellarkit/webhook-secret' })
  );
  return response.SecretString;
}
```

---

## Dual-secret rotation pattern

Rotating a webhook secret without downtime requires a brief overlap period during which both the old and new secrets are considered valid. This is the dual-secret pattern.

### How it works

```
Time ──────────────────────────────────────────────────────────────►

 Phase 1: Normal (single secret)
 ┌───────────────────────────────┐
 │   Only SECRET_A is active     │
 └───────────────────────────────┘

 Phase 2: Rotation window (both secrets active)
                 ┌──────────────────────────────┐
                 │  Accept SECRET_A or SECRET_B  │
                 └──────────────────────────────┘

 Phase 3: Rotation complete (single secret)
                                  ┌─────────────────────────────────┐
                                  │   Only SECRET_B is active        │
                                  └─────────────────────────────────┘
```

During Phase 2, your endpoint tries verification with the primary secret first. If that fails, it tries the secondary secret. When at least one succeeds, the request is accepted. Once all in-flight deliveries signed with the old secret have been received (typically a few minutes), you remove the old secret and exit the rotation window.

### Implementation (Node.js)

```js
/**
 * Verify a signature against one or more secrets (for rotation).
 *
 * @param {string} rawBody
 * @param {string} header
 * @param {string[]} secrets - Try each secret in order; accept if any match.
 * @returns {{ valid: boolean, reason?: string }}
 */
function verifyWithRotation(rawBody, header, secrets) {
  for (const secret of secrets) {
    const result = verifyWebhookSignature(rawBody, header, secret);
    if (result.valid) return result;
  }
  return { valid: false, reason: 'signature_mismatch' };
}

// During rotation: load both secrets from your secrets manager
const secrets = [
  process.env.STELLARKIT_WEBHOOK_SECRET,        // new (primary)
  process.env.STELLARKIT_WEBHOOK_SECRET_OLD,    // old (secondary, remove after rotation)
].filter(Boolean);

const result = verifyWithRotation(rawBody, header, secrets);
```

### Rotation procedure

1. **Generate a new secret** in the StellarKit dashboard (or via the API). Do not replace the old one yet.
2. **Deploy the dual-secret version** of your endpoint with both `STELLARKIT_WEBHOOK_SECRET` (new) and `STELLARKIT_WEBHOOK_SECRET_OLD` (old) set.
3. **Update StellarKit** to start signing with the new secret. Old in-flight deliveries will still be signed with the old secret and your endpoint will accept them.
4. **Wait for the overlap window** (5–10 minutes, or until StellarKit confirms all deliveries are using the new secret).
5. **Remove `STELLARKIT_WEBHOOK_SECRET_OLD`** from your environment and redeploy. Rotation is complete.

> Keep the rotation window short. The longer both secrets are active, the longer a compromised old secret remains useful to an attacker.

---

## Testing your endpoint locally

You can generate a valid test signature to smoke-test your handler without a live StellarKit connection.

```bash
# Generate a test signature in the terminal (macOS/Linux)
BODY='{"event":"ledger.closed","sequence":12345}'
TIMESTAMP=$(date +%s)
SECRET="your_test_secret"
SIGNED="${TIMESTAMP}.${BODY}"
SIG=$(echo -n "$SIGNED" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')
echo "X-StellarKit-Signature: t=${TIMESTAMP},v1=${SIG}"
```

Then send it with curl:

```bash
curl -X POST http://localhost:3000/webhooks/stellarkit \
  -H "Content-Type: application/json" \
  -H "X-StellarKit-Signature: t=${TIMESTAMP},v1=${SIG}" \
  -d "$BODY"
```

Or use a Node.js script for cross-platform compatibility:

```js
// scripts/generate-test-signature.js
const crypto = require('crypto');

const body = JSON.stringify({ event: 'ledger.closed', sequence: 12345 });
const timestamp = Math.floor(Date.now() / 1000);
const secret = process.env.STELLARKIT_WEBHOOK_SECRET || 'your_test_secret';

const signedPayload = `${timestamp}.${body}`;
const sig = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

console.log(`X-StellarKit-Signature: t=${timestamp},v1=${sig}`);
console.log(`Body: ${body}`);
```

---

## See also

- [Webhooks Overview](webhooks.md) — event types, delivery behavior, and retry schedule
- [Error Reference](error-reference.md) — full list of error codes returned by the API
- [Rate Limiting](rate-limiting.md) — request limits and retry guidance
