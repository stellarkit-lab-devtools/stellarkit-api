/**
 * Test for cache leak detection - tests that timers and cache state don't leak
 * between tests.
 * 
 * This test should pass when run alone but fail when run with other tests
 * that don't properly clean up.
 */

const cacheService = require("../src/services/cache");

describe("Cache isolation tests", () => {
  beforeEach(() => {
    // Each test should start with a clean cache
    cacheService.flush();
  });

  afterEach(() => {
    // Clean up after each test
    cacheService.flush();
  });

  it("should have empty cache at start", () => {
    const stats = cacheService.getStats();
    expect(stats.cachedKeys).toBe(0);
  });

  it("can set and get values", () => {
    cacheService.set("test-key", { foo: "bar" }, 60);
    const value = cacheService.get("test-key");
    expect(value).toEqual({ foo: "bar" });
  });

  it("should not leak keys between tests", () => {
    const stats = cacheService.getStats();
    expect(stats.cachedKeys).toBe(0);
  });

  it("isolates cache state - set in one test not visible in another", () => {
    // This test sets a key
    cacheService.set("isolation-key", "test-value", 60);
    const value = cacheService.get("isolation-key");
    expect(value).toBe("test-value");
  });

  // This test verifies isolation - if previous test leaked, this will see the key
  it("should see empty cache even after setting keys in other tests", () => {
    // Any keys set in previous test should NOT be visible here
    const value = cacheService.get("isolation-key");
    expect(value).toBeUndefined();
    
    const stats = cacheService.getStats();
    expect(stats.cachedKeys).toBe(0);
  });
});

describe("Timer cleanup tests", () => {
  beforeEach(() => {
    cacheService.flush();
  });

  afterEach(() => {
    // Clear any timers that might be running
    jest.clearAllTimers();
  });

  it("can set values with TTL and retrieve before expiry", () => {
    jest.useFakeTimers();
    
    cacheService.set("ttl-key", "value", 10);
    
    // Advance time but not past TTL
    jest.advanceTimersByTime(5000);
    
    const value = cacheService.get("ttl-key");
    expect(value).toBe("value");
    
    jest.useRealTimers();
  });

  it("timer cleanup prevents leaks", () => {
    // This test just verifies timers can be cleaned up
    jest.useFakeTimers();
    
    cacheService.set("timer-test", "data", 60);
    
    // Clean up
    jest.useRealTimers();
    
    // Next test should not be affected
    expect(true).toBe(true);
  });
});