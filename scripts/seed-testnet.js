/**
 * seed-testnet.js
 *
 * Creates and funds a Stellar testnet account using Friendbot.
 *
 * Usage:
 *   npm run seed
 *   # or
 *   node scripts/seed-testnet.js
 */

const StellarSdk = require("@stellar/stellar-sdk");
const axios = require("axios");

async function seedTestnetAccount() {
  // Generate a new keypair
  const keypair = StellarSdk.Keypair.random();
  const publicKey = keypair.publicKey();
  const privateKey = keypair.secret();

  // Friendbot funds a single public key on Stellar testnet.
  const friendbotUrl = `https://friendbot.stellar.org/?addr=${encodeURIComponent(publicKey)}`;

  console.log("Creating + funding Stellar testnet account via Friendbot...");
  console.log(`Friendbot URL: ${friendbotUrl}`);

  try {
    // Friendbot returns 200 with JSON describing the funded account.
    await axios.get(friendbotUrl, {
      headers: { Accept: "application/json" },
      timeout: 30_000,
      validateStatus: (status) => status >= 200 && status < 300,
    });
  } catch (err) {
    const msg =
      err?.response?.data || err?.message || String(err);
    throw new Error(
      `Friendbot request failed: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`
    );
  }

  console.log("\n=== Seeded Account Keys ===");
  console.log(`Public key : ${publicKey}`);
  console.log(`Private key: ${privateKey}`);
}

seedTestnetAccount().catch((err) => {
  console.error("❌ Failed to seed testnet account:", err?.message || err);
  process.exit(1);
});

