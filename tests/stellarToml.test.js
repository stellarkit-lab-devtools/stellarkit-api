const request = require("supertest");
const app = require("../src/index");

const axios = require("axios");

describe("GET /stellar-toml", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns 400 when domain is missing", async () => {
    const res = await request(app).get("/stellar-toml");
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
  });

  it("returns 400 for an invalid domain", async () => {
    const res = await request(app).get("/stellar-toml/invalid_domain!");
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
  });

  it("returns 404 when stellar.toml is not found", async () => {
    jest.spyOn(axios, "get").mockRejectedValue({
      response: {
        status: 404,
        data: {},
      },
    });

    const res = await request(app).get("/stellar-toml/example.com");
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toContain("stellar.toml not found");
  });

  it("fetches and returns parsed TOML as structured JSON", async () => {
    const tomlText = `
VERSION="1.0.0"
NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"

[DOCUMENTATION]
ORG_NAME="Example Org"
ORG_URL="https://example.com"
ORG_LOGO="https://example.com/logo.png"
ORG_DESCRIPTION="Example issuer"

[[CURRENCIES]]
code="TEST"
issuer="GTESTISSUER"
status="live"
name="Test Token"
desc="A sample currency"

[[VALIDATORS]]
alias="validator1"
host="validator1.example.com"
network_passphrase="Test SDF Network ; September 2015"
history="https://history.example.com"

[[ACCOUNTS]]
name="sample"
description="Sample account"
`;

    jest.spyOn(axios, "get").mockResolvedValue({
      data: tomlText,
    });

    const res = await request(app).get("/stellar-toml/example.com");

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.DOCUMENTATION).toEqual({
      ORG_NAME: "Example Org",
      ORG_URL: "https://example.com",
      ORG_LOGO: "https://example.com/logo.png",
      ORG_DESCRIPTION: "Example issuer",
    });
    expect(res.body.data.CURRENCIES).toEqual([
      {
        code: "TEST",
        issuer: "GTESTISSUER",
        status: "live",
        name: "Test Token",
        desc: "A sample currency",
      },
    ]);
    expect(res.body.data.VALIDATORS).toEqual([
      {
        alias: "validator1",
        host: "validator1.example.com",
        network_passphrase: "Test SDF Network ; September 2015",
        history: "https://history.example.com",
      },
    ]);
    expect(res.body.data.ACCOUNTS).toEqual([
      {
        name: "sample",
        description: "Sample account",
      },
    ]);
    expect(axios.get).toHaveBeenCalledWith(
      "https://example.com/.well-known/stellar.toml",
      expect.objectContaining({
        timeout: 5000,
        headers: expect.objectContaining({ "User-Agent": "StellarKit-API/1.0" }),
      })
    );
  });
});
