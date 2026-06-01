/**
 * Pool Positions Demo
 * 
 * This script demonstrates how to use the /account/:id/pool-positions endpoint
 * to retrieve and display liquidity pool positions for a Stellar account.
 * 
 * Usage:
 *   node examples/pool-positions-demo.js <ACCOUNT_ID>
 * 
 * Example:
 *   node examples/pool-positions-demo.js GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7
 */

const axios = require('axios');

const API_BASE_URL = process.env.API_URL || 'http://localhost:3000';

async function getPoolPositions(accountId) {
    try {
        console.log(`\n🔍 Fetching pool positions for account: ${accountId}\n`);

        const response = await axios.get(`${API_BASE_URL}/account/${accountId}/pool-positions`);

        if (!response.data.success) {
            console.error('❌ Error:', response.data.error);
            return;
        }

        const positions = response.data.data;
        const meta = response.data.meta;

        console.log(`📊 Found ${meta.count} liquidity pool position(s)\n`);

        if (positions.length === 0) {
            console.log('ℹ️  This account has no liquidity pool positions.');
            return;
        }

        positions.forEach((position, index) => {
            console.log(`\n${'='.repeat(80)}`);
            console.log(`Position #${index + 1}`);
            console.log(`${'='.repeat(80)}`);
            console.log(`Pool ID: ${position.poolId}`);
            console.log(`\n💰 Your Position:`);
            console.log(`   Shares: ${position.shares}`);
            console.log(`   Share %: ${position.sharePercent}%`);
            console.log(`   Total Pool Shares: ${position.totalPoolShares}`);

            console.log(`\n🏦 Reserve A:`);
            console.log(`   Asset: ${position.reserveA.asset}`);
            console.log(`   Your Amount: ${position.reserveA.equivalentAmount}`);
            console.log(`   Total Pool Amount: ${position.reserveA.totalAmount}`);

            console.log(`\n🏦 Reserve B:`);
            console.log(`   Asset: ${position.reserveB.asset}`);
            console.log(`   Your Amount: ${position.reserveB.equivalentAmount}`);
            console.log(`   Total Pool Amount: ${position.reserveB.totalAmount}`);

            console.log(`\n📈 Pool Stats:`);
            console.log(`   Fee: ${position.feeBp} basis points (${(position.feeBp / 100).toFixed(2)}%)`);
            console.log(`   Total Trustlines: ${position.totalTrustlines}`);
            console.log(`   Last Modified Ledger: ${position.lastModifiedLedger}`);

            // Calculate total value in terms of Reserve A
            const totalValueInReserveA = parseFloat(position.reserveA.equivalentAmount);
            const totalValueInReserveB = parseFloat(position.reserveB.equivalentAmount);

            console.log(`\n💵 Position Value:`);
            console.log(`   ${totalValueInReserveA.toFixed(7)} ${position.reserveA.asset.split(':')[0] || 'XLM'}`);
            console.log(`   + ${totalValueInReserveB.toFixed(7)} ${position.reserveB.asset.split(':')[0] || 'XLM'}`);
        });

        console.log(`\n${'='.repeat(80)}\n`);

    } catch (error) {
        if (error.response) {
            console.error('❌ API Error:', error.response.data.error);
        } else if (error.request) {
            console.error('❌ Network Error: Could not reach the API');
            console.error('   Make sure the API is running at:', API_BASE_URL);
        } else {
            console.error('❌ Error:', error.message);
        }
    }
}

// Main execution
const accountId = process.argv[2];

if (!accountId) {
    console.error('❌ Error: Please provide a Stellar account ID');
    console.log('\nUsage:');
    console.log('  node examples/pool-positions-demo.js <ACCOUNT_ID>');
    console.log('\nExample:');
    console.log('  node examples/pool-positions-demo.js GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7');
    process.exit(1);
}

getPoolPositions(accountId);
