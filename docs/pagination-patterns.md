# Advanced Pagination Patterns

This guide covers advanced pagination techniques for fetching large datasets from the StellarKit API. Use these patterns when building data pipelines, performing bulk operations, or resuming interrupted fetches.

## Table of Contents

1. [Sequential Pagination with Cursor Resumption](#sequential-pagination-with-cursor-resumption)
2. [Parallel Pagination Across Accounts](#parallel-pagination-across-accounts)
3. [Detecting the Last Page](#detecting-the-last-page)
4. [Recommended Page Sizes](#recommended-page-sizes)
5. [Complete Example: Streaming Account Transactions](#complete-example-streaming-account-transactions)

---

## Sequential Pagination with Cursor Resumption

Use cursors to paginate through large result sets sequentially. This pattern is ideal for processing records page by page and for resuming interrupted fetches.

### Basic Pattern

```javascript
let cursor = null;
let hasMore = true;

while (hasMore) {
  const params = new URLSearchParams({ limit: 100 });
  if (cursor) {
    params.append("cursor", cursor);
  }

  const response = await fetch(`/account/GXXX/transactions?${params}`);
  const data = await response.json();

  // Process this page of records
  for (const tx of data.data.transactions) {
    console.log(tx.id, tx.hash, tx.createdAt);
  }

  // Update cursor for next iteration
  cursor = data.meta?.nextCursor || null;
  hasMore = data.meta?.hasMore ?? true;
}
```

### Resuming Interrupted Fetches

Store the cursor and current timestamp when interrupted. Resume from the saved cursor:

```javascript
const checkpoint = {
  accountId: "GXXX",
  cursor: null,
  processedCount: 0,
  lastTimestamp: new Date().toISOString(),
};

async function fetchAndProcess() {
  let cursor = checkpoint.cursor;
  let hasMore = true;

  while (hasMore) {
    try {
      const params = new URLSearchParams({
        limit: 100,
        cursor: cursor || "",
      });

      const response = await fetch(`/account/${checkpoint.accountId}/transactions?${params}`);
      const data = await response.json();

      for (const tx of data.data.transactions) {
        checkpoint.processedCount++;
        checkpoint.lastTimestamp = tx.createdAt;
        
        // Save checkpoint after each record or batch
        if (checkpoint.processedCount % 1000 === 0) {
          saveCheckpoint(checkpoint);
        }
      }

      cursor = data.meta?.nextCursor || null;
      hasMore = data.meta?.hasMore ?? true;

      if (!hasMore) {
        checkpoint.cursor = null; // Reset cursor when done
        saveCheckpoint(checkpoint);
      }
    } catch (error) {
      console.error("Fetch failed, saving checkpoint for resume:", error);
      checkpoint.cursor = cursor; // Save current cursor
      saveCheckpoint(checkpoint);
      throw error;
    }
  }
}
```

---

## Parallel Pagination Across Accounts

Fetch data from multiple accounts simultaneously using Promise.all(). This significantly speeds up bulk data gathering.

### Pattern: Fetch Transactions for Multiple Accounts

```javascript
const accountIds = [
  "GAAA",
  "GBBB",
  "GCCC",
  // ... more accounts
];

async function fetchAllTransactions(accountIds) {
  // Fetch first page for each account in parallel
  const promises = accountIds.map((id) =>
    fetch(`/account/${id}/transactions?limit=100`).then((r) => r.json())
  );

  const firstPages = await Promise.all(promises);

  // Collect all transactions from first pages
  const allTransactions = [];
  const cursors = {};

  for (let i = 0; i < accountIds.length; i++) {
    const data = firstPages[i];
    allTransactions.push(...(data.data.transactions || []));
    cursors[accountIds[i]] = data.meta?.nextCursor || null;
  }

  // Continue fetching remaining pages
  while (Object.values(cursors).some((c) => c !== null)) {
    const nextPromises = Object.entries(cursors)
      .filter(([_, cursor]) => cursor !== null)
      .map(([accountId, cursor]) =>
        fetch(`/account/${accountId}/transactions?limit=100&cursor=${cursor}`)
          .then((r) => r.json())
          .then((data) => ({ accountId, data }))
      );

    const nextPages = await Promise.all(nextPromises);

    for (const { accountId, data } of nextPages) {
      allTransactions.push(...(data.data.transactions || []));
      cursors[accountId] = data.meta?.nextCursor || null;
    }
  }

  return allTransactions;
}

// Usage
const allTransactions = await fetchAllTransactions(accountIds);
console.log(`Fetched ${allTransactions.length} total transactions`);
```

### Concurrency Control

Limit concurrent requests to avoid rate limiting:

```javascript
async function fetchWithConcurrency(accountIds, concurrency = 5) {
  const results = [];
  const executing = [];

  for (const id of accountIds) {
    const promise = fetchAccountTransactions(id).then((txs) => {
      results.push(...txs);
      executing.splice(executing.indexOf(promise), 1);
    });

    executing.push(promise);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

async function fetchAccountTransactions(accountId) {
  const transactions = [];
  let cursor = null;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({ limit: 100 });
    if (cursor) params.append("cursor", cursor);

    const response = await fetch(`/account/${accountId}/transactions?${params}`);
    const data = await response.json();

    transactions.push(...(data.data.transactions || []));
    cursor = data.meta?.nextCursor || null;
    hasMore = data.meta?.hasMore ?? true;
  }

  return transactions;
}
```

---

## Detecting the Last Page

Use `hasMore` and `nextCursor` from the response metadata to determine when to stop paginating.

### Response Metadata Structure

```json
{
  "success": true,
  "data": { /* records */ },
  "meta": {
    "count": 100,
    "limit": 100,
    "order": "desc",
    "nextCursor": "some-token-or-null",
    "hasMore": true
  }
}
```

### Detection Logic

```javascript
const response = await fetch("/account/GXXX/transactions");
const data = await response.json();

// Method 1: Check hasMore
if (!data.meta?.hasMore) {
  console.log("Reached last page");
}

// Method 2: Check nextCursor
if (!data.meta?.nextCursor) {
  console.log("Reached last page");
}

// Method 3: Check if results are fewer than limit
if ((data.data.transactions || []).length < 100) {
  console.log("Likely reached last page or near end");
}

// Recommended: Use hasMore as primary indicator
const hasMorePages = data.meta?.hasMore === true;
```

---

## Recommended Page Sizes

Choose page sizes based on your use case and network conditions. Larger pages reduce the number of requests but increase latency per request.

| Use Case | Recommended Limit | Rationale |
|----------|-------------------|-----------|
| Real-time dashboards | 10–20 | Fast response time, low latency |
| Data exports | 100–200 | Balanced speed and efficiency |
| Bulk analytics | 200 | Maximum page size for efficiency |
| Streaming pipelines | 100–150 | Balance between throughput and memory |
| Mobile apps | 10–50 | Reduce payload size and bandwidth |

### Page Size Configuration

```javascript
const PAGE_SIZES = {
  dashboard: 20,
  export: 100,
  analytics: 200,
  stream: 150,
  mobile: 25,
};

async function fetchWithOptimalPageSize(accountId, useCase) {
  const limit = PAGE_SIZES[useCase] || 100;
  const response = await fetch(`/account/${accountId}/transactions?limit=${limit}`);
  return response.json();
}
```

### Memory-Efficient Streaming

For very large datasets, process records as they arrive rather than accumulating them in memory:

```javascript
async function streamTransactionsEfficiently(accountId, onRecordReceived) {
  let cursor = null;
  let hasMore = true;
  let processedCount = 0;

  while (hasMore) {
    const params = new URLSearchParams({ limit: 200 });
    if (cursor) params.append("cursor", cursor);

    const response = await fetch(`/account/${accountId}/transactions?${params}`);
    const data = await response.json();

    // Process each record immediately without storing
    for (const tx of data.data.transactions || []) {
      onRecordReceived(tx);
      processedCount++;

      // Yield control periodically to avoid blocking
      if (processedCount % 100 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    cursor = data.meta?.nextCursor || null;
    hasMore = data.meta?.hasMore ?? true;
  }

  return processedCount;
}

// Usage
const count = await streamTransactionsEfficiently("GXXX", (tx) => {
  console.log(`Processing tx: ${tx.hash}`);
  // Store in database, calculate metrics, etc.
});
console.log(`Processed ${count} total transactions`);
```

---

## Complete Example: Streaming Account Transactions

This example demonstrates a production-ready implementation that combines multiple patterns:

```javascript
/**
 * Fetches all transactions for an account with robust error handling and progress tracking.
 * Supports resumption from checkpoints and parallel multi-account fetches.
 *
 * @param {string} accountId - Stellar account public key
 * @param {Object} options - Configuration options
 * @param {number} options.pageSize - Records per page (default: 100, max: 200)
 * @param {number} options.maxConcurrency - Max parallel requests (default: 5)
 * @param {Function} options.onProgress - Called with { processed, total, percent }
 * @param {Function} options.onRecord - Called for each record received
 * @returns {Promise<Array>} All transactions fetched
 */
async function streamAllTransactions(accountId, options = {}) {
  const {
    pageSize = 100,
    maxConcurrency = 5,
    onProgress = () => {},
    onRecord = () => {},
  } = options;

  const transactions = [];
  let cursor = null;
  let hasMore = true;
  let processedCount = 0;

  console.log(`Starting transaction stream for ${accountId}`);

  try {
    while (hasMore) {
      const params = new URLSearchParams({
        limit: Math.min(pageSize, 200),
        order: "desc",
      });

      if (cursor) {
        params.append("cursor", cursor);
      }

      const url = `https://api.stellarkit.io/account/${accountId}/transactions?${params}`;

      try {
        const response = await fetch(url, {
          timeout: 30000,
          headers: {
            "User-Agent": "StellarKit-DataPipeline/1.0",
          },
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        if (!data.success) {
          throw new Error(`API error: ${data.error?.message}`);
        }

        // Process records
        for (const tx of data.data.transactions || []) {
          transactions.push(tx);
          onRecord(tx);
          processedCount++;

          // Report progress every 100 records
          if (processedCount % 100 === 0) {
            onProgress({
              processed: processedCount,
              total: "unknown",
              percent: null,
              currentPage: (transactions.length / pageSize).toFixed(1),
            });
          }
        }

        // Prepare for next iteration
        cursor = data.meta?.nextCursor || null;
        hasMore = data.meta?.hasMore === true;

        // Respect rate limits
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (pageError) {
        console.error(`Error fetching page (cursor: ${cursor}):`, pageError);
        throw pageError; // Re-throw to allow retry logic upstream
      }
    }

    onProgress({
      processed: processedCount,
      total: processedCount,
      percent: 100,
      completed: true,
    });

    return transactions;
  } catch (error) {
    console.error(`Failed to stream transactions for ${accountId}:`, error);
    throw error;
  }
}

// Usage Example
async function main() {
  const accountId = "GBRPYHIL2CI3WHZDTOOQFC6EB4CGQG5N3KBI5DOMMZMDBESIOXW32DT";

  try {
    const transactions = await streamAllTransactions(accountId, {
      pageSize: 150,
      maxConcurrency: 5,
      onProgress: (progress) => {
        console.log(
          `Progress: ${progress.processed} records processed (${progress.percent}%)`
        );
      },
      onRecord: (tx) => {
        // Process each transaction as it arrives
        console.log(`Received tx: ${tx.hash} (${tx.createdAt})`);
      },
    });

    console.log(`\nStream complete. Total: ${transactions.length} transactions`);

    // Example: Calculate statistics
    const totalFees = transactions.reduce(
      (sum, tx) => sum + parseInt(tx.feeCharged || 0),
      0
    );
    console.log(`Total fees: ${(totalFees / 10000000).toFixed(7)} XLM`);
  } catch (error) {
    console.error("Stream failed:", error);
    process.exit(1);
  }
}

main();
```

### Running the Example

```bash
# Basic usage
node stream-transactions.js

# With monitoring
node stream-transactions.js | tee transaction-log.txt

# Background processing
node stream-transactions.js &
```

---

## Best Practices

1. **Always use cursors, not page numbers.** Cursor-based pagination is more reliable for evolving datasets.
2. **Cache page metadata.** Store `nextCursor` and `hasMore` to resume efficiently.
3. **Handle rate limits gracefully.** Implement exponential backoff for 429 responses.
4. **Monitor page latency.** If requests take >5 seconds, consider reducing page size.
5. **Test edge cases.** Verify behavior with accounts that have 0, 1, and >1000 records.
6. **Process records as they arrive.** For large datasets, avoid storing all records in memory.
7. **Log cursors for debugging.** Include `nextCursor` and `hasMore` in logs for troubleshooting.

---

## Related Documentation

- [Response Format](./response-format.md) — Pagination metadata structure
- [Transaction Endpoints](./transaction-endpoints.md) — Available transaction endpoints
- [API Design](./api-design.md) — General API design guidelines

