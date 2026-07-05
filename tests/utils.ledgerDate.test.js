const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");

describe("GET /utils/ledger-date", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns estimated date and note for a valid positive integer sequence", async () => {
    const mockClosedAt = "2026-06-27T12:00:00.000Z";
    const mockLatestSequence = 12355; // 10 ledgers ahead of 12345 (~50 seconds ahead)

    jest.spyOn(server, "ledgers").mockReturnValue({
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({
        records: [
          {
            sequence: mockLatestSequence.toString(),
            closed_at: mockClosedAt,
          },
        ],
      }),
    });

    const res = await request(app).get("/utils/ledger-date?sequence=12345");
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      sequence: 12345,
      estimatedDate: new Date(new Date(mockClosedAt).getTime() - 10 * 5 * 1000).toISOString(),
      note: "This date is an approximation based on an average Stellar ledger close time of ~5 seconds.",
    });
  });

  it("returns 400 for non-positive integers (e.g., 0)", async () => {
    const res = await request(app).get("/utils/ledger-date?sequence=0");
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 for negative integers (e.g., -123)", async () => {
    const res = await request(app).get("/utils/ledger-date?sequence=-123");
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 for non-integer strings", async () => {
    const res = await request(app).get("/utils/ledger-date?sequence=abc");
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
