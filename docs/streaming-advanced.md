# Advanced Streaming Patterns

This guide covers production-grade patterns for building reliable real-time integrations with StellarKit's SSE and WebSocket streams. For basic connection setup, see the [Streaming Guide](streaming.md).

---

## Table of Contents

1. [Reconnection with Exponential Backoff](#reconnection-with-exponential-backoff)
2. [Managing Multiple Concurrent Streams](#managing-multiple-concurrent-streams)
3. [Client-Side Event Filtering](#client-side-event-filtering)
4. [Graceful Stream Shutdown](#graceful-stream-shutdown)
5. [Memory Management for Long-Running Streams](#memory-management-for-long-running-streams)

---

## Reconnection with Exponential Backoff

Network interruptions are inevitable in production. Exponential backoff prevents overwhelming the server during reconnection storms and gives transient issues time to resolve.

### Pattern

Start with a short delay (e.g., 1 second), double it after each failure, and cap it at a maximum (e.g., 30 seconds). Reset the delay to the initial value after a successful connection.

### SSE Implementation

```js
const EventSource = require("eventsource");

const ACCOUNT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
const BASE_URL = "http://localhost:3000";

let es;
let retryDelay = 1000;      // Start at 1 second
const MAX_DELAY = 30_000;   // Cap at 30 seconds
const MIN_UPTIME_FOR_RESET = 5000; // Reset backoff after 5s of stable connection
let connectionStartTime;

function connect() {
  es = new EventSource(`${BASE_URL}/stream/transactions/${ACCOUNT}`);
  connectionStartTime = Date.now();

  es.addEventListener("connected", () => {
    console.log(`[${new Date().toISOString()}] Stream connected`);
    
    // Reset backoff if connection stays up for minimum uptime
    setTimeout(() => {
      const uptime = Date.now() - connectionStartTime;
      if (uptime >= MIN_UPTIME_FOR_RESET) {
        retryDelay = 1000;
        console.log("Connection stable — backoff reset to 1s");
      }
    }, MIN_UPTIME_FOR_RESET);
  });

  es.addEventListener("transaction", (e) => {
    const tx = JSON.parse(e.data);
    console.log(`New transaction: ${tx.hash}`);
  });

  es.addEventListener("heartbeat", (e) => {
    const { timestamp } = JSON.parse(e.data);
    console.log(`Heartbeat received at ${timestamp}`);
  });

  es.onerror = (err) => {
    const uptime = Date.now() - connectionStartTime;
    console.error(`Stream error after ${uptime}ms uptime`);
    es.close();

    console.warn(`Reconnecting in ${retryDelay}ms...`);
    setTimeout(() => {
      retryDelay = Math.min(retryDelay * 2, MAX_DELAY);
      connect();
    }, retryDelay);
  };
}

connect();

// Clean shutdown
process.on("SIGINT", () => {
  console.log("Shutting down...");
  if (es) es.close();
  process.exit(0);
});
```

### WebSocket Implementation

```js
const WebSocket = require("ws");

const WS_URL = "ws://localhost:3000/stream/ledgers";

let ws;
let retryDelay = 1000;
const MAX_DELAY = 30_000;
const MIN_UPTIME_FOR_RESET = 5000;
let connectionStartTime;
let isShuttingDown = false;

function connect() {
  if (isShuttingDown) return;

  ws = new WebSocket(WS_URL);
  connectionStartTime = Date.now();

  ws.on("open", () => {
    console.log(`[${new Date().toISOString()}] WebSocket connected`);

    setTimeout(() => {
      const uptime = Date.now() - connectionStartTime;
      if (uptime >= MIN_UPTIME_FOR_RESET && !isShuttingDown) {
        retryDelay = 1000;
        console.log("Connection stable — backoff reset to 1s");
      }
    }, MIN_UPTIME_FOR_RESET);
  });

  ws.on("message", (data) => {
    const ledger = JSON.parse(data.toString());
    console.log(`Ledger #${ledger.sequence} | ${ledger.transactionCount} txs`);
  });

  ws.on("close", (code, reason) => {
    if (isShuttingDown) return;

    const uptime = Date.now() - connectionStartTime;
    console.warn(
      `WS closed (code ${code}) after ${uptime}ms. Reconnecting in ${retryDelay}ms...`
    );

    setTimeout(() => {
      if (!isShuttingDown) {
        retryDelay = Math.min(retryDelay * 2, MAX_DELAY);
        connect();
      }
    }, retryDelay);
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err.message);
    // "close" event will fire next — reconnect logic lives there
  });
}

connect();

// Clean shutdown
process.on("SIGINT", () => {
  console.log("Shutting down...");
  isShuttingDown = true;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close(1000, "process exit");
  }
  process.exit(0);
});
```

### Backoff Recommendations

- **Initial delay**: 1–2 seconds (fast recovery for transient glitches)
- **Max delay**: 30–60 seconds (prevents excessive retries during extended outages)
- **Multiplier**: 2× (standard exponential backoff)
- **Reset condition**: 5+ seconds of stable connection (avoids premature reset)

---

## Managing Multiple Concurrent Streams

Production applications often monitor multiple accounts or event types simultaneously. Efficient stream management prevents resource leaks and simplifies error handling.

### Pattern: Stream Registry

Maintain a registry (Map) of active streams keyed by a unique identifier. Centralize connection, reconnection, and cleanup logic.

### Implementation

```js
const EventSource = require("eventsource");

