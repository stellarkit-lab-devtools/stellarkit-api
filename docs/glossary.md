# Stellar Glossary

A plain-language guide to Stellar-specific terminology used throughout the StellarKit API and Stellar ecosystem. Whether you're new to blockchain development or just need a quick reference, this glossary clarifies the concepts you'll encounter.

---

## Terms

### Anchor

A **bridge service** that allows you to move real-world assets (like USD, EUR, or real estate) onto the Stellar network as digital tokens, or withdraw them back to traditional systems. Anchors are trusted entities that issue assets on behalf of real-world institutions or maintain representations of off-chain value.

**Why it matters:** If you want to send USD via Stellar, an anchor tokenizes it. When you need to cash out, an anchor converts it back to USD in your bank account.

**Link:** [Stellar Anchors](https://developers.stellar.org/guides/concepts/stellar-ecosystem#anchors)

---

### Asset

A **unit of value** that can be transferred on the Stellar network. Every asset is identified by a 12-character code (e.g., `USDC`, `EUR`) and an issuer's public key. The exception is XLM, the native asset, which needs no issuer.

**Why it matters:** Assets can represent anything—stablecoins, loyalty points, custom tokens, or real-world commodities. You can hold, trade, and transfer assets on the network.

**Link:** [Stellar Assets](https://developers.stellar.org/guides/concepts/assets)

---

### Asset Issuer

The **account that creates and controls an asset** on Stellar. Only the issuer can mint new tokens, set authorization rules, or disable payments for that asset. Issuers are identified by their public key.

**Why it matters:** When you hold USDC on Stellar, you're holding tokens issued by the USDC issuer. Trust flows from the issuer—if they disappear or become compromised, the asset is no longer valuable.

**Link:** [Asset Issuance](https://developers.stellar.org/guides/concepts/assets#issued-assets)

---

### Base Fee

The **minimum fee per operation** that the Stellar network charges, measured in stroops. The current base fee is set by the network consensus and adapts based on network load. One base fee covers one operation; multi-operation transactions cost more.

**Why it matters:** When you submit a transaction with 3 operations at 100 stroops per operation, your total fee is 300 stroops. If the network is congested, the base fee may increase, so fees rise dynamically.

**Link:** [Stellar Fees](https://developers.stellar.org/guides/concepts/fees)

---

### Claimable Balance

A **hold-like account claim** where one account locks XLM or an asset and specifies a condition under which another account can claim it. Think of it as a check waiting to be deposited—the recipient must meet the conditions to cash it.

**Why it matters:** Useful for escrow, multi-step payments, or distributing tokens to accounts that don't yet exist on the network. The recipient doesn't need to have a trustline or even an account set up yet.

**Link:** [Claimable Balances](https://developers.stellar.org/guides/concepts/claimable-balances)

---

### Consensus

The **agreement process** by which the Stellar network decides which transactions are valid and in what order they should be recorded on the ledger. Stellar uses its own consensus protocol (SCP) to secure the network without proof-of-work mining.

**Why it matters:** Consensus ensures that all nodes agree on the network state. It's fast (typically 5 seconds per ledger) and energy-efficient because it doesn't require mining.

**Link:** [Stellar Consensus Protocol](https://developers.stellar.org/guides/concepts/stellar-consensus-protocol)

---

### Horizon API

The **RESTful web service** that Stellar provides as the main interface to the network. It lets developers query account balances, submit transactions, stream live updates, and search ledger history without running a full Stellar node.

**Why it matters:** StellarKit API wraps Horizon to make it even simpler. Instead of learning Horizon's complex query syntax, you get clean endpoints tailored to the most common workflows.

**Link:** [Horizon Documentation](https://developers.stellar.org/api/introduction/)

---

### Keypair

A **pair of cryptographic keys**—a public key and a private key—that identifies a Stellar account. The public key is your address (starts with `G`); the private key is your secret. The public key is shared; the private key is never shared.

**Why it matters:** Your keypair is your identity on Stellar. The private key signs transactions to prove you authorized them. If someone gets your private key, they control your account.

**Link:** [Accounts and Keypairs](https://developers.stellar.org/guides/concepts/accounts)

---

### Ledger

A **permanent, immutable record** of all transactions and account states on the Stellar network. New ledgers close approximately every 5 seconds, building a chain that goes back to the network's genesis block.

**Why it matters:** Every transaction is recorded on the ledger forever. This transparency is what makes Stellar trustworthy—anyone can verify the history of any account or transaction.

**Link:** [Ledger Format](https://developers.stellar.org/guides/concepts/ledger)

---

### Liquidity Pool

A **smart contract-like mechanism** where two assets are held in equal reserves, and users can add liquidity or swap between the assets. The pool automatically adjusts prices based on supply and demand, and liquidity providers earn a share of trading fees.

**Why it matters:** Liquidity pools enable on-chain trading without traditional order books. They're core to Stellar's DEX and let anyone become a market maker by depositing assets.

**Link:** [Liquidity Pools](https://developers.stellar.org/guides/concepts/liquidity-pools)

---

### Memo

An **optional text field** (up to 28 bytes) attached to a transaction. Memos are public and visible to everyone, so they're useful for reference numbers, invoices, or labels but not for private messages.

**Why it matters:** Wallets and applications use memos to track what a payment is for. For example, an invoice system might include "invoice-12345" in the memo so both parties can match the on-chain transaction to their records.

**Link:** [Transaction Memos](https://developers.stellar.org/guides/concepts/transactions#memos)

---

### Native Asset (XLM)

The **built-in asset of the Stellar network**, used for fees, minimum balances, and general payments. XLM doesn't have an issuer and is the only asset that doesn't require a trustline.

**Why it matters:** Every Stellar account must hold some XLM to pay fees and meet minimum balance requirements. XLM is to Stellar what ether is to Ethereum—it's the lifeblood of the network.

**Link:** [XLM and Stellar](https://developers.stellar.org/guides/concepts/assets#native-asset)

---

### Operation

A **single action** within a transaction, such as a payment, creating an account, setting up a trustline, or managing an offer. A transaction can contain 1 to 100 operations, all executed atomically (all succeed or all fail together).

**Why it matters:** Complex workflows are built from operations. For example, setting up a multi-asset payment might require creating a trustline (1 operation) then sending the asset (1 operation), totaling 2 operations and fees.

**Link:** [Operations](https://developers.stellar.org/guides/concepts/operations)

---

### Path Payment

A **special payment operation** that allows you to send one asset while the recipient receives a different asset. Stellar automatically finds the best conversion route through liquidity pools or order books on the DEX, executing the entire trade in a single atomic transaction.

**Why it matters:** You can send XLM and the recipient receives USDC—no middleman needed. Stellar handles the swap. If no direct market exists, Stellar routes through intermediate assets to complete the payment.

**Link:** [Path Payments](https://developers.stellar.org/guides/concepts/path-payments)

---

### Sequence Number

A **counter** on every Stellar account that increments by 1 each time a transaction is successfully submitted. Sequence numbers prevent transaction replay attacks and ensure transactions are applied in order.

**Why it matters:** Before submitting a transaction, you must fetch the current sequence number from the network. If your transaction's sequence number doesn't match the account's next expected number, the transaction is rejected.

**Link:** [Sequence Numbers](https://developers.stellar.org/guides/concepts/transactions#sequence-number)

---

### Stellar Consensus Protocol (SCP)

The **consensus algorithm** that powers Stellar's network. It's a Byzantine Fault Tolerant protocol that allows the network to reach agreement on transaction order and validity without centralized authority or energy-intensive mining.

**Why it matters:** SCP is what makes Stellar fast (5-second confirmation times), energy-efficient, and secure. It's the reason Stellar can support thousands of transactions per second without PoW mining.

**Link:** [Stellar Consensus Protocol](https://developers.stellar.org/guides/concepts/stellar-consensus-protocol)

---

### Stellar Network

The **global peer-to-peer blockchain network** that processes transactions, maintains the ledger, and reaches consensus on the state of all accounts and balances. Stellar exists as two main networks: testnet (for development) and mainnet (for production).

**Why it matters:** All Stellar transactions, whether you're testing on testnet or transacting real value on mainnet, are processed by this same network. Understanding which network you're on is critical—testnet resets periodically and tokens have no real value.

**Link:** [Stellar Networks](https://developers.stellar.org/guides/concepts/stellar-environment#testnet)

---

### Stroops

The **smallest unit of XLM**, equal to 0.0000001 XLM (1 ten-millionth). One XLM = 10,000,000 stroops. All fees and reserves on Stellar are denominated in stroops internally because they are exact integers.

**Why it matters:** When you see "100 stroops" in API responses or protocol documentation, it's 0.000001 XLM. Wallets and user interfaces usually display stroops converted to XLM for readability, but understanding stroops is essential when dealing with fees and minimum balances.

**Link:** [Stroops and XLM](https://developers.stellar.org/guides/concepts/assets#stroops)

---

### Transaction

A **signed, atomic unit of work** submitted to the Stellar network. A transaction contains 1 to 100 operations, all of which either succeed together or fail together. Transactions are immutable once included in a ledger.

**Why it matters:** Everything on Stellar happens via transactions. Whether you're paying someone, creating an account, or trading assets, you're submitting a transaction. Transactions are signed with your private key to prove you authorized them.

**Link:** [Transactions](https://developers.stellar.org/guides/concepts/transactions)

---

### Trustline

A **relationship between an account and an asset issuer** that must be established before an account can hold or receive a non-native asset. Setting up a trustline costs 0.5 XLM (one subentry reserve) and allows the account to hold that asset up to a specified limit.

**Why it matters:** If you want to receive USDC, you must first create a trustline to the USDC issuer. Without it, even if someone tries to send you USDC, the transaction fails. Trustlines are also where you set risk tolerance and authorization flags.

**Link:** [Trustlines](https://developers.stellar.org/guides/concepts/assets#trustlines)

---

## Additional Resources

- [Stellar Documentation](https://developers.stellar.org/)
- [Stellar Guides](https://developers.stellar.org/guides)
- [Horizon API Reference](https://developers.stellar.org/api)
- [Stellar SDK for JavaScript](https://github.com/stellar/js-stellar-sdk)

---

## Using This Glossary

- **For API developers:** Check here when you encounter unfamiliar terms in StellarKit API endpoint documentation or error messages.
- **For wallet builders:** Use this to understand concepts like trustlines, memos, and claimable balances needed for wallet features.
- **For blockchain newcomers:** Start here to build a mental model of how Stellar works before diving into SDK code or transaction building.

If you encounter a term not in this glossary, open an issue on the [StellarKit API repository](https://github.com/stellarkit-lab-devtools/stellarkit-api) and we'll add it.
