/**
 * Slow request detection tests for the requestLogger middleware.
 *
 * Verifies that:
 *   - A [SLOW REQUEST] warning is logged when a request exceeds the threshold
 *   - No warning is logged for fast requests
 *   - The warning contains route, method, duration, and request ID
 */

const requestLogger = require("../src/middleware/requestLogger");
const logger = require("../src/utils/logger");

describe("requestLogger — slow request detection", () => {
  let req, res, next, finishHandler;

  beforeEach(() => {
    finishHandler = undefined;
    req = {
      method: "GET",
      originalUrl: "/account/GABC123",
      requestId: "req-slow-001",
    };
    res = {
      statusCode: 200,
      on: jest.fn((event, cb) => {
        if (event === "finish") finishHandler = cb;
      }),
    };
    next = jest.fn();

    jest.spyOn(logger, "info").mockImplementation(() => {});
    jest.spyOn(logger, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * Simulate a response finish after a given number of milliseconds by
   * temporarily overriding process.hrtime.bigint so the middleware measures
   * the injected duration rather than real wall clock time.
   */
  function simulateFinishAfterMs(durationMs) {
    const fakeNs = BigInt(Math.round(durationMs * 1e6));
    let callCount = 0;
    jest.spyOn(process.hrtime, "bigint").mockImplementation(() => {
      // First call (in requestLogger) → 0n, second call (in finish handler) → fakeNs
      return callCount++ === 0 ? 0n : fakeNs;
    });
    requestLogger(req, res, next);
    finishHandler();
    process.hrtime.bigint.mockRestore();
  }

  it("logs a [SLOW REQUEST] warning when duration exceeds the threshold", () => {
    const threshold = requestLogger.SLOW_REQUEST_THRESHOLD_MS;
    simulateFinishAfterMs(threshold + 500);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [fields, message] = logger.warn.mock.calls[0];

    // Structured fields
    expect(fields.method).toBe("GET");
    expect(fields.path).toBe("/account/GABC123");
    expect(fields.requestId).toBe("req-slow-001");
    expect(typeof fields.durationMs).toBe("number");
    expect(fields.durationMs).toBeGreaterThan(threshold);

    // Human-readable message
    expect(message).toContain("[SLOW REQUEST]");
    expect(message).toContain("GET");
    expect(message).toContain("/account/GABC123");
    expect(message).toContain("req-slow-001");
    expect(message).toMatch(/\d+(\.\d+)?ms/);
  });

  it("does NOT log a [SLOW REQUEST] warning for a fast request", () => {
    simulateFinishAfterMs(10); // well under the threshold

    expect(logger.warn).not.toHaveBeenCalled();
    // The normal info log should still fire
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it("does NOT log a warning when duration equals the threshold exactly", () => {
    const threshold = requestLogger.SLOW_REQUEST_THRESHOLD_MS;
    simulateFinishAfterMs(threshold); // at-boundary: not strictly greater

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("includes the request ID from req.requestId in the warning", () => {
    req.requestId = "test-req-xyz";
    const threshold = requestLogger.SLOW_REQUEST_THRESHOLD_MS;
    simulateFinishAfterMs(threshold + 100);

    const [fields, message] = logger.warn.mock.calls[0];
    expect(fields.requestId).toBe("test-req-xyz");
    expect(message).toContain("test-req-xyz");
  });

  it("includes the route path in the warning", () => {
    req.originalUrl = "/soroban/contract/CABC/storage";
    const threshold = requestLogger.SLOW_REQUEST_THRESHOLD_MS;
    simulateFinishAfterMs(threshold + 1);

    const [, message] = logger.warn.mock.calls[0];
    expect(message).toContain("/soroban/contract/CABC/storage");
  });

  it("includes the HTTP method in the warning", () => {
    req.method = "POST";
    const threshold = requestLogger.SLOW_REQUEST_THRESHOLD_MS;
    simulateFinishAfterMs(threshold + 1);

    const [fields, message] = logger.warn.mock.calls[0];
    expect(fields.method).toBe("POST");
    expect(message).toContain("POST");
  });

  it("still logs the normal info entry alongside the slow warning", () => {
    const threshold = requestLogger.SLOW_REQUEST_THRESHOLD_MS;
    simulateFinishAfterMs(threshold + 200);

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("exports SLOW_REQUEST_THRESHOLD_MS so the threshold value is introspectable", () => {
    expect(typeof requestLogger.SLOW_REQUEST_THRESHOLD_MS).toBe("number");
    expect(requestLogger.SLOW_REQUEST_THRESHOLD_MS).toBeGreaterThan(0);
  });
});
