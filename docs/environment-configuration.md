# Environment Configuration Guide

This guide explains the Stellar network environment variables and how to configure StellarKit API for development, testing, and production.

## Quick Reference

| Environment | Network | Horizon URL | Use Case |
|---|---|---|---|
| **Development** | `testnet` | `https://horizon-testnet.stellar.org` | Local development, testing features |
| **Staging** | `testnet` | `https://horizon-testnet.stellar.org` | QA, integration testing |
| **Production** | `mainnet` | `https://horizon.stellar.org` | Live transactions with real value |

---

## STELLAR_NETWORK

**Variable:** `STELLAR_NETWORK`  
**Default:** `testnet`  
**Accepted values:** `testnet` or `mainnet`  
**Required:** No (but recommended to set explicitly)

### What Does It Do?

This variable tells StellarKit API which Stellar blockchain network to connect to. It determines:

- Which Horizon server to use for blockchain queries
- Whether testnet-only features (like Friendbot) are available
- The scope of available accounts, transactions, and assets
- Network-specific rate limits and features

### Testnet vs Mainnet

#### **Testnet** (Test SDF Network ; September 2015)

**For:** Development, testing, and experimentation

```env
STELLAR_NETWORK=testnet
```

**Characteristics:**
- Free to use, no real money required
- Accounts and balances reset on a regular cadence
- Friendly for rapid iteration and breaking changes
- Full feature parity with mainnet (for testing purposes)
- Friendbot endpoint available to fund accounts without payment

**Use cases:**
- Building and testing new features
- Integration testing before production
- QA and staging environments
- Learning Stellar development

**Important:**
- Do NOT store production private keys on testnet
- Do NOT use real funds or production accounts on testnet
- Testnet data is not persistent and resets periodically

#### **Mainnet** (Public Global Stellar Network ; September 2015)

**For:** Production deployments with real value

```env
STELLAR_NETWORK=mainnet
```

**Characteristics:**
- Production network where transactions involve real value
- All data is persistent (never reset)
- Accounts, balances, and transaction history are permanent
- Friendbot is NOT available (use real funds to create accounts)
- Subject to network fees for all transactions

**Use cases:**
- Live production deployments
- Real financial applications and payment systems
- Wallet and exchange integrations
- Live trading and market interactions

**Critical warnings:**
- ALWAYS use secure key management (hardware wallets, vaults, etc.)
- ALWAYS use environment-specific configurations
- ALWAYS set `STELLAR_NETWORK=mainnet` explicitly before deploying to production
- ALWAYS test thoroughly on testnet before moving to mainnet
- Do NOT commit mainnet private keys to version control

### Environment-Specific Configuration

```bash
# Development
export STELLAR_NETWORK=testnet

# Production
export STELLAR_NETWORK=mainnet
```

Or in your `.env` file:

```env
# .env.development
STELLAR_NETWORK=testnet

# .env.production
STELLAR_NETWORK=mainnet
```

---

## HORIZON_URL

**Variable:** `HORIZON_URL`  
**Default:** (empty — automatically selected based on `STELLAR_NETWORK`)  
**Required:** No (leave blank in most cases)

### What Does It Do?

Horizon is the HTTP API that bridges your application to the Stellar blockchain. This variable lets you override the default Horizon endpoint — useful for:

- Connecting to private/custom Horizon instances
- Using load balancers or proxies
- Testing with staging Horizon servers
- Deploying to environments with network restrictions

### Default Behavior

When `HORIZON_URL` is left blank, StellarKit API automatically selects:

```javascript
// If STELLAR_NETWORK=testnet
HORIZON_URL = "https://horizon-testnet.stellar.org"

// If STELLAR_NETWORK=mainnet
HORIZON_URL = "https://horizon.stellar.org"
```

**Recommendation:** Leave `HORIZON_URL` blank. The automatic selection is the right choice 99% of the time.

### Custom Horizon Configuration

Only override `HORIZON_URL` if you have a specific reason:

```env
# Private Horizon instance
HORIZON_URL=https://horizon.example.com

# Load-balanced endpoint
HORIZON_URL=https://lb.stellar.example.com

# Staging Horizon server
HORIZON_URL=https://horizon-staging.example.com
```

### Official Horizon Endpoints

- **Testnet:** `https://horizon-testnet.stellar.org`
- **Mainnet:** `https://horizon.stellar.org`
- **Status page:** https://stellar.statuspage.io

### What is Horizon?

Horizon is Stellar's official REST API. StellarKit uses it to:

- Fetch account balances and details
- Query transaction and operation history
- Stream real-time ledger updates
- Look up assets and liquidity pools
- Estimate transaction fees
- Retrieve order book data and trading information

Every API endpoint in StellarKit ultimately queries Horizon for blockchain data.

---

## Network Passphrases

Network passphrases are used internally by the Stellar SDK for transaction signing. You typically don't need to configure these directly, but it's good to understand them:

### Testnet Passphrase
```
Test SDF Network ; September 2015
```

### Mainnet Passphrase
```
Public Global Stellar Network ; September 2015
```

These passphrases ensure that transactions signed on testnet cannot be replayed on mainnet and vice versa. The Stellar SDK handles this automatically.

---

