const request = require("supertest");
const app = require("../src/index");
const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });
test("serves public required fields and a future expiry without authentication or rate limits", async () => {
  process.env.SECURITY_CONTACT = "mailto:security@example.com";
  process.env.REQUIRE_API_KEY = "true";
  for (let i = 0; i < 2; i++) {
    const res = await request(app).get("/.well-known/security.txt").set("Host", "api.example.com");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/plain/);
    expect(res.headers["ratelimit-limit"]).toBeUndefined();
    expect(res.text).toContain("Contact: mailto:security@example.com\n");
    expect(res.text).toContain("Preferred-Languages: en\n");
    expect(res.text).toContain("Canonical: http://api.example.com/.well-known/security.txt\n");
    expect(new Date(res.text.match(/^Expires: (.+)$/m)[1]).getTime()).toBeGreaterThan(Date.now());
  }
});
test("supports policy and expiry overrides", async () => {
  process.env.SECURITY_CONTACT = "mailto:security@example.com";
  process.env.SECURITY_TXT_EXPIRES = "2030-01-01T00:00:00Z";
  process.env.SECURITY_POLICY_URL = "https://example.com/security";
  const res = await request(app).get("/.well-known/security.txt");
  expect(res.text).toContain("Expires: 2030-01-01T00:00:00Z");
  expect(res.text).toContain("Policy: https://example.com/security");
});
test("returns 404 when unconfigured", async () => {
  delete process.env.SECURITY_CONTACT;
  process.env.REQUIRE_API_KEY = "true";
  expect((await request(app).get("/.well-known/security.txt")).status).toBe(404);
});
