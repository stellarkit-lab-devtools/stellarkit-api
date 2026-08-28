const crypto = require("crypto");
const request = require("supertest");
const express = require("express");
const webhookSignatureAuth = require("../src/middleware/webhookSignatureAuth");

describe("Webhook Signature Authentication Middleware", () => {
  let app;
  const SECRET = "test-webhook-secret";

  beforeEach(() => {
    process.env.WEBHOOK_ADMIN_SECRET = SECRET;
    app = express();
    app.use(express.json({ verify: (req, res, buf) => {
      req.rawBody = buf.toString('utf8');
    }}));
  });

  afterEach(() => {
    delete process.env.WEBHOOK_ADMIN_SECRET;
  });

  it("should reject requests without WEBHOOK_ADMIN_SECRET env var configured", async () => {
    delete process.env.WEBHOOK_ADMIN_SECRET;
    
    const testApp = express();
    testApp.use(express.json());
    testApp.post("/test", webhookSignatureAuth, (req, res) => {
      res.json({ success: true });
    });

    const response = await request(testApp)
      .post("/test")
      .send({ test: "data" })
      .set("X-Webhook-Signature", "any-signature");

    expect(response.status).toBe(401);
    expect(response.body.error.type).toBe("Unauthorized");
    expect(response.body.error.message).toContain("not configured");
  });

  it("should reject requests without X-Webhook-Signature header", async () => {
    app.post("/test", webhookSignatureAuth, (req, res) => {
      res.json({ success: true });
    });

    const response = await request(app)
      .post("/test")
      .send({ test: "data" });

    expect(response.status).toBe(401);
    expect(response.body.error.type).toBe("Unauthorized");
    expect(response.body.error.message).toContain("Missing");
  });

  it("should reject requests with invalid signature", async () => {
    app.post("/test", webhookSignatureAuth, (req, res) => {
      res.json({ success: true });
    });

    const response = await request(app)
      .post("/test")
      .send({ test: "data" })
      .set("X-Webhook-Signature", "invalid-signature-12345");

    expect(response.status).toBe(401);
    expect(response.body.error.type).toBe("Unauthorized");
    expect(response.body.error.message).toContain("Invalid");
  });

  it("should accept requests with valid HMAC-SHA256 signature", async () => {
    app.post("/test", webhookSignatureAuth, (req, res) => {
      res.json({ success: true });
    });

    const body = JSON.stringify({ test: "data" });
    const signature = crypto
      .createHmac("sha256", SECRET)
      .update(body)
      .digest("hex");

    const response = await request(app)
      .post("/test")
      .send({ test: "data" })
      .set("X-Webhook-Signature", signature);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it("should verify signature using timing-safe comparison", async () => {
    app.post("/test", webhookSignatureAuth, (req, res) => {
      res.json({ success: true });
    });

    const body = JSON.stringify({ test: "data" });
    const validSignature = crypto
      .createHmac("sha256", SECRET)
      .update(body)
      .digest("hex");

    // Off-by-one character change in signature
    const invalidSignature = validSignature.slice(0, -1) + (validSignature[validSignature.length - 1] === "0" ? "1" : "0");

    const response = await request(app)
      .post("/test")
      .send({ test: "data" })
      .set("X-Webhook-Signature", invalidSignature);

    expect(response.status).toBe(401);
  });

  it("should compute signature over the raw request body", async () => {
    app.post("/test", webhookSignatureAuth, (req, res) => {
      res.json({ success: true, received: req.body });
    });

    const testPayload = { url: "https://example.com/webhook", events: ["payment.received"] };
    const body = JSON.stringify(testPayload);
    const signature = crypto
      .createHmac("sha256", SECRET)
      .update(body)
      .digest("hex");

    const response = await request(app)
      .post("/test")
      .send(testPayload)
      .set("X-Webhook-Signature", signature);

    expect(response.status).toBe(200);
    expect(response.body.received).toEqual(testPayload);
  });

  it("should reject signature verification if lengths don't match", async () => {
    app.post("/test", webhookSignatureAuth, (req, res) => {
      res.json({ success: true });
    });

    // Signature that's too short
    const tooShortSignature = "abc123";

    const response = await request(app)
      .post("/test")
      .send({ test: "data" })
      .set("X-Webhook-Signature", tooShortSignature);

    expect(response.status).toBe(401);
    expect(response.body.error.message).toContain("Invalid");
  });

  it("should work with complex nested JSON payloads", async () => {
    app.post("/test", webhookSignatureAuth, (req, res) => {
      res.json({ success: true });
    });

    const complexPayload = {
      webhook: {
        url: "https://example.com/webhook",
        events: ["payment.received", "account_created"],
        metadata: {
          priority: "high",
          tags: ["production", "critical"]
        }
      }
    };

    const body = JSON.stringify(complexPayload);
    const signature = crypto
      .createHmac("sha256", SECRET)
      .update(body)
      .digest("hex");

    const response = await request(app)
      .post("/test")
      .send(complexPayload)
      .set("X-Webhook-Signature", signature);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});
