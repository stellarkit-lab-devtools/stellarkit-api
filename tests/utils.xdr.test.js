const request = require("supertest");
const app = require("../src/index");

describe("Utils XDR Decoder API", () => {
  // A simple test transaction XDR (Testnet)
  // This is a base64 encoded TransactionEnvelope XDR
  // Created with Stellar SDK v12.3.0
  const validXdr = "AAAAAgAAAAA1YmS1mXvUjD7Zq0L0m3i4XN6T8z7j8X7X8X7X8X7XAAAAZAAAAAMAAAABAAAAAAAAAAEAAAAA1YmS1mXvUjD7Zq0L0m3i4XN6T8z7j8X7X8X7X8X7XAAAAAAAAAAAK9lIAAAAAAAAAAAEAAAABAAAAADVibLWZe9SMPtmrQvSbeLhc3pPzPuPxfdfxfdfxfdfxAAAAF09yZG8AAAAAAAAAAQAAAAAAAAAAAAAAAA==";

  describe("POST /utils/decode-xdr", () => {
    it("successfully decodes a valid transaction XDR", async () => {
      // Create a valid XDR using the SDK to ensure it matches the expected format
      const { Asset, Keypair, TransactionBuilder, Networks, Operation, Account } = require("@stellar/stellar-sdk");
      const sourceKeypair = Keypair.random();
      const sourceAccount = new Account(sourceKeypair.publicKey(), "1");
      const dest = Keypair.random();
      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase: Networks.TESTNET
      })
      .addOperation(Operation.payment({
        destination: dest.publicKey(),
        asset: Asset.native(),
        amount: "10"
      }))
      .setTimeout(0)
      .build();
      
      const xdr = tx.toEnvelope().toXDR("base64");

      const res = await request(app)
        .post("/utils/decode-xdr")
        .send({ xdr });

      if (res.statusCode !== 200) {
        console.log("Error response:", res.body);
      }

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("sourceAccount");
      expect(res.body.data).toHaveProperty("fee");
      expect(res.body.data).toHaveProperty("sequenceNumber");
      expect(res.body.data).toHaveProperty("operations");
      expect(Array.isArray(res.body.data.operations)).toBe(true);
    });

    it("returns 400 for missing XDR in body", async () => {
      const res = await request(app)
        .post("/utils/decode-xdr")
        .send({});

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain("XDR string is required");
    });

    it("returns 400 for malformed XDR", async () => {
      const res = await request(app)
        .post("/utils/decode-xdr")
        .send({ xdr: "not-a-valid-xdr" });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain("Invalid or malformed XDR");
    });
  });
});
