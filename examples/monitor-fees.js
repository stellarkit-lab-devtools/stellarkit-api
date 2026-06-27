#!/usr/bin/env node
/**
 * Example: monitor-fees.js
 * Poll /fee-estimate every 10 seconds and log surge status.
 * Usage: node examples/monitor-fees.js
 */

const { StellarKit } = require('../sdk');

async function monitorFees() {
  const kit = new StellarKit();
  console.log('Monitoring Stellar fee estimates (every 10s). Ctrl+C to stop.\n');

  const poll = async () => {
    try {
      const fee = await kit.fees.getFeeEstimate();
      const surge = await kit.fees.getSurgeStatus();
      const ts = new Date().toISOString();
      console.log(`[${ts}] base_fee=${fee.base_fee} | p50=${fee.fee_charged?.p50 || 'n/a'} | surge=${surge.is_surge ? 'YES' : 'no'}`);
    } catch (e) {
      console.error(`Error: ${e.message}`);
    }
  };

  await poll();
  setInterval(poll, 10_000);
}

monitorFees();
