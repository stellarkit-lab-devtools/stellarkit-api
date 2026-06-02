const request = require("supertest");
const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

describe("GET /stream/payments/:id — SSE Endpoint", () => {
  const VALID_KEY = "GBB67CMSCMGPROSFIVENXMRQ3KJWELDIUYITQI7YCKMSOPR2SNZB5NQ5";
  const INVALID_KEY = "not-a-stellar-key";
  const UNFUNDED_KEY = "GBSU4GKNZITFA3OVBBHOTS6EB4ZLXJ6FMDPCF67KU3FJV6LRYLZEYJ52";

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Validation", () => {
    it("returns 400 for an invalid Stellar key", async () => {
      const res = await request(app).get(`/stream/payments/${INVALID_KEY}`);
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("ValidationError");
      expect(res.headers["content-type"]).not.toContain("text/event-stream");
    });

    it("returns 404 when account does not exist", async () => {
      jest.spyOn(server, "loadAccount").mockRejectedValueOnce({
        response: { status: 404, data: { title: "Not Found" } },
      });

      const res = await request(app).get(`/stream/payments/${UNFUNDED_KEY}`);
      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe("NotFound");
    });
  });

  describe("SSE stream", () => {
    it("returns Content-Type: text/event-stream for valid account", async () => {
      jest.spyOn(server, "loadAccount").mockResolvedValueOnce({});
      jest.spyOn(server, "payments").mockReturnValue({
        forAccount: () => ({
          cursor: () => ({
            stream: ({ onerror }) => {
              setImmediate(() => onerror(new Error("end")));
              return () => {};
            },
          }),
        }),
      });

      const res = await request(app).get(`/stream/payments/${VALID_KEY}`);
      expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    });

    it("streams payment events with required fields", (done) => {
      const mockPayment = {
        type: "payment",
        amount: "50.0000000",
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        from: VALID_KEY,
        to: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        created_at: "2024-01-01T12:00:00Z",
      };

      jest.spyOn(server, "loadAccount").mockResolvedValueOnce({});
      jest.spyOn(server, "payments").mockReturnValue({
        forAccount: () => ({
          cursor: () => ({
            stream: ({ onmessage, onerror }) => {
              setImmediate(() => {
                onmessage(mockPayment);
                onerror(new Error("end"));
              });
              return () => {};
            },
          }),
        }),
      });

      const chunks = [];
      const req = request(app).get(`/stream/payments/${VALID_KEY}`);
      req.buffer(false);
      req.parse((res, callback) => {
        res.on("data", (chunk) => chunks.push(chunk.toString()));
        res.on("end", () => {
          const body = chunks.join("");
          const dataLines = body.split("\n").filter((l) => l.startsWith("data:"));
          expect(dataLines.length).toBeGreaterThan(0);
          const parsed = JSON.parse(dataLines[0].replace("data: ", ""));
          expect(parsed.type).toBe("payment");
          expect(parsed.amount).toBe("50.0000000");
          expect(parsed.assetCode).toBe("USDC");
          expect(parsed.from).toBe(VALID_KEY);
          expect(parsed.to).toBe("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
          expect(parsed.timestamp).toBe("2024-01-01T12:00:00Z");
          callback(null, {});
          done();
        });
      });
      req.end();
    });

    it("streams create_account events", (done) => {
      const mockOp = {
        type: "create_account",
        starting_balance: "1.0000000",
        asset_type: "native",
        funder: VALID_KEY,
        account: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        created_at: "2024-01-01T12:00:00Z",
      };

      jest.spyOn(server, "loadAccount").mockResolvedValueOnce({});
      jest.spyOn(server, "payments").mockReturnValue({
        forAccount: () => ({
          cursor: () => ({
            stream: ({ onmessage, onerror }) => {
              setImmediate(() => {
                onmessage(mockOp);
                onerror(new Error("end"));
              });
              return () => {};
            },
          }),
        }),
      });

      const chunks = [];
      const req = request(app).get(`/stream/payments/${VALID_KEY}`);
      req.buffer(false);
      req.parse((res, callback) => {
        res.on("data", (chunk) => chunks.push(chunk.toString()));
        res.on("end", () => {
          const body = chunks.join("");
          const dataLines = body.split("\n").filter((l) => l.startsWith("data:"));
          expect(dataLines.length).toBeGreaterThan(0);
          const parsed = JSON.parse(dataLines[0].replace("data: ", ""));
          expect(parsed.type).toBe("create_account");
          expect(parsed.amount).toBe("1.0000000");
          expect(parsed.assetCode).toBe("XLM");
          callback(null, {});
          done();
        });
      });
      req.end();
    });

    it("filters out non-payment operation types", (done) => {
      jest.spyOn(server, "loadAccount").mockResolvedValueOnce({});
      jest.spyOn(server, "payments").mockReturnValue({
        forAccount: () => ({
          cursor: () => ({
            stream: ({ onmessage, onerror }) => {
              setImmediate(() => {
                // This should be filtered out
                onmessage({ type: "change_trust" });
                onerror(new Error("end"));
              });
              return () => {};
            },
          }),
        }),
      });

      const chunks = [];
      const req = request(app).get(`/stream/payments/${VALID_KEY}`);
      req.buffer(false);
      req.parse((res, callback) => {
        res.on("data", (chunk) => chunks.push(chunk.toString()));
        res.on("end", () => {
          const body = chunks.join("");
          const dataLines = body.split("\n").filter((l) => l.startsWith("data:"));
          expect(dataLines.length).toBe(0);
          callback(null, {});
          done();
        });
      });
      req.end();
    });
  });
});
