# Configuration Validation Checklist

Use this document to validate that your environment is configured correctly for development or production.

## Pre-Configuration Checklist

- [ ] You have read `.env.example`
- [ ] You understand the difference between testnet and mainnet
- [ ] You know which network you're targeting (development = testnet, production = mainnet)
- [ ] You have created a `.env` file from `.env.example`
- [ ] You have installed dependencies (`npm install`)

---

## Development Environment Validation (Testnet)

### Configuration

- [ ] `STELLAR_NETWORK` is set to `testnet`
- [ ] `HORIZON_URL` is left empty or set to `https://horizon-testnet.stellar.org`
- [ ] `PORT` is configured to a value you can use (default 3000)
- [ ] `NODE_ENV` is set to `development`
- [ ] `RATE_LIMIT_MAX` is reasonable for development (default 100 is fine)

### Verification

Run these commands to verify your configuration:

```bash
# 1. Start the server
npm run dev

# 2. In another terminal, check health
curl http://localhost:3000/health
# Expected response includes "network": "testnet"

# 3. Check network status
curl http://localhost:3000/network-status
# Should show testnet ledger information

# 4. Create a test account with Friendbot
npm run seed
# Should output a funded public/secret key pair

# 5. Query that account
curl http://localhost:3000/account/[PUBLIC_KEY_FROM_SEED]
# Should show account details with balances
```

### Success Criteria ✅

- [ ] Server starts without errors
- [ ] Health check returns `"network": "testnet"`
- [ ] Network status shows testnet data
- [ ] Friendbot successfully funds test account
- [ ] Account query returns valid balance information
- [ ] All responses follow the standard envelope format (success, data, meta)

### Troubleshooting

| Issue | Solution |
|-------|----------|
| "Cannot find STELLAR_NETWORK" | Check that STELLAR_NETWORK is set in your `.env` file |
| "Invalid network" | Verify STELLAR_NETWORK is set to `testnet` (not "testnet" with typo) |
| "Connection refused" | Ensure you haven't changed the PORT in `.env` without updating your curl commands |
| "Account not found" | Wait a moment and try again (Horizon may have latency) |

---

## Production Environment Validation (Mainnet)

### Pre-Production Checklist

**⚠️ CRITICAL - Complete ALL of these before deploying to mainnet:**

- [ ] All features have been tested thoroughly on testnet
- [ ] Code review is complete
- [ ] Tests pass (`npm test`)
- [ ] Lint passes (`npm run lint`)
- [ ] Error handling is comprehensive
- [ ] Logging and monitoring are configured
- [ ] Private keys are stored securely (never in `.env` files)
- [ ] Backup and recovery procedures are documented
- [ ] You have reviewed the [Testnet vs Mainnet guide](./TESTNET_vs_MAINNET.md)
- [ ] You have a rollback plan if something goes wrong

### Configuration

- [ ] `STELLAR_NETWORK` is explicitly set to `mainnet` (**NOT** commented out, **NOT** a variable)
- [ ] `HORIZON_URL` is left empty or set to `https://horizon.stellar.org`
- [ ] `PORT` matches your deployment environment
- [ ] `NODE_ENV` is set to `production`
- [ ] `RATE_LIMIT_MAX` is set to a reasonable value for your expected traffic
- [ ] `CACHE_TTL_MS` is optimized for your use case (consider setting higher in production)

### Mainnet-Specific Configuration

- [ ] Private keys are NOT stored in `.env` files
- [ ] Private keys are stored in secure vault or HSM
- [ ] Key rotation procedure is documented
- [ ] Key access is logged and monitored
- [ ] API is behind authentication/authorization
- [ ] CORS is configured appropriately
- [ ] Rate limiting is enforced
- [ ] DDoS protection is in place

### Verification Steps

```bash
# 1. Verify STELLAR_NETWORK is set to mainnet
echo $STELLAR_NETWORK  # Should output: mainnet

# 2. Verify the configuration is production-grade
grep STELLAR_NETWORK .env  # Should show: STELLAR_NETWORK=mainnet

# 3. Start the server
npm start

# 4. Check health endpoint
curl https://your-domain/health
# Expected response includes "network": "mainnet"

# 5. Check network status
curl https://your-domain/network-status
# Should show MAINNET ledger information

# 6. Verify with a known mainnet account
curl https://your-domain/account/[KNOWN_MAINNET_ACCOUNT_ID]
# Should return valid mainnet account data
```

### Success Criteria ✅

- [ ] Server starts without errors
- [ ] Health check returns `"network": "mainnet"`
- [ ] Network status shows MAINNET data (NOT testnet)
- [ ] Account queries return valid mainnet data
- [ ] All requests use HTTPS (production requirement)
- [ ] Error messages don't expose sensitive information
- [ ] Logging captures all transactions and errors
- [ ] Monitoring alerts are active

### Production Safety Checks

```bash
# BEFORE deploying to mainnet, run these safety checks:

# 1. Verify your STELLAR_NETWORK is mainnet
cat .env | grep STELLAR_NETWORK
# Should output: STELLAR_NETWORK=mainnet (not testnet!)

# 2. Verify no testnet strings in your production code
grep -r "testnet" src/
# Should output: NOTHING (or only in comments)

# 3. Verify no private keys in your repository
grep -r "SECRET_" .
# Should output: NOTHING matching actual keys (only env var names)

# 4. Verify all tests pass
npm test
# All tests should pass

# 5. Verify no lint errors
npm run lint
# Should output: no errors
```

### Common Production Mistakes to Avoid

