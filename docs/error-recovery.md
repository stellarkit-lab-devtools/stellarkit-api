# Error Recovery Guide

This guide explains how to programmatically recover from specific error types returned by the StellarKit API. Each section covers a common error, its characteristics, and provides a recovery code example in JavaScript.

---

## Error Types Overview

Errors from the StellarKit API fall into two categories:

| Category | Description | Recovery Strategy |
|----------|-------------|-------------------|
| **Retryable** | Temporary failures like Horizon unavailability or rate limits | Automatic retry with backoff |
| **Non-retryable** | Permanent failures like invalid parameters or missing resources | User-facing messaging or correction |

---

## 1. HorizonUnavailable

**Type:** Retryable  
**HTTP Status:** 503  
**Error Type:** `HorizonUnavailable`

This error occurs when the Stellar Horizon server is temporarily unavailable or experiencing issues.

### Characteristics
- The API cannot reach the Horizon server
- Usually a temporary condition
- May include a `retryAfter` hint in the response

### Recovery Strategy
Implement an exponential backoff retry strategy with a maximum number of retries.

### Code Example

```javascript
const axios = require('axios');

/**
 * Makes an API request with automatic retry for HorizonUnavailable errors.
 * @param {string} url - The API endpoint URL
 * @param {object} options - Request options
 * @param {number} maxRetries - Maximum number of retry attempts (default: 3)
 * @returns {Promise<object>} The API response
 */
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await axios(url, options);
      return response.data;
    } catch (error) {
      lastError = error;
      
      // Check if this is a retryable error
      if (error.response?.status === 503 || 
          error.response?.data?.error?.type === 'HorizonUnavailable') {
        
        // Extract retry-after hint or use exponential backoff
        const retryAfter = error.response?.headers?.['retry-after'];
        const delay = retryAfter 
          ? parseInt(retryAfter, 10) * 1000 
          : Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        
        console.log(`Horizon unavailable. Retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // Non-retryable error - throw immediately
      throw error;
    }
  }
  
  throw lastError;
}

// Usage example
async function getAccountBalances(accountId) {
  try {
    const data = await fetchWithRetry(`http://localhost:3000/account/${accountId}/balances`);
    return data.data;
  } catch (error) {
    if (error.response?.status === 503) {
      console.error('Horizon is unavailable. Please try again later.');
    }
    throw error;
  }
}
```

---

## 2. RateLimitExceeded

**Type:** Retryable  
**HTTP Status:** 429  
**Error Type:** `RateLimitExceeded`

This error occurs when the API's rate limit has been exceeded. The response may include a `retryAfter` header indicating when to retry.

### Characteristics
- Too many requests in a given time window
- Response includes `retry-after` header with seconds to wait
- May indicate you need to implement client-side rate limiting

### Recovery Strategy
Implement exponential backoff and respect the `retry-after` header.

### Code Example

```javascript
const axios = require('axios');

/**
 * Makes an API request with rate limit handling.
 * @param {string} url - The API endpoint URL
 * @param {object} options - Request options
 * @returns {Promise<object>} The API response
 */
