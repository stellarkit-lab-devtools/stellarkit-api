# Examples

Self-contained Node.js scripts demonstrating real Stellar workflows built on StellarKit.

## Prerequisites

```bash
npm install
cp .env.example .env
```

## Scripts

### check-account.js
Fetch account balances, age, and risk score.
```bash
node examples/check-account.js GABC1234...
```

### monitor-fees.js
Poll fee estimates every 10 seconds and log surge status.
```bash
node examples/monitor-fees.js
```

### dex-spread.js
Fetch the current DEX spread between XLM and USDC.
```bash
node examples/dex-spread.js
```
