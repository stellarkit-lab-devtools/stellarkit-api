#!/usr/bin/env node
/**
 * Example: check-account.js
 * Fetch account balances, age, and risk score using StellarKit.
 * Usage: node examples/check-account.js <stellar-address>
 */

const { StellarKit } = require('../sdk');

async function checkAccount(address) {
  const kit = new StellarKit();

  console.log(`Checking account: ${address}\n`);

  // Fetch balance
  const balance = await kit.accounts.getBalance(address);
  console.log('Balances:');
  balance.balances.forEach(b => {
    const asset = b.asset_type === 'native' ? 'XLM' : `${b.asset_code}:${b.asset_issuer}`;
    console.log(`  ${asset}: ${b.balance}`);
  });

  // Risk score
  try {
    const risk = await kit.accounts.getRiskScore(address);
    console.log(`\nRisk Score: ${risk.score} (${risk.level})`);
  } catch (e) {
    console.log('\nRisk Score: unavailable');
  }
}

const address = process.argv[2];
if (!address) {
  console.error('Usage: node examples/check-account.js <stellar-address>');
  process.exit(1);
}
checkAccount(address).catch(console.error);