async function fetchWithRateLimitHandling(url, options = {}) {
  const MAX_RETRIES = 5;
  let retryCount = 0;
  
  while (retryCount < MAX_RETRIES) {
    try {
      const response = await axios(url, options);
      return response.data;
    } catch (error) {
      if (error.response?.status === 429) {
        // Get retry-after header (defaults to 60 seconds if not present)
        const retryAfter = parseInt(error.response.headers['retry-after'], 10) || 60;
        const waitTime = retryAfter * 1000;
        
        console.log(`Rate limited. Waiting ${retryAfter} seconds before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        retryCount++;
        continue;
      }
      
      throw error;
    }
  }
  
  throw new Error('Max retries exceeded for rate limiting');
}

/**
 * Batch processor with built-in rate limit handling.
 * @param {string[]} accountIds - Array of account IDs to fetch
 * @param {Function} processor - Function to process each account data
 * @returns {Promise<Array>} Results from processing
 */
async function processAccountsBatched(accountIds, processor) {
  const results = [];
  const BATCH_SIZE = 10;
  const DELAY_BETWEEN_BATCHES = 1000; // 1 second between batches
  
  for (let i = 0; i < accountIds.length; i += BATCH_SIZE) {
    const batch = accountIds.slice(i, i + BATCH_SIZE);
    
    const batchResults = await Promise.all(
      batch.map(async (accountId) => {
        try {
          const data = await fetchWithRateLimitHandling(
            `http://localhost:3000/account/${accountId}/balances`
          );
          return { accountId, success: true, data: processor(data.data) };
        } catch (error) {
          return { accountId, success: false, error: error.message };
        }
      })
    );
    
    results.push(...batchResults);
    
    // Add delay between batches to avoid rate limiting
    if (i + BATCH_SIZE < accountIds.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
    }
  }
  
  return results;
}
```

---

## 3. AccountNotFound

**Type:** Non-retryable  
**HTTP Status:** 404  
**Error Type:** `AccountNotFound`

This error occurs when the requested Stellar account does not exist on the network or has been merged into another account.

### Characteristics
- The account ID is valid format but doesn't exist on the network
- The account may have been merged
- This is a permanent condition - retries will not help

### Recovery Strategy
Provide user-facing guidance to verify the account address and ensure it's been funded.

### Code Example

```javascript
const axios = require('axios');

/**
 * Fetches account data with user-friendly error handling.
 * @param {string} accountId - Stellar account ID (G...)
 * @returns {Promise<object>} Account data or null if not found
 */
async function getAccountOrExplain(accountId) {
  try {
    const response = await axios.get(`http://localhost:3000/account/${accountId}/balances`);
    return response.data.data;
  } catch (error) {
    if (error.response?.status === 404) {
      const errorDetails = error.response.data.error;
      
      // Provide specific guidance based on the error
      const userMessage = `
        Account not found: ${accountId}
        
        Possible reasons:
        1. The account has not been funded yet - it needs at least 1 XLM to exist
        2. The account address is incorrect - please verify the public key
        3. The account may have been merged into another account
        
        Suggestions:
        - Double-check the account address for typos
        - Use Stellar Expert (https://stellar.expert) to verify the account exists
        - If you just created the account, ensure you have funded it with XLM
      `;
      
      console.error(userMessage);
      return null;
    }
    
    throw error;
  }
}

/**
 * Validates an account ID before making API calls.
 * @param {string} accountId - Potential account ID to validate
 * @returns {Promise<boolean>} True if account exists
 */
async function validateAccountExists(accountId) {
  try {
    await axios.get(`http://localhost:3000/account/${accountId}/sequence`);
    return true;
  } catch (error) {
    if (error.response?.status === 404) {
      return false;
    }
    throw error;
  }
}
```

---

## 4. OrderBookEmpty

**Type:** Non-retryable (may become retryable)  
**HTTP Status:** 404  
**Error Type:** `OrderBookEmpty`

This error occurs when attempting to retrieve an order book that has no orders.

### Characteristics
- No sell or buy orders exist for the requested trading pair
- This can change at any time as new orders are placed
- The asset pair may simply not have trading activity

### Recovery Strategy
Provide fallback suggestions like checking alternative trading pairs or using trade history to determine liquidity.

### Code Example

```javascript
const axios = require('axios');

/**
 * Fetches order book with fallback suggestions.
 * @param {string} sellingAsset - Selling asset code:issuer (e.g., "XLM:native")
 * @param {string} buyingAsset - Buying asset code:issuer (e.g., "USDC:GA5Z...")
 * @returns {Promise<object>} Order book data or suggestions
 */
