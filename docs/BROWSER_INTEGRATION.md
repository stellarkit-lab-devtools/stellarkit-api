# Browser Integration Guide

This guide covers secure integration patterns for browser-based applications using the StellarKit API.

## Table of Contents

1. [CORS Configuration](#cors-configuration)
2. [API Keys in Browser Apps](#api-keys-in-browser-apps)
3. [Server-Side Proxy](#server-side-proxy)
4. [EventSource (SSE) Limitations](#eventsource-sse-limitations)
5. [WebSocket Considerations](#websocket-considerations)
6. [Rate Limiting Behavior](#rate-limiting-behavior)

---

## CORS Configuration

### Setting Allowed Origins

Configure `ALLOWED_ORIGINS` environment variable (comma-separated):

```bash
# .env
ALLOWED_ORIGINS=https://your-app.vercel.app,https://staging.yourapp.com
```

### How It Works

The middleware checks the `Origin` header against the allowed list:

```javascript
// src/index.js (excerpt)
const allowedOriginsEnv = process.env.ALLOWED_ORIGINS;
if (allowedOriginsEnv) {
  const allowedOrigins = allowedOriginsEnv.split(",").map((o) => o.trim());
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      if (allowedOrigins.includes(origin)) {
        cors({ origin: (originVal, callback) => callback(null, true), credentials: true })(req, res, next);
      } else {
        return res.status(403).json({
          success: false,
          error: { type: "Forbidden", message: "Origin not allowed by CORS policy." }
        });
      }
    } else {
      next();
    }
  });
}
```

### Rejected Origin Response

When an origin is not in the allowed list, the server returns:

```json
{
  "success": false,
  "error": {
    "type": "Forbidden",
    "message": "Origin not allowed by CORS policy."
  }
}
```

With HTTP status `403`.

---

## API Keys in Browser Apps

### Never Ship API Keys in Browser Code

**This is a critical security rule.** Any key embedded in JavaScript is visible to anyone who views your page:

```javascript
// ❌ NEVER DO THIS - Key is exposed to all visitors
const api = new StellarKitSDK('sk_live_1234567890abcdef');
```

```javascript
// ✅ Always use server-side proxy (see next section)
const response = await fetch('/api/stellar/account/GBXXX');
```

### Why This Matters

1. **Public Visibility**: Browser JS is downloaded by every visitor
2. **DevTools Access**: Anyone can open DevTools and read your key
3. **Network Tab**: Keys appear in plain text in network requests
4. **Git History**: Accidental commits expose keys permanently

---

## Server-Side Proxy

### Minimal Proxy Implementation

Create a small proxy server that adds your API key:

```javascript
// proxy-server.js
const express = require('express');
const fetch = require('node-fetch');

const app = express();
const API_KEY = process.env.STELLAR_KIT_API_KEY; // Set in environment!
const STELLAR_KIT_BASE = process.env.STELLAR_KIT_BASE || 'http://localhost:3000';

app.use(express.json());

// Proxy endpoint - key is added server-side, never exposed to browser
app.get('/api/account/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const response = await fetch(`${STELLAR_KIT_BASE}/account/${id}`, {
      headers: {
        'X-API-Key': API_KEY,  // Added server-side
        'Accept': 'application/json'
      }
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(502).json({ error: 'Upstream API failed' });
  }
});

app.listen(4000, () => console.log('Proxy running on port 4000'));
```

### Usage from Browser

```javascript
// ✅ Safe - key never leaves your server
const response = await fetch('/api/account/GBXXX');
const data = response.json();
```

---

## EventSource (SSE) Limitations

### What EventSource Can Do

EventSource (`/stream/ledgers`) provides real-time ledger updates:

```javascript
// Works for receiving server-sent events
const evtSource = new EventSource('https://api.stellarkit.dev/stream/ledgers');
evtSource.onmessage = (event) => {
  const ledger = JSON.parse(event.data);
  console.log('New ledger:', ledger.sequence);
};
```

### What EventSource Cannot Do

**EventSource cannot set custom headers**, including:

- `X-API-Key` - Cannot authenticate
- `Authorization` - Not supported by spec
- Any custom header

### Verified Behavior with REQUIRE_API_KEY=true

Testing against a local instance with `REQUIRE_API_KEY=true`:

```bash
# With valid API key via query param (if supported)
curl -v "http://localhost:3000/stream/ledgers?X-API-Key=your_key"
# Result: Connection closes immediately with no data stream

# Without API key
curl -v "http://localhost:3000/stream/ledgers"
# Result: SSE stream works (public endpoint, no auth required in current implementation)
```

**Current Implementation**: The `/stream/ledgers` endpoint is **public** (no API key required) because EventSource cannot send custom headers. This is a known limitation of the SSE protocol.

**Recommendation**: For authenticated streaming, use WebSockets (see next section).

---

## WebSocket Considerations

### WebSocket Headers

WebSockets also have header limitations during the handshake:

- Can send cookies
- Cannot send custom headers like `X-API-Key`
- Cannot send Authorization header during initial upgrade

### Current WebSocket Implementation

The WebSocket endpoint `/stream/ledgers` is public (does not require API key):

```javascript
// Current implementation (src/websocket.js)
wss.on('connection', (ws, req) => {
  // No API key check - WebSocket handshake can't send custom headers
  // Stream is public for ledger updates
});
```

### Recommendation

For protected WebSocket endpoints, consider:
1. Token-based auth via query string (less secure, but works)
2. Cookie-based authentication
3. Separate authenticated API vs. public streaming endpoints

---

## Rate Limiting Behavior

### Per-IP Rate Limits

By default, rate limiting is per-IP:

```
X-RateLimit-Limit: 100      # Max requests per window
X-RateLimit-Remaining: 0    # Requests left in window
X-RateLimit-Reset: ...      # Window reset timestamp
Retry-After: 900            # Seconds until reset
```

### Per-Account Rate Limits

When `X-Account-ID` header is provided, rate limits are per-account:

```javascript
// Request with account ID - rate limited by account
fetch('/api/account/GBXXX', {
  headers: { 'X-Account-ID': 'GBXXX' }
});
```

### Impact on End Users

| Scenario | Behavior |
|----------|----------|
| IP-based (default) | All users behind NAT share same limit |
| Account-based | Each account gets its own limit |
| Exceeded | 429 response with `retryAfter` field |

For browser apps via proxy, the **proxy server's IP** is rate limited, not the end user's. Ensure your proxy handles this appropriately.

---

## Summary

| Pattern | Safe for Browser? |
|---------|------------------|
| ALLOWED_ORIGINS | ✅ Yes - configure your domain |
| API key in JS | ❌ Never |
| Server-side proxy | ✅ Yes - recommended |
| EventSource | ⚠️ Cannot auth - use WebSocket |
| WebSocket | ⚠️ Cannot send headers - consider cookies/query |
| IP rate limiting | ⚠️ Proxy IP shares limit |