class StreamRegistry {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.streams = new Map(); // key → { es, reconnectTimer, retryDelay }
    this.isShuttingDown = false;
  }

  /**
   * Subscribe to an account's transaction stream
   * @param {string} accountId - Stellar account ID
   * @param {Function} onTransaction - Callback for transaction events
   */
  subscribe(accountId, onTransaction) {
    if (this.streams.has(accountId)) {
      console.warn(`Already subscribed to ${accountId}`);
      return;
    }

    const streamData = {
      es: null,
      reconnectTimer: null,
      retryDelay: 1000,
      connectionStartTime: null,
      onTransaction,
    };

    this.streams.set(accountId, streamData);
    this._connect(accountId);
  }

  /**
   * Unsubscribe from an account stream
   * @param {string} accountId
   */
  unsubscribe(accountId) {
    const streamData = this.streams.get(accountId);
    if (!streamData) return;

    if (streamData.reconnectTimer) {
      clearTimeout(streamData.reconnectTimer);
    }
    if (streamData.es) {
      streamData.es.close();
    }

    this.streams.delete(accountId);
    console.log(`Unsubscribed from ${accountId}`);
  }

  _connect(accountId) {
    if (this.isShuttingDown) return;

    const streamData = this.streams.get(accountId);
    if (!streamData) return;

    const url = `${this.baseUrl}/stream/transactions/${accountId}`;
    streamData.es = new EventSource(url);
    streamData.connectionStartTime = Date.now();

    streamData.es.addEventListener("connected", () => {
      console.log(`[${accountId}] Stream connected`);
      
      setTimeout(() => {
        const uptime = Date.now() - streamData.connectionStartTime;
        if (uptime >= 5000) {
          streamData.retryDelay = 1000;
        }
      }, 5000);
    });

    streamData.es.addEventListener("transaction", (e) => {
      const tx = JSON.parse(e.data);
      streamData.onTransaction(tx);
    });

    streamData.es.onerror = () => {
      streamData.es.close();
      if (this.isShuttingDown) return;

      console.warn(
        `[${accountId}] Reconnecting in ${streamData.retryDelay}ms...`
      );
      
      streamData.reconnectTimer = setTimeout(() => {
        streamData.retryDelay = Math.min(streamData.retryDelay * 2, 30_000);
        this._connect(accountId);
      }, streamData.retryDelay);
    };
  }

  /**
   * Close all streams and prevent reconnections
   */
  shutdown() {
    console.log(`Shutting down ${this.streams.size} streams...`);
    this.isShuttingDown = true;

    for (const accountId of this.streams.keys()) {
      this.unsubscribe(accountId);
    }
  }

  /**
   * Get stream count and connection status
   */
  getStats() {
    return {
      totalStreams: this.streams.size,
      accounts: Array.from(this.streams.keys()),
    };
  }
}

// Usage
const registry = new StreamRegistry("http://localhost:3000");

registry.subscribe(
  "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
  (tx) => console.log(`Account A: ${tx.hash}`)
);

registry.subscribe(
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  (tx) => console.log(`Account B: ${tx.hash}`)
);

console.log("Registry stats:", registry.getStats());

// Clean shutdown
process.on("SIGINT", () => {
  registry.shutdown();
  process.exit(0);
});
```

### Benefits

- **Centralized management**: Single point to add/remove streams
- **Memory leak prevention**: Automatic cleanup on unsubscribe
- **Independent backoff**: Each stream maintains its own retry state
- **Graceful shutdown**: Close all streams before process exit

---

## Client-Side Event Filtering

Server-side streams may emit events you don't need. Client-side filtering reduces processing overhead and simplifies application logic.

### Pattern: Filter Predicates

Define filter functions that return `true` for events you want to process. Chain multiple filters for complex conditions.

### Implementation

```js
const EventSource = require("eventsource");

