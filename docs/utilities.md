# Utilities Guide

The `/utils` endpoints are developer convenience tools that handle common Stellar tasks locally — no Horizon call required for most of them. Use them for funding testnet accounts, converting units, validating inputs, encoding/decoding data, and inspecting transactions.

---

## Endpoints

- [GET /utils/friendbot/:accountId](#get-utilsfriendbotaccountid)
- [GET /utils/convert](#get-utilsconvert)
- [GET /utils/validate-account](#get-utilsvalidate-account)
- [GET /utils/validate-asset](#get-utilsvalidate-asset)
- [GET /utils/memo](#get-utilsmemo)
- [GET /utils/base64](#get-utilsbase64)
- [GET /utils/ledger-date](#get-utilsledger-date)
- [GET /utils/keypair](#get-utilskeypair)
- [POST /utils/decode-xdr](#post-utilsdecode-xdr)

---

## GET /utils/friendbot/:accountId

Funds a Stellar testnet account with 10,000 XLM using the Stellar Friendbot service. This is the quickest way to get a funded account while building and testing on testnet. The endpoint is only available when `STELLAR_NETWORK=testnet` — calling it on mainnet returns a `403` error.

### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `accountId` | string | The Stellar public key (starts with `G`) to fund |

### curl Example

```bash
curl "http://localhost:3000/utils/friendbot/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"
```

### Sample Response

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "message": "Account funded with 10,000 XLM on testnet",
    "transaction": {
      "hash": "3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c8889",
      "ledger": 3139460,
      "created_at": "2024-07-01T12:00:00Z",
      "source_account": "GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR",
      "successful": true
    }
  },
  "meta": {}
}
```

### Error Responses

| Status | Reason |
|--------|--------|
| `400` | Invalid account ID format |
| `400` | Account already funded (Friendbot declined) |
| `403` | Not on testnet — Friendbot is unavailable on mainnet |

---

## GET /utils/convert

Converts between XLM and stroops without making any network calls. One XLM equals 10,000,000 stroops. Provide either `?xlm` or `?stroops` — not both.

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `xlm` | string | XLM amount to convert to stroops (e.g. `1.5`) |
| `stroops` | string | Stroop amount to convert to XLM (e.g. `15000000`) |

### curl Examples

```bash
# Convert XLM to stroops
curl "http://localhost:3000/utils/convert?xlm=1.5"

# Convert stroops to XLM
curl "http://localhost:3000/utils/convert?stroops=15000000"
```

### Sample Response (XLM → stroops)

```json
{
  "success": true,
  "data": {
    "xlm": "1.5000000",
    "stroops": 15000000
  },
  "meta": {}
}
```

### Sample Response (stroops → XLM)

```json
{
  "success": true,
  "data": {
    "xlm": "1.5000000",
    "stroops": 15000000
  },
  "meta": {}
}
```

### Error Responses

| Status | Reason |
|--------|--------|
| `400` | Neither `xlm` nor `stroops` provided |
| `400` | Both `xlm` and `stroops` provided |
| `400` | Negative value |
| `400` | Non-numeric or more than 7 decimal places |
| `400` | Value exceeds safe integer range |

---

## GET /utils/validate-account

Validates whether a string is a correctly formatted Stellar Ed25519 public key. No network call is made — all checks are local using the Stellar SDK's `StrKey` module.

The endpoint checks:
- Prefix must be `G`
- Length must be exactly 56 characters
- Characters must be valid base32 (A–Z and 2–7 only)
- Checksum must pass Ed25519 verification

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | The string to validate as a Stellar public key |

### curl Examples

```bash
# Valid key
curl "http://localhost:3000/utils/validate-account?id=GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"

# Invalid key
curl "http://localhost:3000/utils/validate-account?id=NOTAVALIDKEY"
```

### Sample Response (valid)

```json
{
  "success": true,
  "data": {
    "input": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "isValid": true,
    "reason": null
  },
  "meta": {}
}
```

### Sample Response (invalid)

```json
{
  "success": true,
  "data": {
    "input": "NOTAVALIDKEY",
    "isValid": false,
    "reason": "Invalid length: expected 56 characters, got 12."
  },
  "meta": {}
}
```

`reason` is `null` for valid keys and a human-readable explanation for invalid ones.

---

## GET /utils/validate-asset

Validates whether a string is a valid Stellar asset code. No network call is made. The endpoint checks code length (1–12 characters) and character set (alphanumeric only), and identifies the asset type.

Asset types:
- `native` — the string is `XLM`
- `credit_alphanum4` — 1–4 character alphanumeric code
- `credit_alphanum12` — 5–12 character alphanumeric code

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `code` | string | The asset code to validate (e.g. `USDC`, `XLM`) |

### curl Examples

```bash
# Valid asset code
curl "http://localhost:3000/utils/validate-asset?code=USDC"

# Native asset
curl "http://localhost:3000/utils/validate-asset?code=XLM"

# Invalid (too long)
curl "http://localhost:3000/utils/validate-asset?code=TOOLONGASSETCODE"
```

### Sample Response (valid alphanum4)

```json
{
  "success": true,
  "data": {
    "input": "USDC",
    "isValid": true,
    "assetType": "credit_alphanum4",
    "reason": null
  },
  "meta": {}
}
```

### Sample Response (native XLM)

```json
{
  "success": true,
  "data": {
    "input": "XLM",
    "isValid": true,
    "assetType": "native",
    "reason": null
  },
  "meta": {}
}
```

### Sample Response (invalid)

```json
{
  "success": true,
  "data": {
    "input": "TOOLONGASSETCODE",
    "isValid": false,
    "assetType": null,
    "reason": "Asset code is too long (maximum 12 characters)."
  },
  "meta": {}
}
```

---

## GET /utils/memo

Decodes a raw Horizon memo into a human-readable representation. Useful when processing transaction data from Horizon that includes encoded memo values.

Stellar memo types: `none`, `text`, `id`, `hash`, `return`.

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `type` | string | Memo type from Horizon (`text`, `id`, `hash`, `return`, `none`) |
| `value` | string | Raw memo value from the Horizon response |

### curl Examples

```bash
# Decode a text memo
curl "http://localhost:3000/utils/memo?type=text&value=invoice-123"

# Decode a numeric ID memo
curl "http://localhost:3000/utils/memo?type=id&value=987654321"

# Decode a base64-encoded hash memo
curl "http://localhost:3000/utils/memo?type=hash&value=SGVsbG8gV29ybGQ="
```

### Sample Response (text memo)

```json
{
  "success": true,
  "data": {
    "type": "text",
    "value": "invoice-123",
    "displayValue": "invoice-123"
  },
  "meta": {}
}
```

### Sample Response (id memo)

```json
{
  "success": true,
  "data": {
    "type": "id",
    "value": "987654321",
    "displayValue": "987654321"
  },
  "meta": {}
}
```

---

## GET /utils/base64

Encodes a plain string to Base64 or decodes a Base64 string back to plain text. Provide either `?encode` or `?decode` — not both.

This is useful for working with Stellar's `MEMO_HASH` and `MEMO_RETURN` fields, which are returned as raw Base64 strings by Horizon.

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `encode` | string | Plain-text string to encode to Base64 |
| `decode` | string | Base64 string to decode to plain text |

### curl Examples

```bash
# Encode a string
curl "http://localhost:3000/utils/base64?encode=Hello%20World"

# Decode a Base64 string
curl "http://localhost:3000/utils/base64?decode=SGVsbG8gV29ybGQ="
```

### Sample Response (encode)

```json
{
  "success": true,
  "data": {
    "input": "Hello World",
    "encoded": "SGVsbG8gV29ybGQ=",
    "mode": "encode"
  },
  "meta": {}
}
```

### Sample Response (decode)

```json
{
  "success": true,
  "data": {
    "input": "SGVsbG8gV29ybGQ=",
    "decoded": "Hello World",
    "mode": "decode"
  },
  "meta": {}
}
```

### Error Responses

| Status | Reason |
|--------|--------|
| `400` | Neither `encode` nor `decode` provided |
| `400` | Both `encode` and `decode` provided |
| `400` | `decode` value is not valid Base64 |

---

## GET /utils/ledger-date

Estimates the approximate close date for a Stellar ledger sequence number. The endpoint fetches the latest ledger from Horizon and works backwards using the average 5-second ledger close time.

This is useful for displaying human-readable timestamps alongside ledger sequence numbers in UIs or data pipelines.

> Note: The result is an approximation. Actual ledger close times vary slightly due to network conditions.

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `sequence` | integer | The ledger sequence number to estimate a date for |

### curl Example

```bash
curl "http://localhost:3000/utils/ledger-date?sequence=51000000"
```

### Sample Response

```json
{
  "success": true,
  "data": {
    "sequence": 51000000,
    "estimatedDate": "2024-03-15T08:42:30.000Z",
    "note": "This date is an approximation based on an average Stellar ledger close time of ~5 seconds."
  },
  "meta": {}
}
```

### Error Responses

| Status | Reason |
|--------|--------|
| `400` | `sequence` not provided |
| `400` | `sequence` is not a positive integer |

---

## GET /utils/keypair

Generates a new random Stellar keypair for testnet use. Returns both the public key and secret key. This endpoint is only available when `STELLAR_NETWORK=testnet`.

Use this to quickly spin up test accounts during development. After generating a keypair, use `/utils/friendbot/:accountId` to fund it with XLM on testnet.

> **Warning:** Never use a keypair generated here in production. Never share your secret key.

### curl Example

```bash
curl "http://localhost:3000/utils/keypair"
```

### Sample Response

```json
{
  "success": true,
  "data": {
    "publicKey": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    "secretKey": "SCZANGBA5RNPGA7RJMIJDTHKB2YPKPFMVFMSWBJZ4G3SXW2RVYKJN7Y",
    "warning": "Never share your secret key"
  },
  "meta": {}
}
```

### Error Responses

| Status | Reason |
|--------|--------|
| `403` | Not on testnet — keypair generation is disabled on mainnet |

---

## POST /utils/decode-xdr

Decodes a Base64-encoded Stellar transaction XDR envelope into a readable JSON object. XDR (External Data Representation) is the binary format Stellar uses to serialize transactions before they are signed and submitted to the network.

Use this endpoint to inspect the exact contents of any transaction envelope — useful for debugging, auditing, or verifying transactions before submission.

See [Understanding XDR](../README.md#understanding-xdr) in the README for more background on when and why you'd need to decode XDR.

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `xdr` | string | Yes | Base64-encoded transaction XDR envelope |

### curl Example

```bash
curl -X POST "http://localhost:3000/utils/decode-xdr" \
  -H "Content-Type: application/json" \
  -d '{"xdr": "AAAAAgAAAABiXz1Zd..."}'
```

### Sample Response

```json
{
  "success": true,
  "data": {
    "sourceAccount": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "fee": "100",
    "sequenceNumber": "171798691840",
    "memo": {
      "type": "text",
      "value": "invoice-123"
    },
    "timeBounds": null,
    "operations": [
      {
        "type": "payment",
        "destination": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        "asset": {
          "code": "USDC",
          "issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
        },
        "amount": "50.0000000"
      }
    ]
  },
  "meta": {}
}
```

### Response Fields

| Field | Description |
|-------|-------------|
| `sourceAccount` | The transaction source account public key |
| `fee` | The transaction fee in stroops |
| `sequenceNumber` | The source account sequence number used in this transaction |
| `memo` | Decoded memo object with `type` and `value`, or `null` if no memo |
| `timeBounds` | Transaction time bounds with `minTime` and `maxTime`, or `null` |
| `operations` | Array of decoded operation objects |

### Error Responses

| Status | Reason |
|--------|--------|
| `400` | `xdr` field missing from request body |
| `400` | XDR string is malformed or cannot be parsed |
