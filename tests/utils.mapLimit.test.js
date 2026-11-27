const { mapLimit } = require("../src/utils/mapLimit");

describe("mapLimit", () => {
  it("preserves input order", async () => {
    const items = [1, 2, 3, 4, 5];
    const result = await mapLimit(items, 2, async (x) => x * 10);
    expect(result).toEqual([10, 20, 30, 40, 50]);
  });

  it("never exceeds the concurrency limit", async () => {
    let active = 0;
    let maxActive = 0;
    const limit = 3;
    const items = Array.from({ length: 10 }, (_, i) => i);

    await mapLimit(items, limit, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
    });

    expect(maxActive).toBeLessThanOrEqual(limit);
  });

  it("rejects on the first error by default", async () => {
    const items = [1, 2, 3];
    await expect(
      mapLimit(items, 2, async (x) => {
        if (x === 2) throw new Error("boom");
        return x;
      }),
    ).rejects.toThrow("boom");
  });

  it("returns settled entries when settle:true", async () => {
    const items = [1, 2, 3];
    const result = await mapLimit(
      items,
      2,
      async (x) => {
        if (x === 2) throw new Error("bad");
        return x * 10;
      },
      { settle: true },
    );

    expect(result[0]).toEqual({ status: "fulfilled", value: 10 });
    expect(result[1]).toEqual({ status: "rejected", reason: expect.any(Error) });
    expect(result[2]).toEqual({ status: "fulfilled", value: 30 });
  });

  it("returns an empty array for an empty input", async () => {
    const result = await mapLimit([], 5, async (x) => x);
    expect(result).toEqual([]);
  });

  it("works when limit is larger than the item count", async () => {
    const items = [1, 2];
    const result = await mapLimit(items, 100, async (x) => x + 1);
    expect(result).toEqual([2, 3]);
  });
});