## Quick Setup Examples

### Local Development

```bash
# .env.local
STELLAR_NETWORK=testnet
HORIZON_URL=
PORT=3000
NODE_ENV=development
RATE_LIMIT_MAX=100
CACHE_TTL_MS=5000
```

Start the server:
```bash
npm run dev
# Access testnet at http://localhost:3000
```

Fund a test account:
```bash
npm run seed
# Creates a funded testnet account with Friendbot
```

### Staging Environment

```bash
# .env.staging
STELLAR_NETWORK=testnet
HORIZON_URL=
PORT=3000
NODE_ENV=production
RATE_LIMIT_MAX=500
CACHE_TTL_MS=10000
```

### Production Deployment

```bash
# .env.production
STELLAR_NETWORK=mainnet
HORIZON_URL=
PORT=3000
NODE_ENV=production
RATE_LIMIT_MAX=1000
CACHE_TTL_MS=30000
```

**Before deploying to production:**

1. Set `STELLAR_NETWORK=mainnet` explicitly
2. Test all features on testnet first
3. Use secure key management (no keys in `.env` files)
4. Monitor transaction fees and network congestion
5. Set up proper error logging and alerting

---

## Switching Between Networks

To switch from testnet to mainnet:

1. Update `.env` file:
   ```env
   STELLAR_NETWORK=mainnet
   ```

2. Restart the server:
   ```bash
   npm run dev
   # or
   npm start
   ```

3. Verify connection:
   ```bash
   curl http://localhost:3000/health
   ```

4. All subsequent API calls will use mainnet data

### Verification Checklist

After switching networks, verify:

- ✅ Health check returns correct network: `GET /health`
- ✅ Network status endpoint reflects correct network: `GET /network-status`
- ✅ Account queries use correct account data
- ✅ Transaction history comes from correct network
- ✅ Fees are consistent with current network conditions

---

## Common Configuration Mistakes

### ❌ Mistake 1: Leaving testnet in production

```env
# DON'T DO THIS IN PRODUCTION
STELLAR_NETWORK=testnet  # This will cause real transactions to fail silently!
```

**Solution:** Always set `STELLAR_NETWORK=mainnet` explicitly in production.

### ❌ Mistake 2: Confusing network passphrase with STELLAR_NETWORK

```env
# DON'T DO THIS
STELLAR_NETWORK=Test SDF Network ; September 2015  # Wrong!
```

**Solution:** Use only `testnet` or `mainnet` as values.

### ❌ Mistake 3: Hardcoding Horizon URLs

```env
# DON'T DO THIS
HORIZON_URL=https://horizon-testnet.stellar.org  # Will be stale when URLs change
```

**Solution:** Leave `HORIZON_URL` blank to use defaults.

### ❌ Mistake 4: Using testnet keys in production

```env
# DON'T DO THIS
SECRET_KEY=SBXXXXX...  # If this key is from testnet, don't use it in production!
```

**Solution:** Generate new keys for production and store securely.

---

## Environment-Specific Features

### Testnet-Only Features

Some StellarKit endpoints are only available on testnet:

- **Friendbot:** `GET /utils/friendbot/:accountId` — Funds test accounts
- **Test account creation:** Free account creation without real funds

### Mainnet-Only Considerations

On mainnet, remember:

- Every transaction costs fees (denominated in stroops)
- Account creation requires an initial XLM payment
- Failed transactions consume fees regardless of outcome
- Network congestion can cause variable transaction inclusion times

---

## Troubleshooting

### Problem: "Invalid Horizon URL"

```
Error: Invalid Horizon URL
```

**Solution:** Ensure `HORIZON_URL` (if set) is a valid HTTPS endpoint.

### Problem: "Network not found"

```
Error: Network configuration not found
```

**Solution:** Set `STELLAR_NETWORK` to either `testnet` or `mainnet`.

### Problem: "Account not found" on mainnet queries

```
Error: Account GBXX... does not exist on the network
```

**Possible causes:**
- Account exists on testnet but not mainnet (expected)
- Account address is incorrect
- `STELLAR_NETWORK` is set to wrong value

**Solution:** Verify the account exists on the network you're querying.

### Problem: Slow API responses

**Possible causes:**
- Horizon server congestion
- Network latency
- Large result sets

**Solution:**
- Check Horizon status at https://stellar.statuspage.io
- Use pagination for large result sets
- Consider caching frequently-accessed data

---

## References

- [Stellar Networks Documentation](https://developers.stellar.org/docs/learn/networks)
- [Horizon API Reference](https://developers.stellar.org/docs/data/apis/horizon)
- [Stellar Status Page](https://stellar.statuspage.io)
- [Stellar SDK Documentation](https://github.com/stellar/py-stellar-base)

---

## Summary

| Setting | Development | Production |
|---|---|---|
| `STELLAR_NETWORK` | `testnet` | `mainnet` |
| `HORIZON_URL` | (empty) | (empty) |
| `NODE_ENV` | `development` | `production` |
| Data persistence | ❌ Resets periodically | ✅ Permanent |
| Real value at risk | ❌ No | ✅ Yes |
| Friendbot available | ✅ Yes | ❌ No |
| Key management | Relaxed | 🔒 Strict |
