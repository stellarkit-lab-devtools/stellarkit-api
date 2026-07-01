const StellarKitError = require("../src/utils/StellarKitError");

describe("StellarKitError", () => {
  it("should extend Error", () => {
    const err = new StellarKitError("test", 400, "ValidationError");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(StellarKitError);
  });

  it("should have the correct name", () => {
    const err = new StellarKitError("test", 400, "ValidationError");
    expect(err.name).toBe("StellarKitError");
  });

  it("should store statusCode, type, message, detail, and suggestion", () => {
    const err = new StellarKitError(
      "Account not found",
      404,
      "NotFound",
      "The Stellar account does not exist.",
      "Check the public key."
    );
    expect(err.message).toBe("Account not found");
    expect(err.statusCode).toBe(404);
    expect(err.type).toBe("NotFound");
    expect(err.detail).toBe("The Stellar account does not exist.");
    expect(err.suggestion).toBe("Check the public key.");
  });

  it("should default detail and suggestion to null", () => {
    const err = new StellarKitError("oops", 500, "ServerError");
    expect(err.detail).toBeNull();
    expect(err.suggestion).toBeNull();
  });

  it("should serialize to JSON with toJSON()", () => {
    const err = new StellarKitError(
      "Bad request",
      400,
      "ValidationError",
      "Field is missing",
      "Include the required field."
    );
    const json = err.toJSON();
    expect(json).toEqual({
      type: "ValidationError",
      message: "Bad request",
      detail: "Field is missing",
      suggestion: "Include the required field.",
    });
  });

  it("should omit null detail and suggestion from toJSON()", () => {
    const err = new StellarKitError("oops", 500, "ServerError");
    const json = err.toJSON();
    expect(json).toEqual({
      type: "ServerError",
      message: "oops",
    });
    expect(json).not.toHaveProperty("detail");
    expect(json).not.toHaveProperty("suggestion");
  });
});
