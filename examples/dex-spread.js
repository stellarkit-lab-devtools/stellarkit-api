#!/usr/bin/env node
/**
 * Example: dex-spread.js
 * Fetch and display the current DEX spread between two assets.
 * Usage: node examples/dex-spread.js
 */

const { StellarKit } = require('../sdk');

async function dexSpread() {
  const kit = new StellarKit();

  const sellAsset = { code: 'XLM', issuer: 'native' };
  const buyAsset = { code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' };

  console.log('Fetching DEX spread for XLM/USDC...\n');

  const spread = await kit.dex.getSpread(sellAsset, buyAsset);
  console.log(`Bid:  ${spread.bid}`);
  console.log(`Ask:  ${spread.ask}`);
  console.log(`Spread: ${spread.spread}`);

  const orderBook = await kit.dex.getOrderBook(sellAsset, buyAsset);
  console.log(`\nOrder Book: ${orderBook.bids.length} bids, ${orderBook.asks.length} asks`);
}

dexSpread().catch(console.error);
