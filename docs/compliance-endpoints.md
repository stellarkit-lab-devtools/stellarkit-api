# Compliance and Risk Endpoints Guide

StellarKit API provides a suite of compliance-oriented endpoints that help developers build KYC (Know Your Customer), AML (Anti-Money Laundering), and risk management workflows for Stellar applications.

This guide covers all compliance endpoints with curl examples, sample responses, and a worked example showing how to chain endpoints together for a complete compliance check.

> For an end-to-end KYC/AML onboarding workflow that produces a compliance report for a new account, see the [Compliance Workflow Guide](./compliance-workflow.md).

---

## Overview

The compliance endpoints help you:

- Assess account risk scores based on activity patterns
- Check if assets are frozen on specific accounts
- Verify if accounts can receive specific assets
- Monitor account inactivity and dormancy
- Check watchlist status for suspicious accounts
- Perform comprehensive compliance checks before processing transactions

---

## Available Endpoints

### 1. GET /account/:id/risk-score

Computes a risk score (0-100) for an account based on multiple contributing factors including age, transaction patterns, trustline configuration, and known risk indicators.

**Curl Example:**

```bash
curl -X GET "https://api.stellarkit.io/account/GABC.../risk-score"
```

**Sample Response:**

```json
{
  "success": true,
  "data": {
    "accountId": "GABC...",
    "riskScore": 35,
    "riskLevel": "medium",
    "factors": {
      "accountAge": {
        "daysSinceCreation": 180,
        "risk": "low"
      },
      "transactionFrequency": {
        "transactionsPerDay": 2.5,
        "risk": "low"
      },
      "trustlineCount": {
        "count": 15,
        "risk": "medium"
      },
      "inactivityDays": {
        "days": 5,
        "risk": "low"
      }
    },
    "recommendation": "Standard verification required"
  }
}
```

**Risk Levels:**
- `0-25`: low risk
- `26-50`: medium risk
- `51-75`: high risk
- `76-100`: critical risk

---

### 2. GET /account/:id/compliance-check

*Note: This endpoint should be implemented to aggregate multiple compliance checks.*

Performs a comprehensive compliance check by combining risk score, freeze status, watchlist status, and can-receive validation.

**Curl Example:**

```bash
curl -X GET "https://api.stellarkit.io/account/GABC.../compliance-check"
```

**Sample Response:**

```json
{
  "success": true,
  "data": {
    "accountId": "GABC...",
    "passed": true,
    "checks": {
      "riskScore": {
        "passed": true,
        "score": 35,
        "level": "medium"
      },
      "watchlist": {
        "passed": true,
        "onWatchlist": false
      },
      "inactivity": {
        "passed": true,
        "status": "active",
        "daysSinceLastTransaction": 5
      }
    },
    "recommendation": "Proceed with transaction",
    "timestamp": "2026-09-28T10:30:00Z"
  }
}
```

---

### 3. GET /account/:id/freeze-check

*Note: Use `/account/:id/freeze-status/:assetCode/:assetIssuer` for asset-specific freeze checking.*

**Curl Example:**

```bash
curl -X GET "https://api.stellarkit.io/account/GABC.../freeze-status/USDC/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
```

**Sample Response:**

```json
{
  "success": true,
  "data": {
    "accountId": "GABC...",
    "asset": {
      "code": "USDC",
      "issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "type": "credit_alphanum4"
    },
    "isFrozen": false,
    "isAuthorized": true,
    "canTransact": true
  }
}
```

---

### 4. GET /account/:id/watchlist-status

Checks if an account appears on community-maintained Stellar watchlists or has been flagged for suspicious activity.

**Curl Example:**

```bash
curl -X GET "https://api.stellarkit.io/account/GABC.../watchlist-status"
```

**Sample Response:**

```json
{
  "success": true,
  "data": {
    "accountId": "GABC...",
    "onWatchlist": false,
    "sources": [],
    "reason": null,
    "checkedAt": "2026-09-28T10:30:00Z"
  }
}
```

**Response when flagged:**

```json
{
  "success": true,
  "data": {
    "accountId": "GXYZ...",
    "onWatchlist": true,
    "sources": [
      {
        "name": "Stellar Scam DB",
        "url": "https://scamdb.stellar.org",
        "flaggedAt": "2026-08-15T14:22:00Z"
      }
    ],
    "reason": "Reported phishing activity",
    "checkedAt": "2026-09-28T10:30:00Z"
  }
}
```

---

### 5. GET /account/:id/inactivity

