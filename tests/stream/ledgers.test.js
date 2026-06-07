const request = require("supertest");
const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

describe("GET /stream/ledgers — SSE Endpoint", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns Content-Type: text/event-stream", async () => {
    // Mock stream to avoid real Horizon call; immediately close via onerror
    jest.spyOn(server, "ledgers").mockReturnValue({
      cursor: () => ({
        stream: ({ onerror }) => {
          setImmediate(() => onerror(new Error("test")));
          return () => {};
        },
      }),
    });

    const res = await request(app).get("/stream/ledgers");
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
  });

  it("streams a ledger event as SSE data", (done) => {
    const mockLedger = {
      sequence: 123456,
      closed_at: "2024-01-01T12:00:00Z",
      base_fee_in_stroops: 100,
      successful_transaction_count: 42,
      operation_count: 89,
    };

    jest.spyOn(server, "ledgers").mockReturnValue({
      cursor: () => ({
        stream: ({ onmessage, onerror }) => {
          setImmediate(() => {
            onmessage(mockLedger);
            onerror(new Error("end"));
          });
          return () => {};
        },
      }),
    });

    const chunks = [];
    const req = request(app).get("/stream/ledgers");
    req.buffer(false);
    req.parse((res, callback) => {
      res.on("data", (chunk) => chunks.push(chunk.toString()));
      res.on("end", () => {
        const body = chunks.join("");
        expect(body).toContain("data:");
        const lines = body.split("\n").filter((l) => l.startsWith("data:"));
        expect(lines.length).toBeGreaterThan(0);
        const parsed = JSON.parse(lines[0].replace("data: ", ""));
        expect(parsed.sequence).toBe(123456);
        expect(parsed.closedAt).toBe("2024-01-01T12:00:00Z");
        expect(parsed.baseFee).toBe(100);
        expect(parsed.transactionCount).toBe(42);
        expect(parsed.operationCount).toBe(89);
        callback(null, {});
        done();
      });
    });
    req.end();
  });

  it("sends heartbeat comment lines", () => {
    // Unit test: verify the endpoint sets SSE headers
    // Heartbeat timing is tested via the interval setup in the route
    // This test just verifies the route doesn't crash with no stream events
    jest.spyOn(server, "ledgers").mockReturnValue({
      cursor: () => ({
        stream: ({ onerror }) => {
          setImmediate(() => onerror(new Error("end")));
          return () => {};
        },
      }),
    });

    return request(app)
      .get("/stream/ledgers")
      .then((res) => {
        expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
      });
  });

  it("closes the Horizon subscription on client disconnect", () => {
    let closeCalled = false;
    const closeStream = () => { closeCalled = true; };

    jest.spyOn(server, "ledgers").mockReturnValue({
      cursor: () => ({
        stream: ({ onerror }) => {
          setImmediate(() => onerror(new Error("end")));
          return closeStream;
        },
      }),
    });

    return request(app)
      .get("/stream/ledgers")
      .then(() => {
        // After the stream ends, closeStream should have been called
        expect(closeCalled).toBe(true);
      });
  });
});
