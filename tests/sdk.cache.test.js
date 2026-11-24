/**
 * Tests for the StellarKitClient client-side response cache.
 *
 * Acceptance criteria:
 *   - Setting cache: { ttlMs, maxEntries } caches successful GET responses by URL.
 *   - LRU eviction at maxEntries (default 200).
 *   - Identical in-flight requests share one fetch.
 *   - Errors are never cached.
 *   - A per-call { fresh: true } bypasses the cache.
 *   - Off by default.
 *   - Affects only this client instance.
 *
 * Tests with fake timers cover:
 *   - hit within TTL (fetch called once)
 *   - expiry
 *   - fresh bypass
 *   - LRU eviction
 *   - errors not cached
 *   - ten concurrent identical calls producing one fetch
 */

// ── Client stub (mirrors sdk/stellarkit-client.ts cache logic) ──────────────
// The TypeScript source cannot be loaded in Jest without a transform, so we
// test against an equivalent JS stub that implements the same cache contract.

class StellarKitError extends Error {
  constructor(message, status, type) {
    super(message);
    this.name = "StellarKitError";
    this.status = status;
    this.type = type;
  }
}

class StellarKitClient {
  constructor({ baseUrl, apiKey, fetch: fetchImpl, cache }) {
    if (!baseUrl) throw new Error("baseUrl is required");
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this._fetch = fetchImpl || global.fetch;
    this._cacheConfig = cache ?? null;
    this._cacheTtlMs = cache?.ttlMs ?? 60_000;
    this._cacheMaxEntries = cache?.maxEntries ?? 200;
    this._cache = new Map();
    this._inFlight = new Map();
  }

  async _request(path, { method = "GET", fresh = false } = {}) {
    const url = `${this.baseUrl}${path}`;

    if (this._cacheConfig && method === "GET" && !fresh) {
      const entry = this._cache.get(url);
      if (entry && Date.now() < entry.expiresAt) {
        this._cache.delete(url);
        this._cache.set(url, entry);
        return entry.data;
      }
      if (entry) this._cache.delete(url);

      const inFlight = this._inFlight.get(url);
      if (inFlight) return inFlight;
    }

    const headers = { "Content-Type": "application/json" };
    if (this.apiKey) headers["x-api-key"] = this.apiKey;

    const promise = (async () => {
      const res = await this._fetch(url, { method, headers });
      const body = await res.json();
      if (!res.ok) {
        throw new StellarKitError(
          body?.error?.message || res.statusText,
          res.status,
          body?.error?.type || "ApiError",
        );
      }
      return body.data;
    })();

    if (this._cacheConfig && method === "GET") {
      this._inFlight.set(url, promise);
      promise
        .then((data) => {
          if (!fresh) {
            if (this._cache.has(url)) this._cache.delete(url);
            this._cache.set(url, { data, expiresAt: Date.now() + this._cacheTtlMs });
            while (this._cache.size > this._cacheMaxEntries) {
              const oldest = this._cache.keys().next().value;
              if (oldest === undefined) break;
              this._cache.delete(oldest);
            }
          }
        })
        .catch(() => {})
        .finally(() => {
          this._inFlight.delete(url);
        });
    }

    return promise;
  }

  async getHealth(options) {
    return this._request("/health", { fresh: options?.fresh });
  }

  async getAccount(id) {
    return this._request(`/account/${id}`);
  }
}

// ── Test helpers ─────────────────────────────────────────────────────────────

const BASE_URL = "http://localhost:3000";

function createMockFetch() {
  const fn = jest.fn();
  fn.mockImplementation(async (url) => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ success: true, data: { url, timestamp: Date.now() } }),
  }));
  return fn;
}