- ❌ Forgetting to set STELLAR_NETWORK=mainnet
- ❌ Leaving testnet values in production config
- ❌ Storing private keys in .env files
- ❌ Not testing thoroughly on testnet first
- ❌ No monitoring or alerting in place
- ❌ No error handling for network failures
- ❌ No rate limiting or DDoS protection
- ❌ Exposing error details to users
- ❌ No backup of important data
- ❌ No rollback plan for emergencies

---

## Network Switching Validation

If you're switching from testnet to mainnet:

### Before Switching

- [ ] Create a new environment-specific `.env` file (don't modify the testnet one)
- [ ] Update `STELLAR_NETWORK=mainnet`
- [ ] Verify the configuration is complete
- [ ] Run through all verification steps above

### During Switching

- [ ] Stop the current server
- [ ] Load the production `.env` file
- [ ] Start the server with new configuration
- [ ] Verify health check shows mainnet
- [ ] Monitor error logs for issues

### After Switching

- [ ] Confirm all API endpoints return mainnet data
- [ ] Test with a known mainnet account
- [ ] Monitor the server for errors
- [ ] Keep testnet version running for emergency rollback
- [ ] Monitor transaction fees and network conditions

---

## Verification Test Cases

### Testnet Verification

```bash
# Test 1: Create funded account
curl http://localhost:3000/utils/friendbot/[NEW_ADDRESS]
# Expected: Success response

# Test 2: Query the account
curl http://localhost:3000/account/[NEW_ADDRESS]
# Expected: Account details with XLM balance

# Test 3: Check network status
curl http://localhost:3000/network-status
# Expected: "network": "testnet" in response

# Test 4: Verify Horizon connectivity
curl http://localhost:3000/health
# Expected: "status": "ok" with testnet info
```

### Mainnet Verification

```bash
# Test 1: Query a known account (use your own if available)
curl https://your-domain/account/[KNOWN_MAINNET_ADDRESS]
# Expected: Account details

# Test 2: Check network status
curl https://your-domain/network-status
# Expected: "network": "mainnet" in response, current mainnet ledger info

# Test 3: Verify Horizon connectivity
curl https://your-domain/health
# Expected: "status": "ok" with mainnet info

# Test 4: Check rate limiting
for i in {1..10}; do curl https://your-domain/network-status; done
# Expected: No rate limit errors with default limit (should allow 10 requests)
```

---

## Configuration Troubleshooting

### "Network not found" Error

**Symptoms:**
```
Error: Network configuration not found for: testnet
```

**Causes:**
- STELLAR_NETWORK environment variable not set
- Wrong value in STELLAR_NETWORK (typo, wrong case)
- .env file not loaded properly

**Solution:**
```bash
# 1. Verify .env file exists
ls -la .env

# 2. Check the value
grep STELLAR_NETWORK .env

# 3. Ensure it's exactly "testnet" or "mainnet"

# 4. Reload environment
source .env  # or restart the application
```

### "Cannot connect to Horizon" Error

**Symptoms:**
```
Error: Failed to connect to Horizon: [HORIZON_URL]
```

**Causes:**
- Network connectivity issue
- Horizon server is down
- Incorrect HORIZON_URL
- Firewall blocking access

**Solution:**
```bash
# 1. Verify connectivity to Horizon
curl https://horizon-testnet.stellar.org/  # Should return HTML page

# 2. Check your HORIZON_URL setting
grep HORIZON_URL .env

# 3. Check Horizon status
# Visit: https://stellar.statuspage.io

# 4. If behind firewall, verify HTTPS port 443 is open
```

### "Invalid account ID" Error

**Symptoms:**
```
Error: Invalid Stellar account ID
```

**Causes:**
- Account ID doesn't start with 'G'
- Account ID has typo
- Account ID is for wrong network (testnet vs mainnet)

**Solution:**
```bash
# Valid testnet/mainnet account ID format:
# G + 55 alphanumeric characters = 56 total

# Example: GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN

# Verify your account ID length
echo "Your_Account_ID" | wc -c
# Should be 57 (56 chars + newline)
```

---

## Post-Deployment Monitoring

### Daily Checks

- [ ] Server is running and responding to requests
- [ ] No unusual error rates in logs
- [ ] Response times are normal (<1 second)
- [ ] Rate limiting is working as expected
- [ ] Network status shows correct network (mainnet if production)

### Weekly Checks

- [ ] Review transaction history for any anomalies
- [ ] Check for any failed operations
- [ ] Verify account balances are as expected
- [ ] Review and rotate access logs
- [ ] Check backup systems are working

### Monthly Checks

- [ ] Review security logs
- [ ] Update dependencies if needed
- [ ] Test disaster recovery procedures
- [ ] Review and optimize cache settings
- [ ] Audit all access to sensitive configuration

---

## Quick Reference

### Testnet Configuration
```env
STELLAR_NETWORK=testnet
HORIZON_URL=
NODE_ENV=development
PORT=3000
```

### Mainnet Configuration
```env
STELLAR_NETWORK=mainnet
HORIZON_URL=
NODE_ENV=production
PORT=3000
```

### Quick Verify Command
```bash
# Returns which network you're connected to
curl http://localhost:3000/health | grep network
```

---

## When to Reach Out for Help

If validation fails at any step:

1. **Check the error message** - Is it in this guide?
2. **Check `.env.example`** - Did you miss a variable?
3. **Review [environment-configuration.md](./environment-configuration.md)** - Comprehensive guide
4. **Check [TESTNET_vs_MAINNET.md](./TESTNET_vs_MAINNET.md)** - Network differences
5. **Consult official docs** - https://developers.stellar.org

---

## Validation Success 🎉

If you can check ✅ all boxes in the appropriate section above, your environment is properly configured!

**Development (Testnet):** Ready to build and test features  
**Production (Mainnet):** Ready to deploy with real transactions

Good luck with your Stellar project!
