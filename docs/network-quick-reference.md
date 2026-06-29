# Stellar Network Quick Reference

A fast lookup guide for Stellar network configuration, endpoints, and common values.

## Network Selection

```bash
# Development / Testing
export STELLAR_NETWORK=testnet

# Production
export STELLAR_NETWORK=mainnet
```

## Horizon Endpoints

| Network | URL | Status | Lag |
|---------|-----|--------|-----|
| **Testnet** | `https://horizon-testnet.stellar.org` | [View](https://stellar.statuspage.io) | ~3-5 sec |
| **Mainnet** | `https://horizon.stellar.org` | [View](https://stellar.statuspage.io) | ~3-5 sec |

## Network Passphrases

| Network | Passphrase |
|---------|-----------|
| **Testnet** | `Test SDF Network ; September 2015` |
| **Mainnet** | `Public Global Stellar Network ; September 2015` |
| **Futurenet** | `Test SDF Future Network ; October 2022` |
| **Standalone** | `Standalone Network ; February 2017` |

*Note: StellarKit API uses testnet and mainnet. Passphrases are shown for reference when using the Stellar SDK directly.*

## Account Creation

| Network | Method | Cost | Speed |
|---------|--------|------|-------|
| **Testnet** | Friendbot API | Free | Instant |
| **Mainnet** | Payment operation | ~0.5 XLM | 3-5 sec |

**Testnet Friendbot:**
```bash
# Via StellarKit API
curl http://localhost:3000/utils/friendbot/GADDRESS

# Via official Friendbot
curl https://friendbot.stellar.org/?addr=GADDRESS
```

## Key Stellar Values

### Base Units
- **1 XLM** = 10,000,000 stroops
- **Base Fee** ≈ 100 stroops (0.00001 XLM) per operation
- **Minimum Account Balance** = 2 base reserves (1 XLM)
- **Base Reserve** = 0.5 XLM per item

### Network Info
- **Consensus time** ≈ 5 seconds per ledger
- **Ledger close interval** ≈ 3-6 seconds
- **Transaction timeout** ≈ 1 hour
- **Historical data retention** ≈ 1 year

## Common Stellar Account Addresses

| Network | Type | Example |
|---------|------|---------|
| Any | Public Key | `G...` (56 chars) |
| Any | Secret Key | `S...` (56 chars) |
| Testnet | Test Master | Use Friendbot-funded account |

## Quick API Checks

```bash
# Health check (confirms network connectivity)
curl http://localhost:3000/health

# Network status (shows current ledger & fees)
curl http://localhost:3000/network-status

# Fee estimate (3 operations)
curl http://localhost:3000/fee-estimate?operationCount=3

# Account lookup
curl http://localhost:3000/account/GADDRESS

# Stream test accounts
curl https://friendbot.stellar.org/?addr=GADDRESS  # testnet only
```

## Configuration Template

```env
# Copy this to .env and customize

# ========== NETWORK ==========
# Use: testnet (for development) or mainnet (for production)
STELLAR_NETWORK=testnet

# Leave empty to use default Horizon servers
HORIZON_URL=

# ========== SERVER ==========
PORT=3000
NODE_ENV=development

# ========== RATE LIMITING ==========
# Requests per 15 minutes per IP
RATE_LIMIT_MAX=100

# ========== CACHING ==========
# TTL in milliseconds (network-status, fee-estimate)
CACHE_TTL_MS=5000
```

## Deployment Checklist

- [ ] Is `STELLAR_NETWORK` set to `mainnet` for production?
- [ ] Are all private keys stored securely (not in `.env`)?
- [ ] Have you tested thoroughly on testnet first?
- [ ] Is error logging and monitoring configured?
- [ ] Is rate limiting appropriate for your use case?
- [ ] Have you reviewed the [full configuration guide](./environment-configuration.md)?

## Useful Links

- **Stellar Docs:** https://developers.stellar.org
- **Network Status:** https://stellar.statuspage.io
- **Testnet Account Funder:** https://friendbot.stellar.org
- **Horizon API Reference:** https://developers.stellar.org/docs/data/apis/horizon
- **Stellar SDK:** https://github.com/stellar/py-stellar-base
- **StellarKit API Repository:** https://github.com/stellarkit-lab-devtools/stellarkit-api

## Glossary Terms

| Term | Meaning |
|------|---------|
| **Stroop** | Smallest unit of XLM (0.00000001 XLM) |
| **Base Fee** | Minimum fee per operation (~100 stroops) |
| **Ledger** | A block-like structure recording all state changes |
| **Horizon** | REST API for querying Stellar data |
| **Testnet** | Testing network; resets periodically |
| **Mainnet** | Production network; data is permanent |
| **Friendbot** | Testnet faucet that funds accounts |
| **Trustline** | Agreement to hold an asset |
| **Offer** | On-ledger buy/sell order for DEX trading |

## Network Behavior

### Testnet
- ✅ Free to use
- ✅ Accounts reset periodically
- ✅ Friendbot available
- ❌ Data not persistent
- ❌ Not for real value

### Mainnet
- ✅ Data persistent
- ✅ All features available
- ✅ Real settlement
- ❌ Requires real funds
- ❌ Friendbot not available
- ⚠️ **Use secure key management**

---

**Need more details?** See the [full environment configuration guide](./environment-configuration.md).