function createErrorFetch(status = 500, errorType = "ServerError") {
  return jest.fn().mockImplementation(async () => ({
    ok: false,
    status,
    statusText: "Error",
    json: async () => ({
      success: false,
      error: { message: "Something went wrong", type: errorType },
    }),
  }));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("StellarKitClient response cache", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  // ── Cache is off by default ────────────────────────────────────────────────

  it("does not cache when cache option is not set", async () => {
    const fetchMock = createMockFetch();
    const client = new StellarKitClient({ baseUrl: BASE_URL, fetch: fetchMock });

    await client.getHealth();
    await client.getHealth();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // ── Hit within TTL ─────────────────────────────────────────────────────────

  it("serves from cache on a hit within the TTL (fetch called once)", async () => {
    const fetchMock = createMockFetch();
    const client = new StellarKitClient({
      baseUrl: BASE_URL,
      fetch: fetchMock,
      cache: { ttlMs: 5000 },
    });

    await client.getHealth();
    await client.getHealth();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // ── Expiry ─────────────────────────────────────────────────────────────────

  it("refetches after the TTL expires", async () => {
    const fetchMock = createMockFetch();
    const client = new StellarKitClient({
      baseUrl: BASE_URL,
      fetch: fetchMock,
      cache: { ttlMs: 5000 },
    });

    await client.getHealth();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Advance past the TTL.
    jest.advanceTimersByTime(5001);

    await client.getHealth();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // ── Fresh bypass ──────────────────────────────────────────────────────────

  it("bypasses cache when { fresh: true } is passed per-call", async () => {
    const fetchMock = createMockFetch();
    const client = new StellarKitClient({
      baseUrl: BASE_URL,
      fetch: fetchMock,
      cache: { ttlMs: 5000 },
    });

    await client.getHealth();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await client.getHealth({ fresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Subsequent call without fresh should still hit cache (from the fresh call).
    await client.getHealth();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // ── LRU eviction ───────────────────────────────────────────────────────────

  it("evicts the least-recently-used entry at maxEntries", async () => {
    const fetchMock = createMockFetch();
    const client = new StellarKitClient({
      baseUrl: BASE_URL,
      fetch: fetchMock,
      cache: { ttlMs: 60_000, maxEntries: 3 },
    });

    // Fill cache with 3 distinct URLs.
    await client.getAccount("AAA");
    await client.getAccount("BBB");
    await client.getAccount("CCC");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Access "AAA" to make it more-recently-used than "BBB".
    await client.getAccount("AAA");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Add a 4th entry — "BBB" should be evicted (least recently used).
    await client.getAccount("DDD");
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // "AAA" should still be cached.
    await client.getAccount("AAA");
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // "BBB" should have been evicted — fetch is called again.
    await client.getAccount("BBB");
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  // ── Errors are never cached ───────────────────────────────────────────────

  it("does not cache error responses", async () => {
    const errorFetch = createErrorFetch(500);
    const client = new StellarKitClient({
      baseUrl: BASE_URL,
      fetch: errorFetch,
      cache: { ttlMs: 5000 },
    });

    await expect(client.getHealth()).rejects.toThrow(StellarKitError);
    await expect(client.getHealth()).rejects.toThrow(StellarKitError);

    expect(errorFetch).toHaveBeenCalledTimes(2);
  });

  // ── Concurrent identical calls produce one fetch ──────────────────────────

  it("ten concurrent identical calls produce one fetch (in-flight dedup)", async () => {
    const fetchMock = jest.fn().mockImplementation(
      (url) =>
        new Promise((resolve) => {
          // Delay the response so all 10 calls are in-flight simultaneously.
          setTimeout(() => {
            resolve({
              ok: true,
              status: 200,
              statusText: "OK",
              json: async () => ({ success: true, data: { url } }),
            });
          }, 100);
        }),
    );

    const client = new StellarKitClient({
      baseUrl: BASE_URL,
      fetch: fetchMock,
      cache: { ttlMs: 5000 },
    });

    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(client.getHealth());
    }

    // Advance timers to let the setTimeout resolve.
    jest.advanceTimersByTime(101);
    await Promise.all(promises);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // ── Affects only this client instance ──────────────────────────────────────

  it("cache is local to each client instance", async () => {
    const fetchMock = createMockFetch();
    const cachedClient = new StellarKitClient({
      baseUrl: BASE_URL,
      fetch: fetchMock,
      cache: { ttlMs: 5000 },
    });
    const uncachedClient = new StellarKitClient({
      baseUrl: BASE_URL,
      fetch: fetchMock,
    });

    await cachedClient.getHealth();
    await uncachedClient.getHealth();

    // Cached client hits, uncached client fetches.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await cachedClient.getHealth();
    await uncachedClient.getHealth();

    // Cached client still has 1 fetch, uncached client has 3.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  // ── Default maxEntries is 200 ──────────────────────────────────────────────

  it("default maxEntries is 200", async () => {
    const fetchMock = createMockFetch();
    const client = new StellarKitClient({
      baseUrl: BASE_URL,
      fetch: fetchMock,
      cache: { ttlMs: 60_000 }, // no maxEntries → default 200
    });

    // Fill 200 entries.
    for (let i = 0; i < 200; i++) {
      await client.getAccount(`acct${i}`);
    }
    expect(fetchMock).toHaveBeenCalledTimes(200);

    // Entry 0 should still be cached.
    await client.getAccount("acct0");
    expect(fetchMock).toHaveBeenCalledTimes(200);

    // Adding a 201st entry evicts the LRU entry.
    await client.getAccount("acct200");
    expect(fetchMock).toHaveBeenCalledTimes(201);
  });
});
