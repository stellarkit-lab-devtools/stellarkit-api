# Network Endpoints Guide

This guide documents all network-level and fee-related endpoints in the StellarKit API. These endpoints provide real-time information about the Stellar network's state, fee market conditions, protocol version, validators, and ledger timing.

---

## Table of Contents

- [GET /network/protocol-version](#get-networkprotocol-version)
- [GET /network/base-fee](#get-networkbase-fee)
- [GET /network/fee-percentiles](#get-networkfee-percentiles)
- [GET /network/recommended-fee](#get-networkrecommended-fee)
- [GET /network/ledger-timing](#get-networkledger-timing)
- [GET /network/ledger-history](#get-networkledger-history)
- [GET /network/validators](#get-networkvalidators)
- [GET /fee-estimate](#get-fee-estimate)
- [GET /fee-estimate/surge-status](#get-fee-estimatesurge-status)
- [GET /fee-estimate/trends](#get-fee-estimatetrends)
- [POST /fee-estimate/batch](#post-fee-estimatebatch)

---

## GET /network/protocol-version

Returns the current protocol version, network passphrase, and Horizon version for the configured Stellar network.

### Response

```json
{
  "success": true,
  "data": {
    "protocolVersion": 20,
    "networkPassphrase": "Public Global Stellar Network ; September 2015",
    "horizonVersion": "2.28.0"
  }
}
```

### Cache

Cached for 60 seconds (configurable via environment).

### cURL Example

```bash
curl "https://api.stellarkit.io/network/protocol-version"
```

---

## GET /network/base-fee

Returns the current base fee for the network, indicating whether fee surge conditions are active.

### Query Parameters

- `fresh` (boolean, optional) — Bypass cache when set to `"true"`

### Response

```json
{
  "success": true,
  "data": {
    "baseFeeStroops": 100,
    "baseFeeXLM": "0.00001",
    "isSurge": false,
    "ledgerSequence": 50123456,
    "ledgerClosedAt": "2024-03-15T10:30:00Z",
    "note": "Base fee is reported in stroops and normalized XLM units."
  }
}
```

### Cache

Cached for 5 seconds.

### cURL Example

```bash
curl "https://api.stellarkit.io/network/base-fee"
curl "https://api.stellarkit.io/network/base-fee?fresh=true"
```

---

## GET /network/fee-percentiles

Returns fee distribution percentiles at multiple levels (p10, p20, p30, p50, p70, p90, p95, p99), along with the current ledger's accepted fee range and latest ledger sequence.

### Query Parameters

- `fresh` (boolean, optional) — Bypass cache when set to `"true"`

### Response

```json
{
  "success": true,
  "data": {
    "percentiles": {
      "p10": { "stroops": 100, "xlm": "0.00001" },
      "p20": { "stroops": 100, "xlm": "0.00001" },
      "p30": { "stroops": 100, "xlm": "0.00001" },
      "p50": { "stroops": 100, "xlm": "0.00001" },
      "p70": { "stroops": 150, "xlm": "0.000015" },
      "p90": { "stroops": 200, "xlm": "0.00002" },
      "p95": { "stroops": 250, "xlm": "0.000025" },
      "p99": { "stroops": 500, "xlm": "0.00005" }
    },
    "baseFee": { "stroops": 100, "xlm": "0.00001" },
    "minFee": { "stroops": 100, "xlm": "0.00001" },
    "maxFee": { "stroops": 5000, "xlm": "0.0005" },
    "ledgerSequence": 50123456,
    "timestamp": "2024-03-15T10:30:00.000Z"
  }
}
```

### Cache

Cached for 5 seconds.

### cURL Example

```bash
curl "https://api.stellarkit.io/network/fee-percentiles"
```

---

## GET /network/recommended-fee

Returns low, medium, and high priority fee recommendations with estimated confirmation times based on current network congestion.

### Query Parameters

- `fresh` (boolean, optional) — Bypass cache when set to `"true"`

### Response

```json
{
  "success": true,
  "data": {
    "low": {
      "feeStroops": "100",
      "feeXLM": "0.00001",
      "estimatedConfirmationLedgers": 1
    },
    "medium": {
      "feeStroops": "100",
      "feeXLM": "0.00001",
      "estimatedConfirmationLedgers": 1
    },
    "high": {
      "feeStroops": "200",
      "feeXLM": "0.00002",
      "estimatedConfirmationLedgers": 1
    }
  }
}
```

### Cache

Cached for 5 seconds.

### cURL Example

```bash
curl "https://api.stellarkit.io/network/recommended-fee"
```

---

## GET /network/ledger-timing

Computes the average ledger close time from the last 10 ledgers and predicts when the next ledger will close.

### Query Parameters

- `fresh` (boolean, optional) — Bypass cache when set to `"true"`

### Response

```json
{
  "success": true,
  "data": {
    "averageClosureTimeSeconds": 5.2345,
    "lastLedgerSequence": 50123456,
    "lastLedgerClosedAt": "2024-03-15T10:30:00Z",
    "expectedNextLedgerAt": "2024-03-15T10:30:05Z"
  }
}
```

### Cache

Cached for 10 seconds.

### cURL Example

```bash
curl "https://api.stellarkit.io/network/ledger-timing"
```

---

## GET /network/ledger-history

Returns recent ledger data, newest first. Includes sequence, close time, transaction/operation counts, and base fee.

### Query Parameters

- `limit` (number, optional) — Max ledgers to return (1–50, default: 10)
- `fresh` (boolean, optional) — Bypass cache when set to `"true"`

### Response

```json
{
  "success": true,
  "data": {
    "ledgers": [
      {
        "sequence": 50123456,
        "closedAt": "2024-03-15T10:30:00Z",
        "transactionCount": 245,
        "operationCount": 612,
        "baseFee": 100
      }
    ],
    "count": 10,
    "limit": 10
  }
}
```

### Cache

Cached for 10 seconds.

### cURL Example

```bash
curl "https://api.stellarkit.io/network/ledger-history"
curl "https://api.stellarkit.io/network/ledger-history?limit=5"
```

---

## GET /network/validators

Returns the current validator list from Horizon, normalized and grouped by organization.

### Query Parameters

- `fresh` (boolean, optional) — Bypass cache when set to `"true"`

### Response

```json
{
  "success": true,
  "data": {
    "validators": [
      {
        "publicKey": "GABC...",
        "homeDomain": "stellar.org",
        "isOrganization": true,
        "history": {
          "lastModifiedLedger": 50123000,
          "subentryCount": 5
        },
        "currentStatus": "active"
      }
    ],
    "total": 25,
    "byOrganisation": {
      "stellar.org": [
        {
          "publicKey": "GABC...",
          "homeDomain": "stellar.org",
          "isOrganization": true,
          "history": { "lastModifiedLedger": 50123000, "subentryCount": 5 },
          "currentStatus": "active"
        }
      ]
    },
    "ungrouped": []
  }
}
```

### Cache

Cached according to validators TTL (configurable via environment).

### cURL Example

```bash
curl "https://api.stellarkit.io/network/validators"
```

---

## GET /fee-estimate

Returns fee statistics for recent ledgers to help developers pick a competitive fee. Includes economy, standard, and priority tiers.

### Query Parameters

- `operations` (number, optional) — Number of operations in your transaction (default: 1)
- `fresh` (boolean, optional) — Bypass cache when set to `"true"`

### Response

```json
{
  "success": true,
  "data": {
    "note": "Fee estimates for a transaction with 1 operation(s). Fees are in stroops (1 XLM = 10,000,000 stroops).",
    "operationCount": 1,
    "perOperation": {
      "economy": {
        "stroops": 100,
        "xlm": "0.00001",
        "description": "Minimum — may be slow during congestion"
      },
      "standard": {
        "stroops": 100,
        "xlm": "0.00001",
        "description": "Recommended for most transactions"
      },
      "priority": {
        "stroops": 200,
        "xlm": "0.00002",
        "description": "Fast inclusion even during high network load"
      }
    },
    "totalFee": {
      "economy": { "stroops": 100, "xlm": "0.00001" },
      "standard": { "stroops": 100, "xlm": "0.00001" },
      "priority": { "stroops": 200, "xlm": "0.00002" }
    },
    "networkStats": {
      "lastLedgerBaseFee": "100",
      "ledgerCapacityUsage": "0.23",
      "maxFeeCharged": "5000",
      "p10": "100",
      "p50": "100",
      "p95": "200",
      "p99": "500"
    },
    "history": [
      { "ledger": 50123456, "baseFee": 100, "capacityUsage": 0.25 }
    ],
    "context": "Stroops are the smallest unit of XLM; 1 XLM = 10,000,000 stroops.",
    "networkCongestion": "low",
    "recommendation": "Economy tier is sufficient – network is not congested."
  }
}
```

### Cache

Cached according to fee estimate TTL (configurable via environment).

### cURL Example

```bash
curl "https://api.stellarkit.io/fee-estimate"
curl "https://api.stellarkit.io/fee-estimate?operations=3"
```

---

## GET /fee-estimate/surge-status

Identifies whether the network is currently in a fee surge period by analyzing recent ledger capacity usage. Provides actionable advice on when to submit transactions.

### Query Parameters

- `fresh` (boolean, optional) — Bypass cache when set to `"true"`

### Response

```json
{
  "success": true,
  "data": {
    "isSurging": false,
    "avgCapacityUsage": 0.2345,
    "surgeThreshold": 0.5,
    "ledgersAnalyzed": 10,
    "capacityUsageDetails": [0.23, 0.25, 0.21, 0.24, 0.22, 0.26, 0.23, 0.24, 0.25, 0.22],
    "suggestedFee": 100,
    "suggestedFeeInXLM": "0.00001",
    "recommendation": "Network is operating normally with low congestion. The economy fee tier is sufficient for transaction inclusion.",
    "currentNetworkStats": {
      "lastLedgerBaseFee": "100",
      "ledgerCapacityUsage": "0.23",
      "minFee": "100",
      "p50Fee": "100",
      "p95Fee": "200"
    }
  }
}
```

### Cache

Cached for 5 seconds.

### cURL Example

```bash
curl "https://api.stellarkit.io/fee-estimate/surge-status"
```

---

## GET /fee-estimate/trends

Analyzes fee trends across the last 50 ledgers with statistical summary. Identifies whether fees are rising, falling, or stable.

### Query Parameters

- `fresh` (boolean, optional) — Bypass cache when set to `"true"`

### Response

```json
{
  "success": true,
  "data": {
    "ledgersAnalyzed": 50,
    "avgBaseFee": 105.5,
    "minBaseFee": 100,
    "maxBaseFee": 500,
    "avgCapacityUsage": 0.3245,
    "trend": "stable",
    "recommendation": "Network fees are stable. Economy or standard fee rates are sufficient."
  }
}
```

### Cache

Cached according to fee estimate TTL (configurable via environment).

### cURL Example

```bash
curl "https://api.stellarkit.io/fee-estimate/trends"
```

---

## POST /fee-estimate/batch

Returns fee estimates for multiple transaction types in a single call. Accepts an array of transaction type descriptors (type + operationCount) and returns a computed fee estimate for each entry. Maximum 10 entries per request.

### Request Body

```json
{
  "transactions": [
    { "type": "payment", "operationCount": 1 },
    { "type": "swap", "operationCount": 3 },
    { "type": "claimable_balance", "operationCount": 2 }
  ]
}
```

### Response

```json
{
  "success": true,
  "data": {
    "estimates": [
      {
        "type": "payment",
        "operationCount": 1,
        "feeStroops": 100,
        "feeXLM": "0.00001"
      },
      {
        "type": "swap",
        "operationCount": 3,
        "feeStroops": 300,
        "feeXLM": "0.00003"
      },
      {
        "type": "claimable_balance",
        "operationCount": 2,
        "feeStroops": 200,
        "feeXLM": "0.00002"
      }
    ]
  }
}
```

### cURL Example

```bash
curl -X POST "https://api.stellarkit.io/fee-estimate/batch" \
  -H "Content-Type: application/json" \
  -d '{
    "transactions": [
      { "type": "payment", "operationCount": 1 },
      { "type": "swap", "operationCount": 3 }
    ]
  }'
```

---

## Notes

- All fee values are returned in both stroops and XLM for convenience
- 1 XLM = 10,000,000 stroops
- Most endpoints support a `?fresh=true` query parameter to bypass caching
- Cache TTL values are configurable via environment variables
- Timestamps are returned in ISO 8601 format
- Ledger sequences are always returned as integers

---

## Related Documentation

- [API Design Principles](./api-design.md)
- [Response Format Guide](./response-format.md)
- [Caching Strategy](./caching-strategy.md)
