/**
 * Transaction Memo Search Demo
 * 
 * This script demonstrates how to use the /account/:id/transactions/search endpoint
 * to search for transactions by memo content.
 * 
 * Usage:
 *   node examples/transaction-search-demo.js <ACCOUNT_ID> <MEMO> [MEMO_TYPE]
 * 
 * Examples:
 *   node examples/transaction-search-demo.js GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7 invoice-123
 *   node examples/transaction-search-demo.js GAAZI4... 12345 id
 *   node examples/transaction-search-demo.js GAAZI4... "payment ref" text
 */

const axios = require('axios');

const API_BASE_URL = process.env.API_URL || 'http://localhost:3000';

async function searchTransactionsByMemo(accountId, memo, memoType = null) {
    try {
        console.log(`\n🔍 Searching transactions for account: ${accountId}`);
        console.log(`📝 Memo: "${memo}"`);
        if (memoType) {
            console.log(`🏷️  Memo Type: ${memoType}`);
        }
        console.log();

        // Build query parameters
        const params = { memo };
        if (memoType) {
            params.memo_type = memoType;
        }

        const response = await axios.get(
            `${API_BASE_URL}/account/${accountId}/transactions/search`,
            { params }
        );

        if (!response.data.success) {
            console.error('❌ Error:', response.data.error);
            return;
        }

        const transactions = response.data.data;
        const meta = response.data.meta;

        console.log(`📊 Found ${meta.count} matching transaction(s)\n`);

        if (transactions.length === 0) {
            console.log('ℹ️  No transactions found matching the search criteria.');
            return;
        }

        transactions.forEach((tx, index) => {
            console.log(`\n${'='.repeat(80)}`);
            console.log(`Transaction #${index + 1}`);
            console.log(`${'='.repeat(80)}`);
            console.log(`Hash: ${tx.hash}`);
            console.log(`Ledger: ${tx.ledger}`);
            console.log(`Created: ${tx.createdAt}`);
            console.log(`Source Account: ${tx.sourceAccount}`);

            console.log(`\n💰 Fee:`);
            console.log(`   Charged: ${tx.feeSummary.chargedInXLM} XLM (${tx.feeSummary.chargedInStroops} stroops)`);
            console.log(`   Per Operation: ${tx.feeSummary.perOperationInXLM} XLM`);

            console.log(`\n📝 Memo:`);
            console.log(`   Type: ${tx.memoType}`);
            console.log(`   Value: ${tx.memo || '(none)'}`);

            console.log(`\n📈 Details:`);
            console.log(`   Operations: ${tx.operationCount}`);
            console.log(`   Successful: ${tx.successful ? '✅ Yes' : '❌ No'}`);
            console.log(`   Fee Account: ${tx.fee.account}`);
        });

        console.log(`\n${'='.repeat(80)}\n`);

        // Show pagination info
        if (meta.hasMore) {
            console.log(`📄 More results available. Use cursor: ${meta.nextCursor}`);
            console.log(`   To fetch next page, add: &cursor=${meta.nextCursor}\n`);
        }

        // Show search summary
        console.log(`📋 Search Summary:`);
        console.log(`   Query: "${meta.searchQuery.memo}"`);
        console.log(`   Memo Type Filter: ${meta.searchQuery.memoType}`);
        console.log(`   Results: ${meta.count} of ${meta.limit} max`);
        console.log(`   Order: ${meta.order}`);
        console.log();

    } catch (error) {
        if (error.response) {
            console.error('❌ API Error:', error.response.data.error);
            if (error.response.data.error.message) {
                console.error('   Message:', error.response.data.error.message);
            }
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
const memo = process.argv[3];
const memoType = process.argv[4] || null;

if (!accountId || !memo) {
    console.error('❌ Error: Please provide account ID and memo value');
    console.log('\nUsage:');
    console.log('  node examples/transaction-search-demo.js <ACCOUNT_ID> <MEMO> [MEMO_TYPE]');
    console.log('\nExamples:');
    console.log('  node examples/transaction-search-demo.js GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7 invoice-123');
    console.log('  node examples/transaction-search-demo.js GAAZI4... 12345 id');
    console.log('  node examples/transaction-search-demo.js GAAZI4... "payment ref" text');
    console.log('\nValid memo types: text, id, hash, return');
    process.exit(1);
}

if (memoType && !['text', 'id', 'hash', 'return'].includes(memoType)) {
    console.error(`❌ Error: Invalid memo type "${memoType}"`);
    console.log('Valid memo types: text, id, hash, return');
    process.exit(1);
}

searchTransactionsByMemo(accountId, memo, memoType);
