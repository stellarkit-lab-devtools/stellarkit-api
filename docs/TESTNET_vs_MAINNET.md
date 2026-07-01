# Testnet vs Mainnet: Complete Comparison

A detailed side-by-side comparison to help you choose the right network for your needs.

## At a Glance

| Feature | Testnet | Mainnet |
|---------|---------|---------|
| **Purpose** | Development & Testing | Production & Real Value |
| **Configuration** | `STELLAR_NETWORK=testnet` | `STELLAR_NETWORK=mainnet` |
| **Horizon URL** | `https://horizon-testnet.stellar.org` | `https://horizon.stellar.org` |
| **Data Persistence** | ❌ Resets periodically | ✅ Permanent |
| **Transaction Costs** | 💰 Free | 💰 Real fees (~0.00001 XLM per operation) |
| **Real Value Risk** | ❌ No | ✅ Yes |
| **Account Funding** | ✅ Friendbot (instant, free) | ❌ Payment required (~0.5 XLM minimum) |
| **Key Reuse Safety** | ⚠️ Don't use mainnet keys | 🔒 Secure keys only |

---

## Detailed Comparison

### Testnet (Test SDF Network ; September 2015)

#### When to Use
✅ **Development and local testing**
- Building new features
- Learning Stellar development
- Experimenting with API behavior

✅ **Staging and QA**
- Pre-production testing
- Integration testing
- Load testing (within reasonable limits)

✅ **Education**
- Training and workshops
- Proof-of-concept projects
- Blockchain learning

#### Characteristics

**Data & Accounts**
- Accounts are temporary and reset periodically
- Balances and transactions do not persist permanently
- All data is publicly accessible
- Account history may be pruned

**Account Creation**
- Use **Friendbot** to fund accounts instantly
- No real payment required
- Accounts created immediately
- Can fund multiple test accounts

**Transaction Costs**
- All operations are **free**
- No fee calculation required
- No surge pricing or congestion issues
- Ideal for testing fee-sensitive logic

**Network Stability**
- May experience downtime for updates
- Network resets possible (usually announced)
- Network changes tested before mainnet
- Consensus and performance match mainnet

**Available Features**
- ✅ All standard Stellar features
- ✅ Full API functionality
- ✅ WebSocket streaming
- ✅ All asset and trading features
- ✅ Liquidity pools
- ✅ Smart contracts (soroban)

#### Configuration Example

```env
# .env.development
STELLAR_NETWORK=testnet
HORIZON_URL=
PORT=3000
NODE_ENV=development
```

#### Quick Start

```bash
# 1. Fund a test account using Friendbot
npm run seed

# Output:
# Public Key: GA... (use this for account queries)
# Secret Key: SA... (keep this secret and don't use on mainnet)

# 2. Make API calls against testnet
curl http://localhost:3000/account/GA...

# 3. Send test transactions
# Use your secret key to sign transactions
```

#### Important Warnings ⚠️

```
❌ DO NOT:
  • Store mainnet private keys on testnet
  • Use real funds or production accounts
  • Run load tests without coordinating with SDF
  • Assume testnet data persists between resets
  • Use mainnet account addresses

✅ DO:
  • Generate fresh keypairs for testnet
  • Test thoroughly before moving to mainnet
  • Monitor testnet for announced resets
  • Document your test patterns
  • Clean up test data periodically
```

---

### Mainnet (Public Global Stellar Network ; September 2015)

#### When to Use
✅ **Production deployments**
- Live applications serving real users
- Payment processing systems
- Financial applications with real value

✅ **Real transactions**
- Trading on Stellar DEX
- Issuing assets with real value
- Multi-signature account management
- Complex financial operations

✅ **Public infrastructure**
- Anchor services
- Wallet providers
- Exchange integrations
- Enterprise applications

#### Characteristics

**Data & Accounts**
- All transactions and data are **permanent**
- Balances and history never reset
- Complete immutable record of all activity
- Data retention: ~1 year in Horizon

**Account Creation**
- Requires initial payment (~0.5 XLM minimum)
- No automatic funding available
- Must acquire XLM to create accounts
- Accounts persist permanently once created

