"use strict";

const fs = require("fs");
const path = require("path");
const {
  ERROR_TYPES,
  DEFAULT_DOCS_BASE_URL,
  getDocsUrl,
  getDocsBaseUrl,
  toAnchor,
  withDocsUrl,
} = require("../src/utils/errorTypes");
const errorHandler = require("../src/middleware/errorHandler");

const docs = fs.readFileSync(path.join(__dirname, "../docs/error-reference.md"), "utf8");
const headings = new Set(
  [...docs.matchAll(/^#{2,4}\s+(.+?)\s*$/gm)].map((match) => match[1])
);

describe("error type registry", () => {
  it("has a matching heading in docs/error-reference.md for every registered type", () => {
    const missing = Object.values(ERROR_TYPES).filter((heading) => !headings.has(heading));
    expect(missing).toEqual([]);
  });

  it("links a known type to its heading", () => {
    expect(getDocsUrl("OfferNotFound")).toBe(`${DEFAULT_DOCS_BASE_URL}#offernotfound`);
  });

  it("honours DOCS_BASE_URL", () => {
    const original = process.env.DOCS_BASE_URL;
    process.env.DOCS_BASE_URL = "https://docs.example.com/errors/";
    expect(getDocsBaseUrl()).toBe("https://docs.example.com/errors");
    expect(getDocsUrl("ValidationError")).toBe("https://docs.example.com/errors#validationerror");
    if (original === undefined) delete process.env.DOCS_BASE_URL;
    else process.env.DOCS_BASE_URL = original;
  });

  it("links unknown types to the top of the document", () => {
    expect(getDocsUrl("NeverRegistered")).toBe(DEFAULT_DOCS_BASE_URL);
  });

  it("adds docsUrl without changing any other error field", () => {
    const error = { type: "Unauthorized", message: "nope" };
    expect(withDocsUrl(error)).toEqual({
      type: "Unauthorized",
      message: "nope",
      docsUrl: `${DEFAULT_DOCS_BASE_URL}#unauthorized`,
    });
    expect(toAnchor("Payload Too Large Error")).toBe("payload-too-large-error");
  });

  it("adds docsUrl to responses produced by errorHandler", () => {
    const req = { method: "GET", path: "/test" };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    errorHandler(new Error("boom"), req, res, jest.fn());
    expect(res.json.mock.calls[0][0].error.docsUrl).toBe(`${DEFAULT_DOCS_BASE_URL}#servererror`);
  });
});