async function getOrderBookWithFallback(sellingAsset, buyingAsset) {
  const url = `http://localhost:3000/dex/orderbook?selling=${sellingAsset}&buying=${buyingAsset}`;
  
  try {
    const response = await axios.get(url);
    return response.data.data;
  } catch (error) {
    if (error.response?.status === 404 && 
        error.response?.data?.error?.type === 'OrderBookEmpty') {
      
      // Parse assets for display
      const [sellCode, sellIssuer] = sellingAsset.split(':');
      const [buyCode, buyIssuer] = buyingAsset.split(':');
      
      console.warn(`
        No orders found for ${sellCode}/${buyCode} trading pair.
        
        Suggestions:
        1. Try a different trading pair (e.g., XLM/USDC)
        2. Check recent trades to see if the pair has activity:
           GET /dex/price?base=${sellingAsset}&counter=${buyingAsset}
        3. The liquidity may be on a different DEX or AMM
        4. Consider placing an order to provide liquidity
      `);
      
      // Return null to indicate no orders, but don't throw
      // The caller can decide how to handle this (show message, use fallback, etc.)
      return null;
    }
    
    throw error;
  }
}

/**
 * Finds the best available trading path between two assets.
 * @param {string} fromAsset - Source asset (code:issuer or "XLM:native")
 * @param {string} toAsset - Destination asset (code:issuer or "XLM:native")
 * @returns {Promise<object>} Best path information
 */
async function findTradingPath(fromAsset, toAsset) {
  // Direct path
  const directPath = await getOrderBookWithFallback(fromAsset, toAsset);
  if (directPath) {
    return { path: [fromAsset, toAsset], type: 'direct', orderBook: directPath };
  }
  
  // Try XLM as intermediate (most common path)
  if (fromAsset !== 'XLM:native' && toAsset !== 'XLM:native') {
    const xlmPath = await Promise.all([
      getOrderBookWithFallback(fromAsset, 'XLM:native'),
      getOrderBookWithFallback('XLM:native', toAsset)
    ]);
    
    if (xlmPath[0] && xlmPath[1]) {
      return { path: [fromAsset, 'XLM:native', toAsset], type: 'viaXLM' };
    }
  }
  
  // No viable path found
  return { path: null, type: 'none' };
}
```

---

## 5. InvalidCursor

**Type:** Non-retryable  
**HTTP Status:** 400  
**Error Type:** `InvalidCursor`

This error occurs when an invalid pagination cursor is provided.

### Characteristics
- The cursor format is malformed or incorrect
- The cursor may have expired (old cursors can become invalid)
- Usually happens when resuming pagination from a previous session

### Recovery Strategy
Reset pagination to the beginning or use the default (no cursor) to restart.

### Code Example

```javascript
const axios = require('axios');

/**
 * Fetches paginated results with automatic cursor recovery.
 * @param {string} url - Base URL for the endpoint
 * @param {object} options - Request options including cursor
 * @returns {Promise<object>} Paginated response with records
 */
async function fetchPaginatedWithRecovery(url, options = {}) {
  const { cursor, limit = 20, ...otherParams } = options;
  const params = { limit, ...otherParams };
  
  if (cursor) {
    params.cursor = cursor;
  }
  
  try {
    const response = await axios.get(url, { params });
    return response.data;
  } catch (error) {
    if (error.response?.status === 400 && 
        error.response?.data?.error?.type === 'InvalidCursor') {
      
      console.warn('Invalid cursor detected. Resetting pagination.');
      
      // Retry without cursor - start from the beginning
      delete params.cursor;
      const response = await axios.get(url, { params });
      
      // Add metadata to indicate we reset
      response.data.paginationReset = true;
      response.data.originalCursor = cursor;
      
      return response.data;
    }
    
    throw error;
  }
}

/**
 * Fetches all records from a paginated endpoint.
 * @param {string} baseUrl - API base URL
 * @param {string} endpoint - API endpoint path
 * @param {Function} pageExtractor - Function to extract records from response
 * @returns {Promise<Array>} All records
 */