**Transaction Costs**
- Every operation costs real XLM
- Base fee: ~100 stroops (0.00001 XLM) per operation
- **Surge pricing during high congestion**
- Fees directly impact profitability

**Network Stability**
- Production-grade uptime (99.9%+)
- Monitored by Stellar Development Foundation
- Regular security audits
- Multiple geographic Horizon instances

**Available Features**
- ✅ All standard Stellar features
- ✅ Full production-grade API
- ✅ Real settlement and finality
- ✅ Real market liquidity
- ✅ Regulatory compliance frameworks
- ✅ Enterprise features

#### Configuration Example

```env
# .env.production
STELLAR_NETWORK=mainnet
HORIZON_URL=
PORT=3000
NODE_ENV=production
RATE_LIMIT_MAX=1000
```

#### Important Warnings ⚠️

```
❌ DO NOT:
  • Use testnet private keys
  • Deploy without testing on testnet first
  • Ignore network fees in your calculations
  • Store unencrypted private keys
  • Deploy without monitoring
  • Manually test with large amounts

✅ DO:
  • Use secure key management (hardware wallets, vaults)
  • Test thoroughly on testnet first
  • Monitor transactions and fees
  • Implement proper error handling
  • Set up alerting for failures
  • Keep audit logs of all transactions
  • Test with small amounts first
  • Use environment-specific configuration
```

---

## Decision Tree: Which Network?

```
Are you building a new feature?
├─ YES → Use TESTNET
│        └─ Once tested and stable...
│           Are you deploying to production?
│           ├─ NO → Stay on TESTNET
│           └─ YES → Move to MAINNET
│
└─ NO → Already have production code?
        ├─ YES, running in production → Use MAINNET
        ├─ NO, still in development → Use TESTNET
        └─ Need to test before production → Use TESTNET first
```

---

## Network Setup Checklist

### Before Testnet Development

- [ ] Have Node.js installed (v18+)
- [ ] Know your local machine's IP address
- [ ] Have `npm` package manager available
- [ ] Understand Stellar's core concepts (see glossary)

### Before Mainnet Deployment

- [ ] ✅ All features tested thoroughly on testnet
- [ ] ✅ Code review completed
- [ ] ✅ Private keys stored securely (not in code)
- [ ] ✅ Environment variables configured correctly
- [ ] ✅ Monitoring and alerting in place
- [ ] ✅ Error handling and recovery procedures documented
- [ ] ✅ Fee estimation and budgeting completed
- [ ] ✅ Regulatory compliance verified
- [ ] ✅ Disaster recovery plan in place
- [ ] ✅ STELLAR_NETWORK explicitly set to `mainnet`

---

## Common Scenarios

### Scenario 1: Learning Stellar

```bash
# Use testnet
export STELLAR_NETWORK=testnet

# Get free testnet funds
npm run seed

# Experiment with API calls
curl http://localhost:3000/account/GA...
```

**Why testnet:** Free, unlimited test accounts, no financial risk

---

### Scenario 2: Building a New Feature

```bash
# 1. Develop on testnet
export STELLAR_NETWORK=testnet
npm run dev

# 2. Test thoroughly
npm test

# 3. Verify with real transactions on testnet
# (Use your funded testnet account)

# 4. Once stable, configure for mainnet
export STELLAR_NETWORK=mainnet

# 5. Deploy with proper monitoring
npm start
```

**Why start with testnet:** Lower risk, faster iteration, free testing

---

### Scenario 3: Production Wallet Service

```bash
# Development
STELLAR_NETWORK=testnet
NODE_ENV=development

# Staging (also on testnet)
STELLAR_NETWORK=testnet
NODE_ENV=production

# Production (real users, real value)
STELLAR_NETWORK=mainnet
NODE_ENV=production
# + Secure key management
# + Monitoring and alerting
# + Compliance checks
```

**Why this approach:** Safe progression from test → production

---

### Scenario 4: DEX Trading Bot