const ACCOUNT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

// Filter functions
const filters = {
  // Only successful transactions
  onlySuccessful: (tx) => tx.successful === true,

  // Only transactions with 3+ operations
  minOperations: (tx) => tx.operationCount >= 3,

  // Only transactions in recent ledgers
  recentLedgers: (tx) => tx.ledger >= 52_000_000,

  // Only transactions with fees over 1000 stroops
  highFee: (tx) => tx.fee.charged >= 1000,
};

// Combine multiple filters
function matchesFilters(tx, activeFilters) {
  return activeFilters.every((filter) => filter(tx));
}

const es = new EventSource(`http://localhost:3000/stream/transactions/${ACCOUNT}`);

es.addEventListener("connected", () => {
  console.log("Stream connected");
});

es.addEventListener("transaction", (e) => {
  const tx = JSON.parse(e.data);

  // Apply filters
  const activeFilters = [
    filters.onlySuccessful,
    filters.minOperations,
  ];

  if (!matchesFilters(tx, activeFilters)) {
    console.log(`Filtered out: ${tx.hash} (ledger ${tx.ledger})`);
    return;
  }

  console.log(`Processing: ${tx.hash} (${tx.operationCount} ops)`);
  // Process the transaction...
});

es.onerror = () => {
  console.error("Stream error");
  es.close();
};
```

### Payment Stream Filtering

```js
const EventSource = require("eventsource");

const ACCOUNT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

// Payment filters
const paymentFilters = {
  // Only incoming payments (where this account is the recipient)
  onlyIncoming: (payment, watchedAccount) => payment.to === watchedAccount,

  // Only payments above a minimum amount
  minAmount: (payment, threshold) => parseFloat(payment.amount) >= threshold,

  // Only specific asset
  assetCode: (payment, code) => payment.asset.code === code,

  // Only from specific sender
  fromSender: (payment, sender) => payment.from === sender,
};

const es = new EventSource(`http://localhost:3000/stream/payments/${ACCOUNT}`);

es.addEventListener("payment", (e) => {
  const payment = JSON.parse(e.data);

  // Filter: incoming USDC payments >= 100
  if (
    !paymentFilters.onlyIncoming(payment, ACCOUNT) ||
    !paymentFilters.minAmount(payment, 100) ||
    !paymentFilters.assetCode(payment, "USDC")
  ) {
    return;
  }

  console.log(
    `Large USDC payment: ${payment.amount} from ${payment.from}`
  );
  // Trigger notification, database update, etc.
});
```

### Benefits

- **Reduced processing**: Ignore irrelevant events early
- **Flexible logic**: Combine filters dynamically based on runtime conditions
- **Debugging**: Log filtered events separately for troubleshooting

---

## Graceful Stream Shutdown

Applications need to close streams cleanly when stopping, restarting, or switching contexts. Graceful shutdown prevents resource leaks and incomplete event processing.

### Pattern: Shutdown Coordination

1. Set a shutdown flag to prevent new connections
2. Close all active streams
3. Clear any pending reconnection timers
4. Flush pending work (database writes, logs, etc.)
5. Exit process

### Single Stream Shutdown

```js
const EventSource = require("eventsource");

const ACCOUNT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

let es;
let isShuttingDown = false;

function connect() {
  if (isShuttingDown) return;

  es = new EventSource(`http://localhost:3000/stream/transactions/${ACCOUNT}`);

  es.addEventListener("transaction", (e) => {
    const tx = JSON.parse(e.data);
    console.log(`New transaction: ${tx.hash}`);
  });

  es.onerror = () => {
    es.close();
    if (!isShuttingDown) {
      setTimeout(connect, 5000);
    }
  };
}

connect();

