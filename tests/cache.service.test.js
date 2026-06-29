const cacheService = require("../src/services/cache");

describe("CacheService", () => {
  beforeEach(() => {
    cacheService.flush();
  });

  it("should set and get a value", () => {
    cacheService.set("test-key", { foo: "bar" }, 10);
    expect(cacheService.get("test-key")).toEqual({ foo: "bar" });
  });

  it("should return undefined for missing key", () => {
    expect(cacheService.get("missing-key")).toBeUndefined();
  });

  it("should respect TTL", (done) => {
    cacheService.set("ttl-key", "value", 1); // 1 second TTL
    expect(cacheService.get("ttl-key")).toBe("value");
    
    setTimeout(() => {
      expect(cacheService.get("ttl-key")).toBeUndefined();
      done();
    }, 1100);
  });

  it("should delete a key", () => {
    cacheService.set("del-key", "value", 10);
    cacheService.delete("del-key");
    expect(cacheService.get("del-key")).toBeUndefined();
  });

  it("should flush the cache", () => {
    cacheService.set("key1", "val1", 10);
    cacheService.set("key2", "val2", 10);
    cacheService.flush();
    expect(cacheService.get("key1")).toBeUndefined();
    expect(cacheService.get("key2")).toBeUndefined();
  });
});
