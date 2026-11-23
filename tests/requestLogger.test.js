const requestLogger = require("../src/middleware/requestLogger");
const logger = require("../src/utils/logger");

describe("requestLogger middleware", () => {
  let req, res, next, finishHandler;

  beforeEach(() => {
    finishHandler = undefined;
    req = {
      method: "GET",
      originalUrl: "/health",
      requestId: "req-123",
    };
    res = {
      statusCode: 200,
      on: jest.fn((event, cb) => {
        if (event === "finish") {
          finishHandler = cb;
        }
      }),
    };
    next = jest.fn();
    jest.spyOn(logger, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("calls next() and registers a finish handler", () => {
    requestLogger(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.on).toHaveBeenCalledWith("finish", expect.any(Function));
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("logs method, path, status code, request ID and elapsed time on finish", () => {
    requestLogger(req, res, next);
    finishHandler();

    expect(logger.info).toHaveBeenCalledTimes(1);
    const [fields, message] = logger.info.mock.calls[0];

    // Structured fields include all four request fields...
    expect(fields).toEqual(
      expect.objectContaining({
        method: "GET",
        path: "/health",
        statusCode: 200,
        requestId: "req-123",
      }),
    );
    // ...plus the elapsed response time in milliseconds.
    expect(typeof fields.responseTimeMs).toBe("number");
    expect(fields.responseTimeMs).toBeGreaterThanOrEqual(0);

    // The human-readable message line is consistent and carries every field.
    expect(message).toContain("req-123");
    expect(message).toContain("GET");
    expect(message).toContain("/health");
    expect(message).toContain("200");
    expect(message).toMatch(/\d+(\.\d+)?ms/);
  });

  it("uses originalUrl for the logged path", () => {
    req.originalUrl = "/account/GABC123?limit=10";
    requestLogger(req, res, next);
    finishHandler();

    const [fields] = logger.info.mock.calls[0];
    expect(fields.path).toBe("/account/GABC123?limit=10");
  });

  it("falls back to '-' when no request ID is present", () => {
    delete req.requestId;
    requestLogger(req, res, next);
    finishHandler();

    const [fields, message] = logger.info.mock.calls[0];
    expect(fields.requestId).toBe("-");
    expect(message).toContain("[-]");
  });
});