Returns the number of days since the account's last transaction and an inactivity status classification.

**Curl Example:**

```bash
curl -X GET "https://api.stellarkit.io/account/GABC.../inactivity"
```

**Sample Response:**

```json
{
  "success": true,
  "data": {
    "accountId": "GABC...",
    "status": "active",
    "daysSinceLastTransaction": 7,
    "lastTransactionAt": "2026-09-21T15:30:00Z",
    "lastTransactionHash": "abc123..."
  }
}
```

**Status Classifications:**
- `active`: < 30 days since last transaction
- `idle`: 30-180 days since last transaction
- `dormant`: > 180 days since last transaction
- `no_transactions`: account has never transacted

---

### 6. GET /account/:id/can-receive/:assetCode/:assetIssuer

Checks if an account can receive a specific asset by verifying trustline existence and authorization status.

**Curl Example:**

```bash
curl -X GET "https://api.stellarkit.io/account/GABC.../can-receive/USDC/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
```

**Sample Response (can receive):**

```json
{
  "success": true,
  "data": {
    "accountId": "GABC...",
    "asset": {
      "code": "USDC",
      "issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "type": "credit_alphanum4"
    },
    "canReceive": true,
    "hasTrustline": true,
    "isAuthorized": true,
    "reason": null
  }
}
```

**Sample Response (cannot receive):**

```json
{
  "success": true,
  "data": {
    "accountId": "GABC...",
    "asset": {
      "code": "USDC",
      "issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "type": "credit_alphanum4"
    },
    "canReceive": false,
    "hasTrustline": false,
    "isAuthorized": false,
    "reason": "Account does not have a trustline for this asset"
  }
}
```

---

## Complete Compliance Workflow

Here's a worked example showing how to chain compliance endpoints together to perform a comprehensive compliance check before processing a payment transaction.

### Scenario

Your application needs to send 100 USDC to account `GABC...`. Before submitting the transaction, you want to verify:

1. The recipient account exists and is not high-risk
2. The recipient is not on any watchlists
3. The recipient account is active (not dormant)
4. The recipient can receive USDC
5. The USDC asset is not frozen on the recipient's account

### Step-by-Step Implementation

#### Step 1: Check Risk Score

```bash
curl -X GET "https://api.stellarkit.io/account/GABC.../risk-score"
```

**Decision Logic:**
- If `riskLevel` is `"critical"` or `riskScore > 75`: Flag for manual review
- If `riskLevel` is `"high"` or `riskScore > 50`: Require enhanced verification
- If `riskLevel` is `"medium"` or `"low"`: Proceed to next check

#### Step 2: Check Watchlist Status

```bash
curl -X GET "https://api.stellarkit.io/account/GABC.../watchlist-status"
```

**Decision Logic:**
- If `onWatchlist === true`: Reject transaction or flag for manual review
- If `onWatchlist === false`: Proceed to next check

#### Step 3: Check Account Inactivity

```bash
curl -X GET "https://api.stellarkit.io/account/GABC.../inactivity"
```

**Decision Logic:**
- If `status === "dormant"` (> 180 days): Flag for verification
- If `status === "idle"` (30-180 days): Optional warning
- If `status === "active"` (< 30 days): Proceed to next check

#### Step 4: Verify Asset Reception Capability

```bash
curl -X GET "https://api.stellarkit.io/account/GABC.../can-receive/USDC/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
```

**Decision Logic:**
- If `canReceive === false`: Reject transaction (recipient cannot receive this asset)
- If `canReceive === true`: Proceed to next check

#### Step 5: Check Asset Freeze Status

```bash
curl -X GET "https://api.stellarkit.io/account/GABC.../freeze-status/USDC/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
```

**Decision Logic:**
- If `isFrozen === true`: Reject transaction (asset is frozen)
- If `isFrozen === false && canTransact === true`: Approve transaction

### Complete Workflow Code Example (Node.js)

