const cacheService = require("../src/services/cache");

describe("CacheService hit/miss tracking", () => {
  beforeEach(() => {
    cacheService.flush();
    cacheService.hits = 0;
    cacheService.misses = 0;
  });

  it("should track a cache miss", () => {
    cacheService.get("nonexistent");
    const stats = cacheService.getStats();
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(0);
  });

  it("should track a cache hit", () => {
    cacheService.set("key1", "value1", 60);
    cacheService.get("key1");
    const stats = cacheService.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(0);
  });

  it("should calculate hit rate correctly", () => {
    cacheService.set("key1", "value1", 60);
    cacheService.get("key1"); // hit
    cacheService.get("key2"); // miss
    cacheService.get("key1"); // hit
    cacheService.get("key3"); // miss
    const stats = cacheService.getStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(2);
    expect(stats.hitRate).toBe("50.00%");
  });

  it("should return 0.00% hit rate when no requests", () => {
    const stats = cacheService.getStats();
    expect(stats.hitRate).toBe("0.00%");
  });

  it("should count cached keys", () => {
    cacheService.set("a", 1, 60);
    cacheService.set("b", 2, 60);
    cacheService.set("c", 3, 60);
    const stats = cacheService.getStats();
    expect(stats.cachedKeys).toBe(3);
  });

  it("should return correct stats structure from getStats()", () => {
    cacheService.set("x", "y", 60);
    cacheService.get("x"); // hit
    cacheService.get("z"); // miss
    const stats = cacheService.getStats();
    expect(stats).toHaveProperty("hits");
    expect(stats).toHaveProperty("misses");
    expect(stats).toHaveProperty("hitRate");
    expect(stats).toHaveProperty("cachedKeys");
    expect(typeof stats.hits).toBe("number");
    expect(typeof stats.misses).toBe("number");
    expect(typeof stats.hitRate).toBe("string");
    expect(typeof stats.cachedKeys).toBe("number");
  });
});
