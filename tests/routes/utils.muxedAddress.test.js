const express = require("express");
const request = require("supertest");
const { Keypair, MuxedAccount } = require("@stellar/stellar-sdk");
const app = express();
app.use(express.json());
app.use("/utils", require("../../src/routes/utils"));
app.use(require("../../src/middleware/errorHandler"));
const baseAccount = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey();
test.each(["0", "42", "9007199254740993", "18446744073709551615"])("round-trips ID %s through the SDK", async id => {
  const res = await request(app).post("/utils/muxed-address").send({ baseAccount, id });
  expect(res.status).toBe(200);
  expect(res.body.data).toMatchObject({ baseAccount, id });
  const decoded = MuxedAccount.fromAddress(res.body.data.muxedAddress, "0");
  expect(decoded.baseAccount().accountId()).toBe(baseAccount);
  expect(decoded.id()).toBe(id);
});
test.each(["18446744073709551616", 42, 9007199254740992, "-1", "1.5", "", null])("rejects invalid ID %s", async id => {
  expect((await request(app).post("/utils/muxed-address").send({ baseAccount, id })).status).toBe(400);
});
test("rejects invalid base accounts", async () => {
  const res = await request(app).post("/utils/muxed-address").send({ baseAccount: "invalid", id: "1" });
  expect(res.status).toBe(400);
  expect(res.body.error.type).toBe("InvalidAccountId");
});