```javascript
const axios = require('axios');

const API_BASE = 'https://api.stellarkit.io';
const RECIPIENT = 'GABC...';
const ASSET_CODE = 'USDC';
const ASSET_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

async function performComplianceCheck(accountId, assetCode, assetIssuer) {
  const results = {
    passed: true,
    checks: {},
    errors: [],
    warnings: []
  };

  try {
    // Step 1: Risk Score
    const riskResponse = await axios.get(`${API_BASE}/account/${accountId}/risk-score`);
    results.checks.riskScore = riskResponse.data.data;
    
    if (riskResponse.data.data.riskScore > 75) {
      results.passed = false;
      results.errors.push('Critical risk score detected');
    } else if (riskResponse.data.data.riskScore > 50) {
      results.warnings.push('High risk score - enhanced verification recommended');
    }

    // Step 2: Watchlist Status
    const watchlistResponse = await axios.get(`${API_BASE}/account/${accountId}/watchlist-status`);
    results.checks.watchlist = watchlistResponse.data.data;
    
    if (watchlistResponse.data.data.onWatchlist) {
      results.passed = false;
      results.errors.push(`Account is on watchlist: ${watchlistResponse.data.data.reason}`);
    }

    // Step 3: Inactivity
    const inactivityResponse = await axios.get(`${API_BASE}/account/${accountId}/inactivity`);
    results.checks.inactivity = inactivityResponse.data.data;
    
    if (inactivityResponse.data.data.status === 'dormant') {
      results.warnings.push('Account is dormant (>180 days inactive)');
    }

    // Step 4: Can Receive Asset
    const canReceiveResponse = await axios.get(
      `${API_BASE}/account/${accountId}/can-receive/${assetCode}/${assetIssuer}`
    );
    results.checks.canReceive = canReceiveResponse.data.data;
    
    if (!canReceiveResponse.data.data.canReceive) {
      results.passed = false;
      results.errors.push(`Account cannot receive ${assetCode}: ${canReceiveResponse.data.data.reason}`);
    }

    // Step 5: Freeze Status
    const freezeResponse = await axios.get(
      `${API_BASE}/account/${accountId}/freeze-status/${assetCode}/${assetIssuer}`
    );
    results.checks.freezeStatus = freezeResponse.data.data;
    
    if (freezeResponse.data.data.isFrozen) {
      results.passed = false;
      results.errors.push(`${assetCode} is frozen on this account`);
    }

    return results;

  } catch (error) {
    results.passed = false;
    results.errors.push(`Compliance check failed: ${error.message}`);
    return results;
  }
}

// Usage
(async () => {
  const compliance = await performComplianceCheck(RECIPIENT, ASSET_CODE, ASSET_ISSUER);
  
  if (compliance.passed) {
    console.log('✅ Compliance check passed');
    if (compliance.warnings.length > 0) {
      console.warn('⚠️  Warnings:', compliance.warnings);
    }
    // Proceed with transaction
  } else {
    console.error('❌ Compliance check failed');
    console.error('Errors:', compliance.errors);
    // Reject or flag for manual review
  }
})();
```

---

## Best Practices

### 1. Cache Appropriately

Compliance data changes at different rates:
- **Risk scores**: Cache for 5-10 minutes
- **Watchlist status**: Cache for 60 seconds
- **Freeze status**: Cache for 30 seconds
- **Inactivity**: Cache for 60 seconds

### 2. Handle Errors Gracefully

Always wrap compliance checks in try-catch blocks and have a fallback strategy when checks fail.

### 3. Log All Compliance Checks

Maintain an audit trail of all compliance checks performed, including:
- Timestamp
- Account ID
- Check results
- Decision made
- User who initiated the check

### 4. Implement Progressive Checks

Don't run all checks if early ones fail:
- Run quick checks first (watchlist, freeze status)
- Run expensive checks only if needed (risk scoring, full compliance)

### 5. Combine with Transaction Monitoring

Use compliance endpoints in combination with transaction monitoring:
- Pre-transaction: Check before submitting
- Post-transaction: Monitor for suspicious patterns
- Periodic: Regular compliance reviews for all active accounts

---

## Rate Limiting

Compliance endpoints share the standard StellarKit rate limits:
- **Global limit**: 100 requests per 15 minutes per IP
- **Account endpoint limit**: 30 requests per minute per account

For high-volume compliance workflows, consider:
- Implementing client-side caching
- Batching compliance checks
- Using webhooks for proactive monitoring

---

## Related Documentation

- [Compliance Workflow Guide](./compliance-workflow.md) - Step-by-step KYC/AML workflow and compliance report example
- [Account Endpoints Guide](./account-endpoints.md) - Full list of account endpoints
- [Batch Endpoints Guide](./batch-endpoints.md) - Batch compliance checking
- [Rate Limiting](./rate-limiting.md) - Rate limit details and strategies
- [Error Reference](./error-reference.md) - Error codes and handling

---

## Support

For compliance-related questions or custom integration support:
- GitHub Issues: https://github.com/stellarkit-lab-devtools/stellarkit-api/issues
- Documentation: https://docs.stellarkit.io

---

**Last Updated**: September 28, 2026
