"use strict";

const request = require("supertest");
const express = require("express");
const requestIdMiddleware = require("../../src/middleware/requestId");
const {
  isValidRequestId,
  generateRequestId,
  MAX_REQUEST_ID_LENGTH,
} = requestIdMiddleware;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("Request ID Middleware & Validation", () => {
  // ── isValidRequestId Unit Tests ───────────────────────────────────────────
  describe("isValidRequestId", () => {
    describe("valid IDs", () => {
      it("accepts valid alphanumeric IDs with hyphens", () => {
        expect(isValidRequestId("req-123")).toBe(true);
        expect(isValidRequestId("abc-def-ghi-123")).toBe(true);
        expect(isValidRequestId("my-trace-id-2026")).toBe(true);
      });

      it("accepts valid UUID strings", () => {
        expect(
          isValidRequestId("550e8400-e29b-41d4-a716-446655440000")
        ).toBe(true);
        expect(
          isValidRequestId("a1b2c3d4-e5f6-47g8-h9i0-j1k2l3m4n5o6")
        ).toBe(true);
      });

      it("accepts IDs with underscores and uppercase letters", () => {
        expect(isValidRequestId("REQ_ABC_123")).toBe(true);
        expect(isValidRequestId("trace_ID-999")).toBe(true);
      });

      it("accepts ID with length exactly equal to MAX_REQUEST_ID_LENGTH", () => {
        const exactLengthId = "a".repeat(MAX_REQUEST_ID_LENGTH);
        expect(isValidRequestId(exactLengthId)).toBe(true);
      });
    });

    describe("invalid IDs — newlines and CRLF injection", () => {
      it("rejects IDs containing newline (\\n)", () => {
        expect(isValidRequestId("req-123\n")).toBe(false);
        expect(isValidRequestId("\nreq-123")).toBe(false);
        expect(isValidRequestId("req\n123")).toBe(false);
      });

      it("rejects IDs containing carriage return (\\r)", () => {
        expect(isValidRequestId("req-123\r")).toBe(false);
        expect(isValidRequestId("\rreq-123")).toBe(false);
        expect(isValidRequestId("req\r123")).toBe(false);
      });

      it("rejects IDs containing CRLF header injection payloads", () => {
        expect(isValidRequestId("req-123\r\nSet-Cookie: evil=true")).toBe(false);
        expect(isValidRequestId("req-123\r\n\r\nHTTP/1.1 200 OK")).toBe(false);
      });
    });

    describe("invalid IDs — null bytes", () => {
      it("rejects IDs containing null byte (\\0 / \\u0000)", () => {
        expect(isValidRequestId("req-123\0")).toBe(false);
        expect(isValidRequestId("\0req-123")).toBe(false);
        expect(isValidRequestId("req\x00123")).toBe(false);
        expect(isValidRequestId("req\u0000-123")).toBe(false);
      });
    });

    describe("invalid IDs — non-printable and control characters", () => {
      it("rejects IDs containing ASCII control characters", () => {
        expect(isValidRequestId("req\x00123")).toBe(false);
        expect(isValidRequestId("req\x07123")).toBe(false); // BEL
        expect(isValidRequestId("req\x08123")).toBe(false); // Backspace
        expect(isValidRequestId("req\x1b123")).toBe(false); // ESC
        expect(isValidRequestId("req\x7f123")).toBe(false); // DEL
      });
    });

    describe("invalid IDs — oversized IDs", () => {
      it("rejects IDs exceeding MAX_REQUEST_ID_LENGTH", () => {
        const oversizedId = "a".repeat(MAX_REQUEST_ID_LENGTH + 1);
        expect(isValidRequestId(oversizedId)).toBe(false);
      });

      it("rejects massive string payloads", () => {
        const massiveId = "x".repeat(1000);
        expect(isValidRequestId(massiveId)).toBe(false);
      });
    });

    describe("invalid IDs — other invalid inputs", () => {
      it("rejects empty strings and whitespace-only strings", () => {
        expect(isValidRequestId("")).toBe(false);
        expect(isValidRequestId("   ")).toBe(false);
        expect(isValidRequestId("\t")).toBe(false);
      });

      it("rejects non-string inputs", () => {
        expect(isValidRequestId(null)).toBe(false);
        expect(isValidRequestId(undefined)).toBe(false);
        expect(isValidRequestId(12345)).toBe(false);
        expect(isValidRequestId({})).toBe(false);
        expect(isValidRequestId(["req-123"])).toBe(false);
      });

      it("rejects special characters, spaces, and HTML tags", () => {
        expect(isValidRequestId("req 123")).toBe(false);
        expect(isValidRequestId("req;123")).toBe(false);
        expect(isValidRequestId("req<script>")).toBe(false);
        expect(isValidRequestId('req"123"')).toBe(false);
        expect(isValidRequestId("req'123'")).toBe(false);
        expect(isValidRequestId("req/123")).toBe(false);
        expect(isValidRequestId("req\\123")).toBe(false);
      });
    });
  });

  // ── generateRequestId Unit Tests ──────────────────────────────────────────
  describe("generateRequestId", () => {
    it("generates a valid UUID string", () => {
      const id = generateRequestId();
      expect(typeof id).toBe("string");
      expect(id).toMatch(UUID_REGEX);
    });

    it("generates distinct IDs on consecutive calls", () => {
      const id1 = generateRequestId();
      const id2 = generateRequestId();
      expect(id1).not.toBe(id2);
    });
  });

  // ── requestIdMiddleware Unit Tests ────────────────────────────────────────
  describe("requestIdMiddleware unit execution", () => {
    let req;
    let res;
    let next;

    beforeEach(() => {
      req = {
        headers: {},
        get: jest.fn((name) => req.headers[name.toLowerCase()]),
      };
      res = {
        setHeader: jest.fn(),
      };
      next = jest.fn();
    });

    it("accepts a valid incoming X-Request-ID and sets it on req and res", () => {
      req.headers["x-request-id"] = "custom-req-123";
      requestIdMiddleware(req, res, next);

      expect(req.requestId).toBe("custom-req-123");
      expect(res.setHeader).toHaveBeenCalledWith(
        "X-Request-ID",
        "custom-req-123"
      );
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("generates a new UUID when incoming ID contains newline", () => {
      req.headers["x-request-id"] = "custom-req-123\nInjected-Header: evil";
      requestIdMiddleware(req, res, next);

      expect(req.requestId).not.toContain("\n");
      expect(req.requestId).toMatch(UUID_REGEX);
      expect(res.setHeader).toHaveBeenCalledWith("X-Request-ID", req.requestId);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("generates a new UUID when incoming ID contains null byte", () => {
      req.headers["x-request-id"] = "custom-req-123\0";
      requestIdMiddleware(req, res, next);

      expect(req.requestId).not.toContain("\0");
      expect(req.requestId).toMatch(UUID_REGEX);
      expect(res.setHeader).toHaveBeenCalledWith("X-Request-ID", req.requestId);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("generates a new UUID when incoming ID is oversized", () => {
      req.headers["x-request-id"] = "a".repeat(150);
      requestIdMiddleware(req, res, next);

      expect(req.requestId).toMatch(UUID_REGEX);
      expect(req.requestId.length).toBeLessThanOrEqual(MAX_REQUEST_ID_LENGTH);
      expect(res.setHeader).toHaveBeenCalledWith("X-Request-ID", req.requestId);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("generates a new UUID when X-Request-ID header is missing", () => {
      requestIdMiddleware(req, res, next);

      expect(req.requestId).toBeDefined();
      expect(req.requestId).toMatch(UUID_REGEX);
      expect(res.setHeader).toHaveBeenCalledWith("X-Request-ID", req.requestId);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  // ── HTTP Integration Tests ────────────────────────────────────────────────
  describe("HTTP Integration with Express app", () => {
    let testApp;

    beforeAll(() => {
      testApp = express();
      testApp.use(requestIdMiddleware);
      testApp.get("/test", (req, res) => {
        res.json({ success: true, requestId: req.requestId });
      });
    });

    it("echoes valid X-Request-ID header in response", async () => {
      const res = await request(testApp)
        .get("/test")
        .set("X-Request-ID", "valid-trace-id-123");

      expect(res.statusCode).toBe(200);
      expect(res.headers["x-request-id"]).toBe("valid-trace-id-123");
      expect(res.body.requestId).toBe("valid-trace-id-123");
    });

    it("generates and echoes a UUID when incoming header has newlines", async () => {
      const appWithInjected = express();
      appWithInjected.use((req, res, next) => {
        req.headers["x-request-id"] = "injected\nHeader: evil";
        next();
      });
      appWithInjected.use(requestIdMiddleware);
      appWithInjected.get("/test", (req, res) => {
        res.json({ success: true, requestId: req.requestId });
      });

      const res = await request(appWithInjected).get("/test");

      expect(res.statusCode).toBe(200);
      expect(res.headers["x-request-id"]).toMatch(UUID_REGEX);
      expect(res.headers["x-request-id"]).not.toContain("\n");
      expect(res.body.requestId).toBe(res.headers["x-request-id"]);
    });

    it("generates and echoes a UUID when incoming header has null byte", async () => {
      const appWithInjected = express();
      appWithInjected.use((req, res, next) => {
        req.headers["x-request-id"] = "nullbyte\0evil";
        next();
      });
      appWithInjected.use(requestIdMiddleware);
      appWithInjected.get("/test", (req, res) => {
        res.json({ success: true, requestId: req.requestId });
      });

      const res = await request(appWithInjected).get("/test");

      expect(res.statusCode).toBe(200);
      expect(res.headers["x-request-id"]).toMatch(UUID_REGEX);
      expect(res.headers["x-request-id"]).not.toContain("\0");
      expect(res.body.requestId).toBe(res.headers["x-request-id"]);
    });

    it("generates and echoes a UUID when incoming header is oversized", async () => {
      const res = await request(testApp)
        .get("/test")
        .set("X-Request-ID", "x".repeat(150));

      expect(res.statusCode).toBe(200);
      expect(res.headers["x-request-id"]).toMatch(UUID_REGEX);
      expect(res.body.requestId).toBe(res.headers["x-request-id"]);
    });

    it("generates and echoes a UUID when incoming header has invalid characters", async () => {
      const res = await request(testApp)
        .get("/test")
        .set("X-Request-ID", "invalid;header=attack");

      expect(res.statusCode).toBe(200);
      expect(res.headers["x-request-id"]).toMatch(UUID_REGEX);
      expect(res.body.requestId).toBe(res.headers["x-request-id"]);
    });

    it("generates and echoes a UUID when no X-Request-ID is provided", async () => {
      const res = await request(testApp).get("/test");

      expect(res.statusCode).toBe(200);
      expect(res.headers["x-request-id"]).toMatch(UUID_REGEX);
      expect(res.body.requestId).toBe(res.headers["x-request-id"]);
    });
  });
});
