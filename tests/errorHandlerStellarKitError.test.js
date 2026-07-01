const StellarKitError = require("../src/utils/StellarKitError");
const errorHandler = require("../src/middleware/errorHandler");

// Mock Express req/res/next
function createMocks() {
  const req = { method: "GET", path: "/test" };
  const res = {
    _status: null,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; },
  };
  const next = jest.fn();
  return { req, res, next };
}

describe("errorHandler with StellarKitError", () => {
  it("should handle StellarKitError instances with correct status and body", () => {
    const { req, res, next } = createMocks();
    const err = new StellarKitError("Not found", 404, "NotFound", "Resource missing", "Check the ID.");

    errorHandler(err, req, res, next);

    expect(res._status).toBe(404);
    expect(res._body.success).toBe(false);
    expect(res._body.error.type).toBe("NotFound");
    expect(res._body.error.message).toBe("Not found");
    expect(res._body.error.detail).toBe("Resource missing");
    expect(res._body.error.suggestion).toBe("Check the ID.");
  });

  it("should handle StellarKitError without detail/suggestion", () => {
    const { req, res, next } = createMocks();
    const err = new StellarKitError("Server error", 500, "ServerError");

    errorHandler(err, req, res, next);

    expect(res._status).toBe(500);
    expect(res._body.error.type).toBe("ServerError");
    expect(res._body.error).not.toHaveProperty("detail");
    expect(res._body.error).not.toHaveProperty("suggestion");
  });

  it("should wrap validation errors with StellarKitError shape", () => {
    const { req, res, next } = createMocks();
    const err = new Error("Invalid field");
    err.isValidation = true;
    err.field = "accountId";
    err.receivedValue = "abc";
    err.expectedFormat = "G...";

    errorHandler(err, req, res, next);

    expect(res._status).toBe(400);
    expect(res._body.success).toBe(false);
    expect(res._body.error.type).toBe("ValidationError");
    expect(res._body.error.message).toBe("Invalid field");
    expect(res._body.error.field).toBe("accountId");
  });

  it("should wrap generic errors with StellarKitError shape", () => {
    const { req, res, next } = createMocks();
    const err = new Error("Something broke");

    errorHandler(err, req, res, next);

    expect(res._status).toBe(500);
    expect(res._body.success).toBe(false);
    expect(res._body.error.type).toBe("ServerError");
  });
});
