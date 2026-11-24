# Advanced Pagination Patterns for High-Volume Data Fetching

This guide covers advanced pagination techniques for building data pipelines that need to fetch thousands of records from StellarKit API endpoints. While the [Response Format Guide](response-format.md) covers basic pagination mechanics, this document focuses on production-ready patterns for large-scale data fetching, resumable operations, and parallel processing.

---

## Table of Contents

1. [Quick Reference](#quick-reference)
2. [Understanding Pagination Mechanics](#understanding-pagination-mechanics)
3. [Sequential Pagination with Cursor Resumption](#sequential-pagination-with-cursor-resumption)
4. [Parallel Pagination Across Multiple Endpoints](#parallel-pagination-across-multiple-endpoints)
5. [Detecting the Last Page](#detecting-the-last-page)
6. [Recommended Page Sizes](#recommended-page-sizes)
7. [Complete Examples](#complete-examples)
8. [Error Handling and Recovery](#error-handling-and-recovery)
9. [Performance Optimization](#performance-optimization)
10. [Best Practices](#best-practices)

---

## Quick Reference

### Common Pagination Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 20 | Records per page (max varies by endpoint, typically 200) |
| `order` | string | `desc` | Sort order: `asc` (oldest first) or `desc` (newest first) |
| `cursor` | string | — | Opaque pagination token from previous response |

### Response Meta Fields

| Field | Type | Description |
|-------|------|-------------|
| `count` / `total` | number | Number of records in current response |
| `limit` | number | Page size used for this request |
| `order` | string | Sort order applied |
| `nextCursor` | string \| null | Token for next page (null on last page) |
| `hasMore` | boolean | True if more pages exist |

### Quick Pattern Examples

```javascript
// Check if more pages exist
if (response.meta.hasMore) {
  // Fetch next page using cursor
  const nextPage = await fetch(url + `&cursor=${response.meta.nextCursor}`);
}

// Detect last page
if (!response.meta.hasMore || response.meta.nextCursor === null) {
  console.log('Reached last page');
}
```

---

## Understanding Pagination Mechanics

### How Cursors Work

StellarKit uses **opaque cursors** to track your position in a paginated dataset. A cursor is a token that represents a specific point in the result set, typically encoding ledger sequence and operation order.

**Key Characteristics:**
- Cursors are **opaque strings** — their format is an implementation detail
- Cursors are **stable** — the same cursor always points to the same position
- Cursors are **forward-only** — you cannot move backward without keeping previous cursors
- Cursors are **endpoint-specific** — a cursor from `/transactions` won't work with `/payments`

### Response Structure

Every paginated response follows this structure:

```json
{
  "success": true,
  "meta": {
    "count": 20,
    "limit": 20,
    "order": "desc",
    "nextCursor": "137424838656-1",
    "hasMore": true
  },
  "data": [
    { "id": "...", "..." },
    { "id": "...", "..." }
  ]
}
```

### Link Header (RFC 8288)

Responses also include a standard `Link` HTTP header when more pages exist:

```
Link: <https://api.stellarkit.io/account/GABC.../payments?limit=20&cursor=137424838656-1>; rel="next"
```

This allows HTTP clients and tools (curl, wget, Postman) to follow pagination without parsing JSON.

---

## Sequential Pagination with Cursor Resumption

Sequential pagination fetches pages one at a time, which is ideal for:
- Processing records in order (e.g., rebuilding account state chronologically)
- Memory-constrained environments
- Operations that must be sequential (dependent transformations)

### Basic Sequential Pattern

```javascript
const axios = require('axios');

async function fetchAllTransactions(accountId) {
  const baseUrl = `https://api.stellarkit.io/account/${accountId}/transactions`;
  let cursor = null;
  let allTransactions = [];
  let pageCount = 0;

  while (true) {
    // Build URL with cursor if available
    const url = cursor 
      ? `${baseUrl}?limit=200&cursor=${cursor}`
      : `${baseUrl}?limit=200`;

    const response = await axios.get(url);
    const { data, meta } = response.data;

    // Process current page
    allTransactions.push(...data);
    pageCount++;
    console.log(`Fetched page ${pageCount}: ${data.length} records`);

    // Check if more pages exist
    if (!meta.hasMore || meta.nextCursor === null) {
      break;
    }

    // Update cursor for next iteration
    cursor = meta.nextCursor;
  }

  console.log(`Complete! Fetched ${allTransactions.length} transactions across ${pageCount} pages`);
  return allTransactions;
}
```

### Cursor Resumption Pattern

For long-running operations, save cursor state to resume after interruptions:

```javascript
const fs = require('fs');
const axios = require('axios');

class ResumableFetcher {
  constructor(accountId, stateFile = 'fetch-state.json') {
    this.accountId = accountId;
    this.stateFile = stateFile;
    this.state = this.loadState();
  }

  loadState() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const state = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
        console.log(`Resuming from cursor: ${state.lastCursor || 'beginning'}`);
        return state;
      }
    } catch (err) {
      console.error('Failed to load state, starting fresh:', err.message);
    }
    return { lastCursor: null, totalFetched: 0, pageCount: 0 };
  }

  saveState() {
    fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
  }

  async fetchAll(onPage) {
    const baseUrl = `https://api.stellarkit.io/account/${this.accountId}/transactions`;

    while (true) {
      try {
        const url = this.state.lastCursor
          ? `${baseUrl}?limit=200&cursor=${this.state.lastCursor}`
          : `${baseUrl}?limit=200`;

        const response = await axios.get(url);
        const { data, meta } = response.data;

        // Process page (callback for custom handling)
        if (onPage) {
          await onPage(data, this.state.pageCount + 1);
        }

        // Update state
        this.state.pageCount++;
        this.state.totalFetched += data.length;
        this.state.lastCursor = meta.nextCursor;
        
        // Save state after each successful page
        this.saveState();

        console.log(
          `Page ${this.state.pageCount}: ${data.length} records ` +
          `(total: ${this.state.totalFetched})`
        );

        // Check completion
        if (!meta.hasMore) {
          console.log('Fetch complete!');
          this.cleanup();
          break;
        }

      } catch (err) {
        console.error('Fetch error:', err.message);
        console.log('State saved. Resume by running again.');
        throw err;
      }
    }

    return this.state;
  }

  cleanup() {
    // Remove state file after successful completion
    if (fs.existsSync(this.stateFile)) {
      fs.unlinkSync(this.stateFile);
    }
  }
}

// Usage
async function main() {
  const fetcher = new ResumableFetcher('GABC123...', './transaction-state.json');
  
  await fetcher.fetchAll(async (transactions, pageNum) => {
    // Custom processing per page
    console.log(`Processing page ${pageNum}...`);
    // Write to database, file, etc.
  });
}
```

**Key Features:**
- State persists to disk after each page
- Automatic resumption from last cursor on restart
- Handles interruptions (network errors, kills, crashes)
- Cleans up state file after completion

---

## Parallel Pagination Across Multiple Endpoints

Fetch data from multiple accounts or endpoints simultaneously to maximize throughput.

### Parallel Account Fetching

```javascript
const axios = require('axios');

async function fetchAccountTransactions(accountId, limit = 200) {
  const baseUrl = `https://api.stellarkit.io/account/${accountId}/transactions`;
  let cursor = null;
  let allTransactions = [];

  while (true) {
    const url = cursor 
      ? `${baseUrl}?limit=${limit}&cursor=${cursor}`
      : `${baseUrl}?limit=${limit}`;

    const response = await axios.get(url);
    const { data, meta } = response.data;

    allTransactions.push(...data);

    if (!meta.hasMore) break;
    cursor = meta.nextCursor;
  }

  return {
    accountId,
    transactions: allTransactions,
    count: allTransactions.length
  };
}

async function fetchMultipleAccounts(accountIds, maxConcurrent = 5) {
  const results = [];
  
  // Process accounts in batches to avoid overwhelming the API
  for (let i = 0; i < accountIds.length; i += maxConcurrent) {
    const batch = accountIds.slice(i, i + maxConcurrent);
    
    console.log(
      `Processing batch ${Math.floor(i / maxConcurrent) + 1}: ` +
      `accounts ${i + 1}-${Math.min(i + maxConcurrent, accountIds.length)}`
    );

    const batchResults = await Promise.all(
      batch.map(accountId => fetchAccountTransactions(accountId))
    );

    results.push(...batchResults);

    // Optional: Rate limiting delay between batches
    if (i + maxConcurrent < accountIds.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return results;
}

// Usage
const accounts = [
  'GABC123...',
  'GDEF456...',
  'GHIJ789...',
  // ... more accounts
];

fetchMultipleAccounts(accounts, 5)
  .then(results => {
    const totalTransactions = results.reduce((sum, r) => sum + r.count, 0);
    console.log(`Fetched ${totalTransactions} transactions across ${results.length} accounts`);
  });
```

### Parallel Endpoint Fetching

Fetch different data types for the same account in parallel:

```javascript
async function fetchAccountSnapshot(accountId) {
  const endpoints = {
    details: `/account/${accountId}`,
    transactions: `/account/${accountId}/transactions?limit=200`,
    payments: `/account/${accountId}/payments?limit=200`,
    trades: `/account/${accountId}/trades?limit=200`,
    offers: `/account/${accountId}/offers?limit=200`
  };

  const fetches = Object.entries(endpoints).map(async ([key, path]) => {
    const response = await axios.get(`https://api.stellarkit.io${path}`);
    return [key, response.data];
  });

  const results = await Promise.allSettled(fetches);
  
  // Build snapshot object
  const snapshot = { accountId, timestamp: new Date().toISOString() };
  
  results.forEach((result, index) => {
    const [key] = Object.entries(endpoints)[index];
    if (result.status === 'fulfilled') {
      snapshot[key] = result.value[1]; // [key, data]
    } else {
      snapshot[key] = { error: result.reason.message };
    }
  });

  return snapshot;
}
```

### Concurrency Control

Implement a queue to control concurrent requests:

```javascript
class ConcurrentQueue {
  constructor(maxConcurrent = 5) {
    this.maxConcurrent = maxConcurrent;
    this.running = 0;
    this.queue = [];
  }

  async add(fn) {
    while (this.running >= this.maxConcurrent) {
      await new Promise(resolve => {
        this.queue.push(resolve);
      });
    }

    this.running++;
    
    try {
      return await fn();
    } finally {
      this.running--;
      const resolve = this.queue.shift();
      if (resolve) resolve();
    }
  }
}

// Usage
const queue = new ConcurrentQueue(5);

const accountIds = ['GABC...', 'GDEF...', /* ... */];

const results = await Promise.all(
  accountIds.map(accountId =>
    queue.add(() => fetchAccountTransactions(accountId))
  )
);
```

---

## Detecting the Last Page

There are **two reliable indicators** that you've reached the last page:

### Method 1: Check `hasMore` Field (Recommended)

```javascript
if (!response.meta.hasMore) {
  console.log('Last page reached');
  // No more pages to fetch
}
```

### Method 2: Check `nextCursor` Null

```javascript
if (response.meta.nextCursor === null) {
  console.log('Last page reached');
  // No more pages to fetch
}
```

### Combined Check (Most Robust)

```javascript
function isLastPage(meta) {
  return !meta.hasMore || meta.nextCursor === null;
}

// Usage
if (isLastPage(response.meta)) {
  console.log('No more pages available');
}
```

### Empty Page Detection

An empty `data` array doesn't always mean the last page. Some endpoints may return empty pages with `hasMore: true` if no records match filters for that cursor range.

```javascript
// ❌ WRONG: Don't rely solely on empty data array
if (response.data.length === 0) {
  // This might NOT be the last page!
}

// ✅ CORRECT: Always check meta.hasMore
if (!response.meta.hasMore) {
  // Definitely the last page
}
```

### Early Exit Optimization

For time-bounded queries, exit early when records exceed your time range:

```javascript
async function fetchRecentTransactions(accountId, daysBack = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);
  
  const baseUrl = `https://api.stellarkit.io/account/${accountId}/transactions`;
  let cursor = null;
  let transactions = [];

  while (true) {
    const url = cursor 
      ? `${baseUrl}?limit=200&order=desc&cursor=${cursor}`
      : `${baseUrl}?limit=200&order=desc`;

    const response = await axios.get(url);
    const { data, meta } = response.data;

    for (const tx of data) {
      const txDate = new Date(tx.createdAt);
      
      // Stop if we've gone past the cutoff date
      if (txDate < cutoffDate) {
        console.log(`Reached cutoff date: ${cutoffDate.toISOString()}`);
        return transactions;
      }
      
      transactions.push(tx);
    }

    // Check if more pages exist
    if (!meta.hasMore) break;
    cursor = meta.nextCursor;
  }

  return transactions;
}
```

---

## Recommended Page Sizes

Different use cases benefit from different page sizes. Here are guidelines based on endpoint type and workload:

### General Guidelines

| Use Case | Recommended Limit | Rationale |
|----------|------------------|-----------|
| **Interactive UI** | 10-20 | Fast response, smooth UX |
| **Data Export** | 100-200 | Maximum throughput per request |
| **Streaming/Processing** | 50-100 | Balance memory and network overhead |
| **Historical Analysis** | 200 | Maximum page size for most endpoints |
| **Real-time Monitoring** | 10-20 | Frequent polls, quick updates |

### Endpoint-Specific Recommendations

#### High-Volume Endpoints (Transactions, Payments, Operations)

```javascript
// Use maximum limit for bulk fetching
limit: 200  // Most endpoints allow up to 200
```

**Endpoints:**
- `/account/:id/transactions`
- `/account/:id/payments`
- `/account/:id/operations`
- `/account/:id/effects`

**Why:** These endpoints return many records. Maximize page size to minimize round trips.

#### Medium-Volume Endpoints (Trades, Offers)

```javascript
// Balanced approach
limit: 100
```

**Endpoints:**
- `/account/:id/trades`
- `/account/:id/offers`
- `/account/:id/offer-history`

**Why:** Moderate record counts. 100 provides good balance between memory and network efficiency.

#### Low-Volume Endpoints (Trustlines, Signers)

```javascript
// Smaller pages sufficient
limit: 50
```

**Endpoints:**
- `/account/:id/trustlines`
- `/account/:id/signers`
- `/asset/:assetCode/:issuer/holders`

**Why:** These typically return fewer records. Smaller pages are adequate.

#### Batch Endpoints

```javascript
// Match your batch size
limit: accountIds.length  // But respect endpoint maximum
```

**Endpoints:**
- `/accounts/bulk-balances`
- `/accounts/trust-status`

**Why:** Process all items in one request when possible.

### Dynamic Page Sizing

Adjust page size based on response characteristics:

```javascript
class AdaptiveFetcher {
  constructor(baseUrl, initialLimit = 100) {
    this.baseUrl = baseUrl;
    this.limit = initialLimit;
  }

  async fetchPage(cursor) {
    const url = cursor
      ? `${this.baseUrl}?limit=${this.limit}&cursor=${cursor}`
      : `${this.baseUrl}?limit=${this.limit}`;

    const start = Date.now();
    const response = await axios.get(url);
    const duration = Date.now() - start;

    // Adjust limit based on response time
    if (duration > 5000 && this.limit > 50) {
      // Response too slow, decrease page size
      this.limit = Math.max(50, Math.floor(this.limit * 0.8));
      console.log(`Reduced limit to ${this.limit} (slow response: ${duration}ms)`);
    } else if (duration < 1000 && this.limit < 200) {
      // Response fast, increase page size
      this.limit = Math.min(200, Math.floor(this.limit * 1.2));
      console.log(`Increased limit to ${this.limit} (fast response: ${duration}ms)`);
    }

    return response.data;
  }
}
```

---

## Complete Examples

### Example 1: Stream All Transactions to File

Complete Node.js example that streams all transactions for an account to a JSON Lines file:

```javascript
const axios = require('axios');
const fs = require('fs');
const { Transform } = require('stream');

/**
 * Fetches all transactions for an account and streams them to a file.
 * Uses JSON Lines format (one JSON object per line) for efficient streaming.
 */
class TransactionStreamer {
  constructor(accountId, outputFile) {
    this.accountId = accountId;
    this.outputFile = outputFile;
    this.baseUrl = `https://api.stellarkit.io/account/${accountId}/transactions`;
    this.stats = {
      pages: 0,
      transactions: 0,
      startTime: Date.now(),
      errors: 0
    };
  }

  async stream() {
    // Create write stream with JSON Lines format
    const fileStream = fs.createWriteStream(this.outputFile, { flags: 'w' });
    
    console.log(`Starting transaction stream for account ${this.accountId}`);
    console.log(`Output: ${this.outputFile}`);
    console.log('---');

    let cursor = null;
    let isFirstLine = true;

    try {
      while (true) {
        // Build request URL
        const url = cursor
          ? `${this.baseUrl}?limit=200&order=desc&cursor=${cursor}`
          : `${this.baseUrl}?limit=200&order=desc`;

        // Fetch page
        const response = await axios.get(url);
        const { data, meta } = response.data;

        // Write transactions to file (JSON Lines format)
        for (const transaction of data) {
          // Add newline before each record except the first
          const line = (isFirstLine ? '' : '\n') + JSON.stringify(transaction);
          fileStream.write(line);
          isFirstLine = false;
          this.stats.transactions++;
        }

        this.stats.pages++;

        // Progress update
        console.log(
          `Page ${this.stats.pages}: ${data.length} transactions ` +
          `(total: ${this.stats.transactions})`
        );

        // Check if more pages exist
        if (!meta.hasMore || meta.nextCursor === null) {
          console.log('\n✓ Reached last page');
          break;
        }

        cursor = meta.nextCursor;

        // Optional: Rate limiting delay
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Close stream
      fileStream.end();
      await new Promise(resolve => fileStream.on('finish', resolve));

      // Final statistics
      const duration = ((Date.now() - this.stats.startTime) / 1000).toFixed(2);
      console.log('\n--- Stream Complete ---');
      console.log(`Total transactions: ${this.stats.transactions}`);
      console.log(`Total pages: ${this.stats.pages}`);
      console.log(`Duration: ${duration}s`);
      console.log(`Rate: ${(this.stats.transactions / parseFloat(duration)).toFixed(2)} tx/sec`);
      console.log(`Output file: ${this.outputFile}`);

    } catch (err) {
      console.error('\n✗ Stream failed:', err.message);
      fileStream.end();
      throw err;
    }
  }
}

// Usage
async function main() {
  const accountId = process.argv[2] || 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJKIVZQC6MXYFPTZE2V37ZGQDDG';
  const outputFile = process.argv[3] || `./transactions-${accountId}.jsonl`;

  const streamer = new TransactionStreamer(accountId, outputFile);
  await streamer.stream();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

**Run it:**

```bash
node stream-transactions.js GABC123... transactions.jsonl
```

**Output format (JSON Lines):**

```json
{"id":"tx1","hash":"abc123...","ledger":123,"createdAt":"2026-01-15T10:30:00.000Z",...}
{"id":"tx2","hash":"def456...","ledger":124,"createdAt":"2026-01-15T10:30:05.000Z",...}
{"id":"tx3","hash":"ghi789...","ledger":125,"createdAt":"2026-01-15T10:30:10.000Z",...}
```

### Example 2: Parallel Multi-Account Processor

Fetch and aggregate data from multiple accounts in parallel:

```javascript
const axios = require('axios');

class MultiAccountProcessor {
  constructor(accountIds, options = {}) {
    this.accountIds = accountIds;
    this.maxConcurrent = options.maxConcurrent || 5;
    this.limit = options.limit || 200;
    this.results = new Map();
  }

  async processAccount(accountId) {
    console.log(`Starting: ${accountId}`);
    
    const baseUrl = `https://api.stellarkit.io/account/${accountId}/transactions`;
    let cursor = null;
    let transactions = [];
    let pageCount = 0;

    while (true) {
      const url = cursor
        ? `${baseUrl}?limit=${this.limit}&cursor=${cursor}`
        : `${baseUrl}?limit=${this.limit}`;

      const response = await axios.get(url);
      const { data, meta } = response.data;

      transactions.push(...data);
      pageCount++;

      if (!meta.hasMore) break;
      cursor = meta.nextCursor;
    }

    console.log(`Completed: ${accountId} (${transactions.length} transactions, ${pageCount} pages)`);
    
    return {
      accountId,
      transactionCount: transactions.length,
      pageCount,
      transactions
    };
  }

  async processAll() {
    const startTime = Date.now();
    console.log(`Processing ${this.accountIds.length} accounts (max ${this.maxConcurrent} concurrent)...\n`);

    // Process in controlled batches
    const results = [];
    for (let i = 0; i < this.accountIds.length; i += this.maxConcurrent) {
      const batch = this.accountIds.slice(i, i + this.maxConcurrent);
      const batchNum = Math.floor(i / this.maxConcurrent) + 1;
      
      console.log(`\nBatch ${batchNum}:`);
      
      const batchResults = await Promise.allSettled(
        batch.map(accountId => this.processAccount(accountId))
      );

      // Collect results
      batchResults.forEach((result, index) => {
        const accountId = batch[index];
        if (result.status === 'fulfilled') {
          results.push(result.value);
          this.results.set(accountId, result.value);
        } else {
          console.error(`Failed: ${accountId} - ${result.reason.message}`);
          this.results.set(accountId, { error: result.reason.message });
        }
      });
    }

    // Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const totalTransactions = results.reduce((sum, r) => sum + r.transactionCount, 0);
    const successful = results.length;
    const failed = this.accountIds.length - successful;

    console.log('\n--- Processing Complete ---');
    console.log(`Accounts processed: ${successful}/${this.accountIds.length}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total transactions: ${totalTransactions}`);
    console.log(`Duration: ${duration}s`);
    console.log(`Throughput: ${(totalTransactions / parseFloat(duration)).toFixed(2)} tx/sec`);

    return this.results;
  }

  getResult(accountId) {
    return this.results.get(accountId);
  }

  getSummary() {
    const summary = {
      totalAccounts: this.accountIds.length,
      successful: 0,
      failed: 0,
      totalTransactions: 0,
      accounts: []
    };

    this.results.forEach((result, accountId) => {
      if (result.error) {
        summary.failed++;
      } else {
        summary.successful++;
        summary.totalTransactions += result.transactionCount;
        summary.accounts.push({
          accountId,
          transactionCount: result.transactionCount,
          pageCount: result.pageCount
        });
      }
    });

    return summary;
  }
}

// Usage
async function main() {
  const accounts = [
    'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJKIVZQC6MXYFPTZE2V37ZGQDDG',
    'GBBD47R2LWK7P7CQA4B27USF672QHWWT7MQFGCVQD6ISVJVCGLOWW657',
    'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    // ... more accounts
  ];

  const processor = new MultiAccountProcessor(accounts, {
    maxConcurrent: 5,
    limit: 200
  });

  await processor.processAll();
  
  // Get summary
  const summary = processor.getSummary();
  console.log('\n--- Summary ---');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(console.error);
```

---

## Error Handling and Recovery

### Common Pagination Errors

#### 1. Invalid Cursor Error

**Error:**
```json
{
  "success": false,
  "error": {
    "type": "InvalidCursor",
    "message": "The provided cursor is invalid or expired"
  }
}
```

**Cause:** Cursor is malformed, expired, or from a different endpoint.

**Recovery:**
```javascript
async function fetchWithCursorRecovery(url, cursor) {
  try {
    const response = await axios.get(url + `&cursor=${cursor}`);
    return response.data;
  } catch (err) {
    if (err.response?.data?.error?.type === 'InvalidCursor') {
      console.warn('Invalid cursor, restarting from beginning');
      // Restart without cursor
      const response = await axios.get(url);
      return response.data;
    }
    throw err;
  }
}
```

#### 2. Rate Limit Errors

**Error:**
```json
{
  "success": false,
  "error": {
    "type": "RateLimitExceeded",
    "message": "Rate limit exceeded. Retry after 60 seconds."
  }
}
```

**Recovery with Exponential Backoff:**

```javascript
async function fetchWithRetry(url, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(url);
      return response.data;
    } catch (err) {
      if (err.response?.status === 429) {
        // Rate limited
        const retryAfter = err.response.headers['retry-after'] || Math.pow(2, attempt);
        console.warn(`Rate limited. Retrying in ${retryAfter}s (attempt ${attempt}/${maxRetries})`);
        
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          continue;
        }
      }
      throw err;
    }
  }
}
```

#### 3. Network Timeouts

```javascript
async function fetchWithTimeout(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await axios.get(url, {
      signal: controller.signal,
      timeout: timeoutMs
    });
    return response.data;
  } catch (err) {
    if (err.code === 'ECONNABORTED' || err.name === 'AbortError') {
      console.error('Request timeout');
      throw new Error('Request timed out after ' + timeoutMs + 'ms');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
```

### Robust Pagination Loop

Combining all error handling strategies:

```javascript
async function robustPaginationFetch(baseUrl, options = {}) {
  const {
    limit = 200,
    maxRetries = 3,
    timeout = 30000,
    onPage = null,
    onError = null
  } = options;

  let cursor = null;
  let pageCount = 0;
  let totalRecords = 0;

  while (true) {
    const url = cursor
      ? `${baseUrl}?limit=${limit}&cursor=${cursor}`
      : `${baseUrl}?limit=${limit}`;

    try {
      // Fetch with retry logic
      let response;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          response = await axios.get(url, { timeout });
          break; // Success
        } catch (err) {
          // Handle rate limiting
          if (err.response?.status === 429 && attempt < maxRetries) {
            const retryAfter = err.response.headers['retry-after'] || Math.pow(2, attempt);
            console.warn(`Rate limited, waiting ${retryAfter}s...`);
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            continue;
          }

          // Handle invalid cursor
          if (err.response?.data?.error?.type === 'InvalidCursor' && cursor) {
            console.warn('Invalid cursor, restarting pagination');
            cursor = null;
            continue;
          }

          // Last attempt or non-retryable error
          if (attempt === maxRetries) throw err;
        }
      }

      const { data, meta } = response.data;
      pageCount++;
      totalRecords += data.length;

      // Custom page handler
      if (onPage) {
        await onPage(data, pageCount, meta);
      }

      console.log(`Page ${pageCount}: ${data.length} records (total: ${totalRecords})`);

      // Check completion
      if (!meta.hasMore || meta.nextCursor === null) {
        console.log('Pagination complete');
        break;
      }

      cursor = meta.nextCursor;

    } catch (err) {
      console.error(`Error on page ${pageCount + 1}:`, err.message);
      
      if (onError) {
        const shouldContinue = await onError(err, pageCount, cursor);
        if (!shouldContinue) break;
      } else {
        throw err;
      }
    }
  }

  return { pageCount, totalRecords };
}
```

---

## Performance Optimization

### 1. Connection Pooling

Reuse HTTP connections for better performance:

```javascript
const axios = require('axios');
const http = require('http');
const https = require('https');

// Create HTTP agent with connection pooling
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });

const client = axios.create({
  httpAgent,
  httpsAgent,
  timeout: 30000
});

// Use this client for all requests
const response = await client.get(url);
```

### 2. Compression

Enable gzip compression to reduce transfer size:

```javascript
const response = await axios.get(url, {
  headers: {
    'Accept-Encoding': 'gzip, deflate'
  }
});
```

### 3. Streaming Processing

Process records as they arrive instead of accumulating in memory:

```javascript
async function streamingProcessor(accountId, processFn) {
  const baseUrl = `https://api.stellarkit.io/account/${accountId}/transactions`;
  let cursor = null;

  while (true) {
    const url = cursor
      ? `${baseUrl}?limit=200&cursor=${cursor}`
      : `${baseUrl}?limit=200`;

    const response = await axios.get(url);
    const { data, meta } = response.data;

    // Process each record immediately (don't accumulate)
    for (const record of data) {
      await processFn(record);
    }

    if (!meta.hasMore) break;
    cursor = meta.nextCursor;
  }
}

// Usage - memory efficient
await streamingProcessor('GABC123...', async (transaction) => {
  // Process one transaction at a time
  await saveToDatabase(transaction);
  // transaction is eligible for garbage collection after this
});
```

### 4. Batch Processing

Process records in batches for database efficiency:

```javascript
async function batchProcessor(accountId, batchSize = 100) {
  const baseUrl = `https://api.stellarkit.io/account/${accountId}/transactions`;
  let cursor = null;
  let batch = [];

  async function flushBatch() {
    if (batch.length === 0) return;
    await saveBatchToDatabase(batch);
    console.log(`Saved batch of ${batch.length} transactions`);
    batch = [];
  }

  while (true) {
    const url = cursor
      ? `${baseUrl}?limit=200&cursor=${cursor}`
      : `${baseUrl}?limit=200`;

    const response = await axios.get(url);
    const { data, meta } = response.data;

    for (const record of data) {
      batch.push(record);
      
      // Flush when batch is full
      if (batch.length >= batchSize) {
        await flushBatch();
      }
    }

    if (!meta.hasMore) {
      await flushBatch(); // Flush remaining records
      break;
    }

    cursor = meta.nextCursor;
  }
}
```

### 5. Progress Tracking

Show progress for long-running operations:

```javascript
const cliProgress = require('cli-progress');

async function fetchWithProgress(accountId) {
  // First, estimate total (optional)
  const countResponse = await axios.get(
    `https://api.stellarkit.io/account/${accountId}/transaction-count`
  );
  const estimated = countResponse.data.data.transactionCount;

  // Create progress bar
  const progressBar = new cliProgress.SingleBar({
    format: 'Progress |{bar}| {percentage}% | {value}/{total} records | ETA: {eta}s',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
  });

  progressBar.start(estimated, 0);

  const baseUrl = `https://api.stellarkit.io/account/${accountId}/transactions`;
  let cursor = null;
  let totalFetched = 0;

  while (true) {
    const url = cursor
      ? `${baseUrl}?limit=200&cursor=${cursor}`
      : `${baseUrl}?limit=200`;

    const response = await axios.get(url);
    const { data, meta } = response.data;

    totalFetched += data.length;
    progressBar.update(totalFetched);

    if (!meta.hasMore) break;
    cursor = meta.nextCursor;
  }

  progressBar.stop();
  console.log(`\nComplete! Fetched ${totalFetched} transactions`);
}
```

---

## Best Practices

### 1. Always Use Maximum Reasonable Page Size

```javascript
// ✅ GOOD: Use large pages for bulk fetching
const limit = 200;

// ❌ BAD: Small pages waste round trips
const limit = 10; // Don't do this for bulk fetching
```

### 2. Save State for Long Operations

```javascript
// ✅ GOOD: Persist cursor state
fs.writeFileSync('state.json', JSON.stringify({ cursor, pageCount }));

// ❌ BAD: Lose progress on interruption
// (no state persistence)
```

### 3. Handle Errors Gracefully

```javascript
// ✅ GOOD: Retry with backoff
try {
  await fetchPage();
} catch (err) {
  await exponentialBackoff(attempt);
  retry();
}

// ❌ BAD: Fail immediately
await fetchPage(); // throws and stops entire operation
```

### 4. Use Streaming for Large Datasets

```javascript
// ✅ GOOD: Process as you go
await streamingProcessor(accountId, tx => saveToDB(tx));

// ❌ BAD: Load everything into memory
const allTxs = await fetchAllTransactions(); // OOM risk
await saveToDB(allTxs);
```

### 5. Control Concurrency

```javascript
// ✅ GOOD: Limit concurrent requests
await Promise.all(
  accounts.slice(0, 5).map(fetchAccount)
);

// ❌ BAD: Unlimited concurrency
await Promise.all(
  accounts.map(fetchAccount) // Could be 1000s of parallel requests
);
```

### 6. Monitor Rate Limits

```javascript
// ✅ GOOD: Check response headers
const remaining = response.headers['x-ratelimit-remaining'];
if (remaining < 10) {
  console.warn('Approaching rate limit, slowing down...');
  await sleep(1000);
}

// ❌ BAD: Ignore rate limits until 429
// (no rate limit awareness)
```

### 7. Validate Cursors

```javascript
// ✅ GOOD: Handle invalid cursors
if (error.type === 'InvalidCursor') {
  cursor = null; // Start over
}

// ❌ BAD: Crash on invalid cursor
// (no cursor validation)
```

### 8. Log Progress

```javascript
// ✅ GOOD: Detailed logging
console.log(`Page ${pageCount}: ${data.length} records (cursor: ${cursor})`);

// ❌ BAD: Silent operation
// (no progress visibility)
```

### 9. Use Appropriate Data Structures

```javascript
// ✅ GOOD: Stream or batch process
for (const tx of transactions) {
  process(tx);
}

// ❌ BAD: Accumulate large arrays
const allTxs = []; // Could grow to millions of items
allTxs.push(...pageData);
```

### 10. Implement Idempotency

```javascript
// ✅ GOOD: Check if record already processed
if (!await exists(tx.id)) {
  await save(tx);
}

// ❌ BAD: Blindly insert on retry
await save(tx); // Could create duplicates
```

---

## Related Documentation

- [Response Format Guide](response-format.md) — Basic pagination mechanics and response structure
- [Rate Limiting Strategies Guide](rate-limiting-strategies.md) — Handling rate limits in high-volume scenarios
- [Error Recovery Guide](error-recovery.md) — Programmatic error recovery patterns
- [Performance Guide](performance.md) — General API performance optimization
- [Streaming Guide](streaming.md) — Real-time data streaming with SSE/WebSocket

---

## Support

For questions or issues with pagination:

1. Check [Error Reference](error-reference.md) for pagination-related errors
2. See [FAQ](../FAQ.md) for common pagination questions
3. Review [Getting Started Guide](getting-started.md) for basic usage

---

**Last Updated:** December 2026