```bash
# Phase 1: Algorithm testing
STELLAR_NETWORK=testnet
# Validate trading logic with fake assets

# Phase 2: Live market simulation
STELLAR_NETWORK=testnet
# Test against real testnet market (less volume than mainnet)

# Phase 3: Small-scale production
STELLAR_NETWORK=mainnet
# Start with minimal capital
# Monitor performance carefully

# Phase 4: Scale up
STELLAR_NETWORK=mainnet
# Increase trading volume gradually
```

**Why this approach:** Reduces financial risk while validating trading strategy

---

## Horizon Server Behavior

### Testnet Horizon (`https://horizon-testnet.stellar.org`)

**Performance:**
- Response time: 3-5 seconds typical
- Throughput: Handles development-scale queries
- Uptime: May experience scheduled downtime

**Data:**
- Historical data: ~1 year retained
- Reset frequency: Varies (announced in advance)
- Access: Publicly accessible, no authentication

**Rate Limiting:**
- Rate limit: 3,600 requests per hour (typical)
- Burst: Up to 600 per 10 seconds
- Recommendation: Use locally during heavy testing

### Mainnet Horizon (`https://horizon.stellar.org`)

**Performance:**
- Response time: 3-5 seconds typical
- Throughput: Handles production-scale queries
- Uptime: 99.9%+ availability SLA

**Data:**
- Historical data: ~1 year retained (as of 2024)
- Reset frequency: Never (data is permanent)
- Access: Publicly accessible, no authentication required

**Rate Limiting:**
- Rate limit: 3,600 requests per hour (typical)
- Burst: Up to 600 per 10 seconds
- Recommendation: Consider running private Horizon for high-volume apps

**Monitoring:**
- Status page: https://stellar.statuspage.io
- Real-time alerts for outages

---

## Key Numbers to Remember

### Testnet
- **Base Fee:** ~100 stroops per operation (essentially free)
- **Account Creation:** Free (via Friendbot)
- **Minimum Balance:** 1 XLM (same as mainnet, but free)
- **Friendly to:** Developers, testers, learners

### Mainnet
- **Base Fee:** ~100 stroops per operation (≈ $0.000001 USD at current rates)
- **Account Creation:** ~0.5 XLM (~$0.05 USD)
- **Transaction cost (3 ops):** ~300 stroops (0.00003 XLM)
- **Cost to break even on wallet:** ~2-4 XLM (~$0.20-0.40 USD)
- **Friendly to:** Production apps, financial services, traders

---

## Troubleshooting Network Issues

### Problem: "Account not found on testnet" but I just created it

**Likely cause:** Horizon has network latency or the account wasn't actually created

```bash
# Try again after a moment
curl https://horizon-testnet.stellar.org/accounts/GADDRESS

# If still failing:
npm run seed  # Create a new account with Friendbot directly
```

### Problem: "Insufficient funds" on mainnet after creating account

**Likely cause:** Account was created but doesn't have enough XLM for operations

```bash
# Solution: Add more XLM to the account
# - Send XLM from exchange
# - Or use another funded account to send XLM

# Check current balance
curl https://horizon.stellar.org/accounts/GADDRESS
```

### Problem: Transaction succeeded on testnet but failed on mainnet

**Likely cause:** Different network conditions or account state

```bash
# Always check:
1. Account sequence number (must match)
2. Available balance (includes minimum reserve)
3. Network fees (may be different)
4. Asset trust lines (may not exist on mainnet)
```

---

## Decision Summary

**Use TESTNET when:**
- Building or testing a feature
- Learning Stellar development
- Validating designs before production
- Creating proof-of-concepts
- Running automated tests

**Use MAINNET when:**
- Deploying to production
- Processing real transactions
- Managing real user funds
- Trading real assets
- Running in a production environment

---

## Quick Reference

```bash
# Development (testnet)
STELLAR_NETWORK=testnet
HORIZON_URL=https://horizon-testnet.stellar.org

# Production (mainnet)
STELLAR_NETWORK=mainnet
HORIZON_URL=https://horizon.stellar.org
```

**Remember:** Always test thoroughly on testnet before deploying to mainnet!
