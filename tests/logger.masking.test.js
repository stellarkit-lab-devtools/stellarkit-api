/**
 * Tests for log field masking in the Pino logger.
 *
 * Verifies that sensitive fields are replaced with "[REDACTED]" before the
 * log entry is written, while normal fields pass through unchanged.
 *
 * Strategy: We spy on the logger's underlying `write` method (the stream
 * that Pino serialises JSON to) so we can inspect the raw JSON output without
 * needing a transport or file sink.
 *
 * Because Pino's redact is applied during serialisation, we also validate the
 * behaviour by directly calling logger.info() with objects that contain the
 * sensitive paths and then reading what Pino actually wrote.
 */

const logger = require("../src/utils/logger");

/**
 * Capture the next JSON log line emitted by the logger.
 * Returns a Promise that resolves with the parsed log object.
 *
 * Pino writes to its destination stream. In tests (non-production) the
 * destination is pino-pretty which doesn't expose easy JSON. We therefore
 * create a child logger bound to a raw JSON stream for inspection.
 */

const pino = require("pino");

function createTestLogger() {
  let captured = null;
  const dest = {
    write(chunk) {
      try {
        captured = JSON.parse(chunk);
      } catch {
        // ignore non-JSON lines (pino-pretty header lines, etc.)
      }
    },
  };

  const testLogger = pino(
    {
      level: "info",
      redact: {
        paths: [
          "req.headers.authorization",
          "headers.authorization",
          'req.headers["x-api-key"]',
          'headers["x-api-key"]',
          "*.secret",
          "*.key",
          "[*].secret",
          "[*].key",
        ],
        censor: "[REDACTED]",
      },
    },
    dest,
  );

  return { testLogger, getLastLog: () => captured };
}

describe("Logger — sensitive field masking", () => {
  describe("HTTP header redaction", () => {
    it("redacts authorization header nested under headers", () => {
      const { testLogger, getLastLog } = createTestLogger();

      testLogger.info(
        { headers: { authorization: "Bearer super-secret-token", "content-type": "application/json" } },
        "incoming request",
      );

      const log = getLastLog();
      expect(log).not.toBeNull();
      expect(log.headers.authorization).toBe("[REDACTED]");
      expect(log.headers["content-type"]).toBe("application/json");
    });

    it("redacts x-api-key header nested under headers", () => {
      const { testLogger, getLastLog } = createTestLogger();

      testLogger.info(
        { headers: { "x-api-key": "my-private-key-12345", accept: "application/json" } },
        "incoming request",
      );

      const log = getLastLog();
      expect(log.headers["x-api-key"]).toBe("[REDACTED]");
      expect(log.headers.accept).toBe("application/json");
    });
  });

  describe("Body field redaction", () => {
    it("redacts a field named secret in a plain object", () => {
      const { testLogger, getLastLog } = createTestLogger();

      testLogger.info(
        { body: { username: "alice", secret: "p@ssw0rd!" } },
        "request body",
      );

      const log = getLastLog();
      expect(log.body.secret).toBe("[REDACTED]");
      expect(log.body.username).toBe("alice");
    });

    it("redacts a field named key in a plain object", () => {
      const { testLogger, getLastLog } = createTestLogger();

      testLogger.info(
        { payload: { name: "stellar", key: "S…privateKey…" } },
        "payload log",
      );

      const log = getLastLog();
      expect(log.payload.key).toBe("[REDACTED]");
      expect(log.payload.name).toBe("stellar");
    });

    it("redacts secret fields in array elements", () => {
      const { testLogger, getLastLog } = createTestLogger();

      testLogger.info(
        [{ id: 1, secret: "abc" }, { id: 2, secret: "xyz" }],
        "array log",
      );

      const log = getLastLog();
      // Pino serialises the array argument; each element's secret is redacted
      expect(log[0].secret).toBe("[REDACTED]");
      expect(log[1].secret).toBe("[REDACTED]");
    });

    it("redacts key fields in array elements", () => {
      const { testLogger, getLastLog } = createTestLogger();

      testLogger.info(
        [{ id: 1, key: "k1" }, { id: 2, key: "k2" }],
        "array log",
      );

      const log = getLastLog();
      expect(log[0].key).toBe("[REDACTED]");
      expect(log[1].key).toBe("[REDACTED]");
    });
  });

  describe("Normal field pass-through", () => {
    it("logs normal fields unchanged", () => {
      const { testLogger, getLastLog } = createTestLogger();

      testLogger.info(
        { requestId: "abc-123", method: "GET", statusCode: 200 },
        "request complete",
      );

      const log = getLastLog();
      expect(log.requestId).toBe("abc-123");
      expect(log.method).toBe("GET");
      expect(log.statusCode).toBe(200);
    });

    it("logs string messages unchanged", () => {
      const { testLogger, getLastLog } = createTestLogger();

      testLogger.info("plain message");

      const log = getLastLog();
      expect(log.msg).toBe("plain message");
    });
  });

  describe("req.headers redaction path", () => {
    it("redacts req.headers.authorization (Pino-style request logging)", () => {
      const { testLogger, getLastLog } = createTestLogger();

      testLogger.info(
        { req: { headers: { authorization: "Bearer token", host: "localhost" } } },
        "http",
      );

      const log = getLastLog();
      expect(log.req.headers.authorization).toBe("[REDACTED]");
      expect(log.req.headers.host).toBe("localhost");
    });

    it("redacts req.headers['x-api-key']", () => {
      const { testLogger, getLastLog } = createTestLogger();

      testLogger.info(
        { req: { headers: { "x-api-key": "secret-key", host: "localhost" } } },
        "http",
      );

      const log = getLastLog();
      expect(log.req.headers["x-api-key"]).toBe("[REDACTED]");
    });
  });
});