// Graceful shutdown on SIGINT (Ctrl+C) and SIGTERM (docker stop, etc.)
function shutdown(signal) {
  if (isShuttingDown) return;

  console.log(`Received ${signal}, shutting down gracefully...`);
  isShuttingDown = true;

  if (es) {
    es.close();
    console.log("Stream closed");
  }

  // Flush any pending work here (database writes, etc.)
  console.log("Cleanup complete");
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
```

### Multi-Stream Shutdown with Registry

```js
const WebSocket = require("ws");

class WebSocketPool {
  constructor() {
    this.connections = new Map();
    this.isShuttingDown = false;
  }

  add(id, url, onMessage) {
    if (this.isShuttingDown) {
      console.warn("Cannot add connection during shutdown");
      return;
    }

    const ws = new WebSocket(url);

    ws.on("open", () => console.log(`[${id}] Connected`));
    ws.on("message", onMessage);
    ws.on("error", (err) => console.error(`[${id}] Error:`, err.message));
    ws.on("close", () => {
      console.log(`[${id}] Closed`);
      this.connections.delete(id);
    });

    this.connections.set(id, ws);
  }

  remove(id) {
    const ws = this.connections.get(id);
    if (!ws) return;

    ws.close(1000, "client unsubscribe");
    this.connections.delete(id);
  }

  async shutdown() {
    if (this.isShuttingDown) return;

    console.log(`Shutting down ${this.connections.size} WebSocket connections...`);
    this.isShuttingDown = true;

    const closePromises = [];

    for (const [id, ws] of this.connections.entries()) {
      if (ws.readyState === WebSocket.OPEN) {
        closePromises.push(
          new Promise((resolve) => {
            ws.once("close", resolve);
            ws.close(1000, "server shutdown");
          })
        );
      }
    }

    await Promise.all(closePromises);
    console.log("All connections closed");
  }
}

// Usage
const pool = new WebSocketPool();

pool.add("ledger-stream", "ws://localhost:3000/stream/ledgers", (data) => {
  const ledger = JSON.parse(data.toString());
  console.log(`Ledger #${ledger.sequence}`);
});

process.on("SIGINT", async () => {
  await pool.shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await pool.shutdown();
  process.exit(0);
});
```

### Docker Health Check Integration

```js
const http = require("http");
const EventSource = require("eventsource");

let isHealthy = false;

const es = new EventSource("http://localhost:3000/stream/ledgers");

es.addEventListener("open", () => {
  isHealthy = true;
  console.log("Stream connected — service is healthy");
});

es.onerror = () => {
  isHealthy = false;
  console.error("Stream error — service is unhealthy");
};

// Health check endpoint for Docker
const healthServer = http.createServer((req, res) => {
  if (req.url === "/health") {
    const status = isHealthy ? 200 : 503;
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ healthy: isHealthy }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

healthServer.listen(8080, () => {
  console.log("Health check server listening on :8080");
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down...");
  es.close();
  healthServer.close(() => {
    console.log("Health server closed");
    process.exit(0);
  });
});
```

### Benefits

- **No orphaned streams**: All connections closed explicitly
- **Predictable behavior**: Shutdown sequence is deterministic
- **Container-friendly**: Responds to SIGTERM from orchestrators

---

## Memory Management for Long-Running Streams

Streams that run for hours or days can accumulate memory if event handlers retain references to processed data. Proper memory management prevents leaks and ensures stable operation.

### Common Memory Pitfalls

1. **Unbounded arrays**: Appending all events to an in-memory array
2. **Closure capture**: Event handlers that reference large parent scope objects
3. **Listener leaks**: Adding event listeners without removing them

### Pattern: Bounded Buffers

Use a circular buffer (ring buffer) or fixed-size queue to retain only recent events.

```js
const EventSource = require("eventsource");

class CircularBuffer {
  constructor(maxSize) {
    this.buffer = [];
    this.maxSize = maxSize;
    this.index = 0;
  }

  push(item) {
    if (this.buffer.length < this.maxSize) {
      this.buffer.push(item);
    } else {
      this.buffer[this.index] = item;
    }
    this.index = (this.index + 1) % this.maxSize;
  }

  getRecent(count) {
    const size = Math.min(count, this.buffer.length);
    const items = [];
    for (let i = 0; i < size; i++) {
      const idx = (this.index - size + i + this.buffer.length) % this.buffer.length;
      items.push(this.buffer[idx]);
    }
    return items;
  }

  clear() {
    this.buffer = [];
    this.index = 0;
  }
}

// Usage
const recentTransactions = new CircularBuffer(100); // Keep last 100 transactions

const es = new EventSource(
  "http://localhost:3000/stream/transactions/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"
);

es.addEventListener("transaction", (e) => {
  const tx = JSON.parse(e.data);
  
  // Store minimal data only
  recentTransactions.push({
    hash: tx.hash,
    ledger: tx.ledger,
    fee: tx.fee.charged,
    timestamp: tx.createdAt,
  });

  // Full tx object is garbage collected after this function returns
});

// Periodic reporting
setInterval(() => {
  const recent = recentTransactions.getRecent(10);
  console.log(`Last 10 transactions:`, recent.map((t) => t.hash));
}, 60_000);
```

### Pattern: Streaming Aggregation

Process events incrementally without retaining raw data.

```js
const EventSource = require("eventsource");

class StreamingStats {
  constructor() {
    this.totalTransactions = 0;
    this.totalFees = 0;
    this.operationCounts = {};
    this.lastReset = Date.now();
  }

  record(tx) {
    this.totalTransactions++;
    this.totalFees += tx.fee.charged;
    this.operationCounts[tx.operationCount] =
      (this.operationCounts[tx.operationCount] || 0) + 1;
  }

  getStats() {
    return {
      totalTransactions: this.totalTransactions,
      totalFeesStroops: this.totalFees,
      avgFeeStroops: Math.round(this.totalFees / this.totalTransactions),
      operationCounts: this.operationCounts,
      uptimeMs: Date.now() - this.lastReset,
    };
  }

  reset() {
    this.totalTransactions = 0;
    this.totalFees = 0;
    this.operationCounts = {};
    this.lastReset = Date.now();
  }
}

const stats = new StreamingStats();

const es = new EventSource(
  "http://localhost:3000/stream/transactions/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"
);

es.addEventListener("transaction", (e) => {
  const tx = JSON.parse(e.data);
  stats.record(tx); // Aggregate only — don't store the full tx
});

// Periodic reporting
setInterval(() => {
  console.log("Stream stats:", stats.getStats());
}, 60_000);

// Daily reset
setInterval(() => {
  console.log("Final daily stats:", stats.getStats());
  stats.reset();
}, 86_400_000);
```

### Pattern: Event Handler Cleanup

Remove event listeners when streams are closed to prevent leaks.

```js
const EventSource = require("eventsource");

function createMonitoredStream(accountId) {
  const es = new EventSource(
    `http://localhost:3000/stream/transactions/${accountId}`
  );

  const handlers = {
    connected: (e) => {
      const data = JSON.parse(e.data);
      console.log(`Connected to ${data.account}`);
    },
    transaction: (e) => {
      const tx = JSON.parse(e.data);
      console.log(`Transaction: ${tx.hash}`);
    },
    heartbeat: (e) => {
      const data = JSON.parse(e.data);
      console.log(`Heartbeat: ${data.timestamp}`);
    },
  };

  // Register handlers
  es.addEventListener("connected", handlers.connected);
  es.addEventListener("transaction", handlers.transaction);
  es.addEventListener("heartbeat", handlers.heartbeat);

  // Return cleanup function
  return () => {
    // Remove all listeners before closing
    es.removeEventListener("connected", handlers.connected);
    es.removeEventListener("transaction", handlers.transaction);
    es.removeEventListener("heartbeat", handlers.heartbeat);
    es.close();
    console.log(`Stream for ${accountId} cleaned up`);
  };
}

const cleanup = createMonitoredStream(
  "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"
);

// Clean up after 60 seconds
setTimeout(() => {
  cleanup();
}, 60_000);
```

### Memory Monitoring

```js
const EventSource = require("eventsource");

function logMemoryUsage() {
  const usage = process.memoryUsage();
  console.log("Memory Usage:", {
    rss: `${Math.round(usage.rss / 1024 / 1024)} MB`,
    heapUsed: `${Math.round(usage.heapUsed / 1024 / 1024)} MB`,
    heapTotal: `${Math.round(usage.heapTotal / 1024 / 1024)} MB`,
  });
}

const es = new EventSource(
  "http://localhost:3000/stream/transactions/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"
);

let transactionCount = 0;

es.addEventListener("transaction", (e) => {
  transactionCount++;
  const tx = JSON.parse(e.data);
  
  // Process transaction without retaining it
  console.log(`TX ${transactionCount}: ${tx.hash}`);
  
  // Log memory every 100 transactions
  if (transactionCount % 100 === 0) {
    logMemoryUsage();
  }
});

// Log memory every 5 minutes
setInterval(logMemoryUsage, 300_000);
```

### Recommendations

- **Limit retained data**: Use circular buffers or streaming aggregation
- **Remove listeners**: Clean up event handlers explicitly
- **Monitor memory**: Track heap usage in production
- **Test long runs**: Run streams for 24+ hours in staging to detect leaks

---

## Related Documentation

- [Streaming Guide](streaming.md) — Basic SSE and WebSocket connection setup
- [Real-Time Guide](real-time-guide.md) — Building real-time Stellar applications
- [Webhooks Guide](webhooks.md) — Alternative push-based event delivery
- [Error Reference](error-reference.md) — Stream error codes and recovery

---

## Summary

Production streaming integrations require careful attention to reconnection, resource management, and graceful shutdown. The patterns in this guide provide a foundation for building reliable, long-running stream consumers that handle network interruptions, manage memory efficiently, and integrate cleanly with modern deployment environments.