async function fetchAllPages(baseUrl, endpoint, pageExtractor) {
  const allRecords = [];
  let cursor = null;
  let hasMore = true;
  const MAX_PAGES = 100; // Safety limit
  
  for (let page = 0; page < MAX_PAGES && hasMore; page++) {
    const url = `${baseUrl}${endpoint}`;
    const response = await fetchPaginatedWithRecovery(url, { 
      cursor, 
      limit: 100 
    });
    
    const records = pageExtractor(response);
    allRecords.push(...records);
    
    // Check for pagination cursor in response
    cursor = response.data?.cursor;
    hasMore = cursor && records.length > 0;
    
    if (response.paginationReset) {
      console.log('Pagination was reset due to invalid cursor');
      // If we already had records and we got reset, we might have duplicates
      // Consider deduplication
    }
  }
  
  if (hasMore) {
    console.warn(`Stopped after ${MAX_PAGES} pages - more records may exist`);
  }
  
  return allRecords;
}

/**
 * Example: Fetch all trades for an account with cursor recovery.
 */
async function getAccountTrades(accountId) {
  return fetchAllPages(
    'http://localhost:3000',
    `/account/${accountId}/trades`,
    (response) => response.data.trades || []
  );
}
```

---

## Generic Error Handler

Here's a utility that handles all error types with appropriate strategies:

```javascript
const axios = require('axios');

class StellarKitClient {
  constructor(baseUrl = 'http://localhost:3000', options = {}) {
    this.baseUrl = baseUrl;
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 1000;
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const { params, ...axiosOptions } = options;
    
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await axios.get(url, { 
          params, 
          ...axiosOptions 
        });
        return response.data;
      } catch (error) {
        const errorInfo = this.classifyError(error);
        
        if (errorInfo.retryable && attempt < this.maxRetries - 1) {
          await this.delay(errorInfo.retryDelay * Math.pow(2, attempt));
          continue;
        }
        
        throw this.formatError(errorInfo);
      }
    }
  }

  classifyError(error) {
    const { response } = error;
    
    if (!response) {
      return { 
        type: 'NetworkError', 
        retryable: true, 
        retryDelay: 5,
        message: 'Network connection failed' 
      };
    }
    
    const errorBody = response.data?.error || {};
    
    switch (response.status) {
      case 429:
        return {
          type: errorBody.type || 'RateLimitExceeded',
          retryable: true,
          retryDelay: parseInt(response.headers['retry-after'], 10) || 60,
          message: errorBody.message || 'Rate limit exceeded',
          suggestion: errorBody.suggestion
        };
        
      case 503:
        return {
          type: errorBody.type || 'HorizonUnavailable',
          retryable: true,
          retryDelay: 5,
          message: errorBody.message || 'Horizon unavailable',
          suggestion: errorBody.suggestion
        };
        
      case 404:
        return {
          type: errorBody.type || 'NotFound',
          retryable: false,
          message: errorBody.message || 'Resource not found',
          suggestion: errorBody.suggestion
        };
        
      case 400:
        return {
          type: errorBody.type || 'BadRequest',
          retryable: false,
          message: errorBody.message || 'Invalid request',
          field: errorBody.field,
          suggestion: errorBody.suggestion
        };
        
      default:
        return {
          type: 'UnknownError',
          retryable: false,
          message: errorBody.message || error.message,
          status: response.status
        };
    }
  }

  formatError(errorInfo) {
    const error = new Error(errorInfo.message);
    error.code = errorInfo.type;
    error.retryable = errorInfo.retryable;
    error.suggestion = errorInfo.suggestion;
    return error;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Usage
const client = new StellarKitClient('http://localhost:3000');

try {
  const balances = await client.request('/account/GABC.../balances');
  console.log(balances);
} catch (error) {
  if (error.retryable) {
    console.log('This error is retryable');
  }
  if (error.suggestion) {
    console.log('Suggestion:', error.suggestion);
  }
}
```

---

## Related Documentation

- [Error Codes](./error-codes.md) - Complete list of HTTP status codes and error types
- [Error Reference](./error-reference.md) - Detailed error type definitions
- [Rate Limiting](./rate-limiting.md) - API rate limits and strategies
- [API Endpoints](./api-endpoints.md) - Endpoint-specific error behaviors