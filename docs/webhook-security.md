# Webhook Security Guide

This guide explains how to **verify that a webhook delivery actually came from StellarKit** and was not forged or modified in transit. It covers how signatures are generated, how to verify them in Node.js, Python, and Go, what to do when a signature is invalid, how to store your webhook secret safely, and how to rotate secrets without dropping deliveries.

If you only want to register a webhook, see the [Webhooks Guide](webhooks.md). That document covers the `X-Webhook-Signature` scheme used to authenticate *management* requests (register / list / delete). This document covers the symmetric scheme StellarKit uses to *sign the deliveries it sends to your endpoint*.

---

## Table of Contents

1. [Why verify signatures](#why-verify-signatures)
2. [How StellarKit signs deliveries](#how-stellarkit-signs-deliveries)
3. [Verifying signatures](#verifying-signatures)
   - [Node.js](#nodejs)
   - [Python](#python)
   - [Go](#go)
4. [Handling invalid signatures](#handling-invalid-signatures)
5. [Storing your webhook secret](#storing-your-webhook-secret)
6. [Dual-secret rotation](#dual-secret-rotation)
7. [Checklist](#checklist)

---

## Why verify signatures

Anyone who learns your callback URL can POST to it. Without verification, an attacker could send fake `payment.received` or `contract.event` payloads to trigger payouts, notifications, or state changes in your system.

A signature lets you prove two things on every request:

- **Authenticity** — the payload was produced by StellarKit (only StellarKit knows the shared secret).
- **Integrity** — the body has not been altered since StellarKit signed it. Even a single changed byte makes the signature invalid.

Verification must run *before* you trust or process the body. Treat any request without a valid signature as untrusted input.

---

## How StellarKit signs deliveries

For every delivery, StellarKit computes an HMAC-SHA256 of the **raw request body** using the webhook secret you configured, and sends the result in a header.

```
X-Webhook-Signature: hex( HMAC-SHA256( raw_request_body, WEBHOOK_SECRET ) )
```

| Component | Value |
| --- | --- |
| Algorithm | HMAC-SHA256 (RFC 2104) |
| Key | Your webhook secret (`WEBHOOK_SECRET`) |
| Message | The exact raw bytes of the request body |
| Output | Lowercase hex string |
| Header | `X-Webhook-Signature` |
| Other delivery headers | `Content-Type: application/json`, `User-Agent: StellarKit-Webhook/1.0`, `X-Webhook-Event: <event>` |

Key points:

- **Sign the raw body, not a re-serialized object.** If you read the JSON, parse it, and `JSON.stringify` it again, key order or whitespace can change and the signature will not match. Always capture the raw bytes the server received (e.g. `express.raw`, a raw request stream, or the raw body your framework exposes).
- **Compare in constant time.** Use a constant-time comparison (such as `crypto.timingSafeEqual`) so an attacker cannot use timing differences to guess the signature.
- The same secret/algorithm scheme is used for *management* requests in the [Webhooks Guide](webhooks.md); the only difference is that you verify the *incoming* delivery body instead of signing an *outgoing* management request.

---

## Verifying signatures

In every example below, `WEBHOOK_SECRET` is the secret StellarKit shows you when you create the webhook. Do not hard-code it in source — load it from an environment variable or a secrets manager (see [Storing your webhook secret](#storing-your-webhook-secret)).

### Node.js

```javascript
const crypto = require("crypto");

/**
 * Constant-time verification of an X-Webhook-Signature header.
 *
 * @param {Buffer|string} rawBody - Exact bytes received on the wire
 * @param {string} signatureHeader - Value of X-Webhook-Signature (hex)
 * @param {string} secret - Your WEBHOOK_SECRET
 * @returns {boolean}
 */
function verifyStellarKitSignature(rawBody, signatureHeader, secret) {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const provided = Buffer.from(String(signatureHeader || ""), "utf8");
  const computed = Buffer.from(expected, "utf8");

  if (provided.length !== computed.length) {
    return false;
  }
  return crypto.timingSafeEqual(provided, computed);
}

// Express: capture the raw body with express.raw, then verify.
const express = require("express");
const app = express();

app.post(
  "/hooks",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const ok = verifyStellarKitSignature(
      req.body, // a Buffer because of express.raw
      req.headers["x-webhook-signature"],
      process.env.WEBHOOK_SECRET
    );

    if (!ok) {
      return res.status(401).send("Invalid signature");
    }

    const payload = JSON.parse(req.body.toString("utf8"));
    // ... handle the event ...
    res.sendStatus(200);
  }
);
```

If you use `express.json()` instead of `express.raw()`, the body is already parsed and you lose the exact bytes. Either switch to `express.raw()` and parse manually, or configure your body parser to keep a `verify` callback that stashes the raw buffer on the request.

### Python

```python
import hashlib
import hmac

def verify_stellarkit_signature(raw_body: bytes, signature_header: str, secret: str) -> bool:
    """Constant-time verification of an X-Webhook-Signature header."""
    if not signature_header:
        return False

    expected = hmac.new(
        key=secret.encode("utf-8"),
        msg=raw_body,
        digestmod=hashlib.sha256,
    ).hexdigest()

    # hmac.compare_digest is constant-time.
    return hmac.compare_digest(expected, signature_header)


# Flask example.
from flask import Flask, request, abort

app = Flask(__name__)

@app.route("/hooks", methods=["POST"])
def hooks():
    if not verify_stellarkit_signature(
        raw_body=request.get_data(),  # raw bytes, not request.json
        signature_header=request.headers.get("X-Webhook-Signature", ""),
        secret=app.config["WEBHOOK_SECRET"],
    ):
        abort(401)

    payload = request.get_json()
    # ... handle the event ...
    return "", 200
```

`request.get_data()` returns the untouched bytes. Do not use `request.json` for the signature input — it re-parses and may not match the original bytes.

### Go

```go
package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"log"
	"net/http"
	"os"
)

// verifyStellarKitSignature performs a constant-time check of the signature.
func verifyStellarKitSignature(rawBody []byte, signatureHeader, secret string) bool {
	if signatureHeader == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(rawBody)
	expected := hex.EncodeToString(mac.Sum(nil))
	// hmac.Equal is constant-time.
	return hmac.Equal([]byte(expected), []byte(signatureHeader))
}

func main() {
	secret := os.Getenv("WEBHOOK_SECRET")

	http.HandleFunc("/hooks", func(w http.ResponseWriter, r *http.Request) {
		rawBody, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "cannot read body", http.StatusBadRequest)
			return
		}

		if !verifyStellarKitSignature(rawBody, r.Header.Get("X-Webhook-Signature"), secret) {
			http.Error(w, "invalid signature", http.StatusUnauthorized)
			return
		}

		// ... parse rawBody and handle the event ...
		w.WriteHeader(http.StatusOK)
	})

	log.Println("listening on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
```

`io.ReadAll(r.Body)` gives you the raw bytes before any JSON decoding, which is what you must sign.

---

## Handling invalid signatures

When verification fails, follow these rules:

1. **Reject with `401 Unauthorized` (or `403 Forbidden`).** Do not process the body, do not return a `2xx`, and do not log the payload contents at debug level in production.
2. **Do not echo the secret or the expected signature** in the response or logs. Reveal only that the signature was invalid.
3. **Log minimal metadata for investigation** — source IP, `User-Agent`, event type, and a counter. If you see a spike of invalid signatures, treat it as an attack signal and consider rate-limiting or blocking the source.
4. **Return quickly and idempotently.** A slow or expensive rejection still consumes resources; an attacker can abuse it.
5. **Count it, but do not crash.** Invalid-signature requests are expected noise on a public endpoint. Track them with a metric/alert rather than as a fatal error.
6. **Don't auto-rotate on failure.** A bad signature is not proof the secret leaked. Only rotate per the [dual-secret rotation](#dual-secret-rotation) plan below.

Example rejection (Node.js/Express):

```javascript
if (!verifyStellarKitSignature(rawBody, req.headers["x-webhook-signature"], secret)) {
  // Minimal, no secret/payload leakage.
  req.log?.warn({ ip: req.ip, ua: req.headers["user-agent"] }, "webhook signature invalid");
  return res.status(401).json({ success: false, error: "invalid_signature" });
}
```

---

## Storing your webhook secret

The webhook secret is the only thing standing between a public endpoint and a forged-event attack. Protect it like a password.

- **Never commit it to source control.** Keep it out of `.env` files that are checked in, and out of client-side code (browsers, mobile apps). The secret must live only on your server.
- **Load it from the environment or a secrets manager.** Use `process.env.WEBHOOK_SECRET`, or a managed store such as AWS Secrets Manager, GCP Secret Manager, Azure Key Vault, Doppler, or Vault. Mount it at runtime; do not bake it into images.
- **Scope it per environment.** Use a different secret for staging and production. A leaked staging secret should not compromise production deliveries.
- **Restrict access.** Only the service that verifies webhooks needs the secret. Avoid broad environment-variable propagation to unrelated jobs.
- **Rotate on suspicion, not just on schedule.** If you believe a secret leaked, rotate immediately (see below). Routine rotation every 90 days is good hygiene.
- **Treat logs as public.** Ensure your logger redacts the secret and does not print raw signatures alongside the key.
- **Don't share one secret across unrelated systems.** Each endpoint or consumer should have its own secret so a single leak has a limited blast radius.

---

## Dual-secret rotation

A single secret means every rotation is a race: you must update StellarKit *and* your verifier at the same instant, or deliveries fail until both sides agree. The **dual-secret (overlapping) pattern** eliminates the gap by supporting two active secrets at once.

How it works:

1. **Two secret slots.** Your verifier accepts `SECRET_A` *or* `SECRET_B`. StellarKit signs deliveries with the *current* secret (`A`).
2. **Generate a new secret `B`** in your secrets manager, but do not tell StellarKit to use it yet.
3. **Roll out `B` to your verifier first.** Now your endpoint accepts `A` and `B`. Deliveries signed with the still-current `A` keep working.
4. **Switch StellarKit to sign with `B`.** Deliveries now arrive signed with `B`, which your verifier already accepts. No downtime.
5. **After a grace period** (long enough to cover in-flight retries — StellarKit retries for up to ~155 s), **retire `A`.** Your verifier accepts only `B`.

Verifier that accepts two secrets:

```javascript
const crypto = require("crypto");

function verifyAny(rawBody, signatureHeader, secrets) {
  // `secrets` is an array, e.g. [process.env.WEBHOOK_SECRET, process.env.WEBHOOK_SECRET_PREV].
  return secrets.some((secret) =>
    verifyStellarKitSignature(rawBody, signatureHeader, secret)
  );
}
```

```python
def verify_any(raw_body: bytes, signature_header: str, secrets) -> bool:
    # secrets: iterable, e.g. [WEBHOOK_SECRET, WEBHOOK_SECRET_PREV]
    return any(
        verify_stellarkit_signature(raw_body, signature_header, s) for s in secrets
    )
```

```go
func verifyAny(rawBody []byte, signatureHeader string, secrets []string) bool {
	for _, s := range secrets {
		if verifyStellarKitSignature(rawBody, signatureHeader, s) {
			return true
		}
	}
	return false
}
```

Operational tips:

- Keep the overlap window short (minutes, not days) to limit the time two secrets are valid.
- Store `WEBHOOK_SECRET_PREV` only for the overlap window, then remove it.
- If you detect a leak, retire the *compromised* secret immediately and complete the rotate-to-new step without the long grace period.

---

## Checklist

- [ ] Endpoint rejects requests with no `X-Webhook-Signature` header.
- [ ] Signature computed over the **raw** request body, not a re-serialized object.
- [ ] Constant-time comparison used (`timingSafeEqual` / `compare_digest` / `hmac.Equal`).
- [ ] Invalid signatures return `401`/`403` and are not processed.
- [ ] Secret loaded from env/secrets manager; never in source or client code.
- [ ] Different secrets per environment; rotated on schedule and on suspicion.
- [ ] Dual-secret overlap used for zero-downtime rotation.
- [ ] Invalid-signature attempts logged and monitored, with no secret/payload leakage.
