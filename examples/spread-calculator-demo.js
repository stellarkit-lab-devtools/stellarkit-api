/**
 * DEX Spread Calculator Demo
 * 
 * This script demonstrates how to use the /dex/spread/:sellAsset/:buyAsset endpoint
 * to calculate bid-ask spreads for trading pairs on the Stellar DEX.
 * 
 * Usage:
 *   node examples/spread-calculator-demo.js <SELL_ASSET> <BUY_ASSET>
 * 
 * Asset Format: CODE:ISSUER (e.g., XLM:native, USDC:GA5Z...)
 * 
 * Examples:
 *   node examples/spread-calculator-demo.js XLM:native USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
 *   node examples/spread-calculator-demo.js USDC:GA5Z... EURC:GB...
 */

const axios = require('axios');

const API_BASE_URL = process.env.API_URL || 'http://localhost:3000';

async function calculateSpread(sellAsset, buyAsset) {
    try {
        console.log(`\n📊 Calculating spread for trading pair:`);
        console.log(`   Sell: ${sellAsset}`);
        console.log(`   Buy:  ${buyAsset}`);
        console.log();

        const response = await axios.get(
            `${API_BASE_URL}/dex/spread/${sellAsset}/${buyAsset}`
        );

        if (!response.data.success) {
            console.error('❌ Error:', response.data.error);
            return;
        }

        const data = response.data.data;

        console.log(`${'='.repeat(80)}`);
        console.log(`SPREAD ANALYSIS`);
        console.log(`${'='.repeat(80)}`);

        // Best Bid
        if (data.bestBid) {
            console.log(`\n💰 Best Bid (Highest Buy Order):`);
            console.log(`   Price:  ${data.bestBid.price}`);
            console.log(`   Amount: ${data.bestBid.amount}`);
        } else {
            console.log(`\n💰 Best Bid: None`);
        }

        // Best Ask
        if (data.bestAsk) {
            console.log(`\n💵 Best Ask (Lowest Sell Order):`);
            console.log(`   Price:  ${data.bestAsk.price}`);
            console.log(`   Amount: ${data.bestAsk.amount}`);
        } else {
            console.log(`\n💵 Best Ask: None`);
        }

        // Spread
        console.log(`\n📏 Spread:`);
        if (data.spreadAbsolute) {
            console.log(`   Absolute: ${data.spreadAbsolute}`);
            console.log(`   Percent:  ${data.spreadPercent}%`);
        } else {
            console.log(`   Not available (need both bid and ask)`);
        }

        // Mid Price
        if (data.midPrice) {
            console.log(`\n🎯 Mid Price: ${data.midPrice}`);
        }

        // Liquidity Assessment
        console.log(`\n💧 Liquidity: ${data.liquidity.toUpperCase()}`);

        const liquidityEmoji = {
            high: '🟢',
            medium: '🟡',
            low: '🔴'
        };

        console.log(`   ${liquidityEmoji[data.liquidity]} ${getLiquidityDescription(data.liquidity)}`);

        // Order Book Depth
        console.log(`\n📚 Order Book Depth:`);
        console.log(`   Bids:            ${data.orderBookDepth.bids} orders`);
        console.log(`   Asks:            ${data.orderBookDepth.asks} orders`);
        console.log(`   Total Bid Vol:   ${data.orderBookDepth.totalBidVolume}`);
        console.log(`   Total Ask Vol:   ${data.orderBookDepth.totalAskVolume}`);
        console.log(`   Total Volume:    ${data.orderBookDepth.totalVolume}`);

        // Trading Insights
        console.log(`\n💡 Trading Insights:`);

        if (data.bestBid && data.bestAsk) {
            const spreadPercent = parseFloat(data.spreadPercent);

            if (spreadPercent < 0.5) {
                console.log(`   ✅ Tight spread (${data.spreadPercent}%) - Good for trading`);
            } else if (spreadPercent < 2) {
                console.log(`   ⚠️  Moderate spread (${data.spreadPercent}%) - Acceptable for most trades`);
            } else {
                console.log(`   ❌ Wide spread (${data.spreadPercent}%) - Consider limit orders`);
            }
        }

        if (data.liquidity === 'high') {
            console.log(`   ✅ High liquidity - Large orders can be filled easily`);
        } else if (data.liquidity === 'medium') {
            console.log(`   ⚠️  Medium liquidity - Moderate-sized orders supported`);
        } else {
            console.log(`   ❌ Low liquidity - Large orders may impact price significantly`);
        }

        console.log(`\n${'='.repeat(80)}\n`);

    } catch (error) {
        if (error.response) {
            if (error.response.status === 404) {
                console.error('❌ No order book exists for this trading pair');
                console.error('   This pair may not be actively traded on the Stellar DEX');
            } else if (error.response.status === 400) {
                console.error('❌ Invalid asset format:', error.response.data.error.message);
                console.error('\n   Asset format should be: CODE:ISSUER');
                console.error('   Examples:');
                console.error('     - XLM:native');
                console.error('     - USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN');
            } else {
                console.error('❌ API Error:', error.response.data.error);
            }
        } else if (error.request) {
            console.error('❌ Network Error: Could not reach the API');
            console.error('   Make sure the API is running at:', API_BASE_URL);
        } else {
            console.error('❌ Error:', error.message);
        }
    }
}

function getLiquidityDescription(liquidity) {
    const descriptions = {
        high: 'Excellent market depth (≥10,000 total volume)',
        medium: 'Moderate market depth (≥1,000 total volume)',
        low: 'Limited market depth (<1,000 total volume)'
    };
    return descriptions[liquidity] || 'Unknown';
}

// Main execution
const sellAsset = process.argv[2];
const buyAsset = process.argv[3];

if (!sellAsset || !buyAsset) {
    console.error('❌ Error: Please provide both sell and buy assets');
    console.log('\nUsage:');
    console.log('  node examples/spread-calculator-demo.js <SELL_ASSET> <BUY_ASSET>');
    console.log('\nAsset Format: CODE:ISSUER');
    console.log('\nExamples:');
    console.log('  node examples/spread-calculator-demo.js XLM:native USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN');
    console.log('  node examples/spread-calculator-demo.js USDC:GA5Z... EURC:GB...');
    process.exit(1);
}

// Validate asset format
const validateAssetFormat = (asset) => {
    if (!asset.includes(':')) {
        console.error(`❌ Invalid asset format: "${asset}"`);
        console.error('   Expected format: CODE:ISSUER (e.g., XLM:native)');
        process.exit(1);
    }
};

validateAssetFormat(sellAsset);
validateAssetFormat(buyAsset);

calculateSpread(sellAsset, buyAsset);
