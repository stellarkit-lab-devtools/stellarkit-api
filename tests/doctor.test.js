const doctor = require("../scripts/doctor");
function snapshot() {
  return {
    nodeVersion: "v20.0.0", engines: { node: ">=18.0.0" }, envPresent: true,
    env: { STELLAR_NETWORK: "testnet", PORT: "3000" },
    horizon: { ok: true, data: { network_passphrase: "Test SDF Network ; September 2015" } },
    soroban: { ok: true, data: { result: { status: "healthy" } } },
    friendbot: { ok: true }, portFree: true,
    manifest: { dependencies: { example: "^1.0.0" } },
    lock: { packages: { "": { dependencies: { example: "^1.0.0" } }, "node_modules/example": { version: "1.0.1" } } },
    installed: { "node_modules/example": "1.0.1" },
  };
}
const branches = [
  ["checkNode", s => { s.nodeVersion = "v16.0.0"; }],
  ["checkEnv", s => { s.envPresent = false; }],
  ["checkEnv", s => { delete s.env.PORT; }],
  ["checkNetwork", s => { s.env.STELLAR_NETWORK = "invalid"; }],
  ["checkHorizon", s => { s.horizon.ok = false; }],
  ["checkHorizon", s => { s.horizon.data.network_passphrase = "wrong"; }],
  ["checkSoroban", s => { s.soroban.ok = false; }],
  ["checkSoroban", s => { s.soroban.data.result.status = "unhealthy"; }],
  ["checkPort", s => { s.portFree = false; }],
  ["checkPort", s => { s.env.PORT = "65536"; }],
  ["checkFriendbot", s => { s.friendbot.ok = false; }],
  ["checkDependencies", s => { s.installed = {}; }],
  ["checkDependencies", s => { s.installed["node_modules/example"] = "1.0.2"; }],
  ["checkDependencies", s => { s.manifest.dependencies.example = "^2.0.0"; }],
  ["checkDependencies", s => { s.lock = null; }],
];
test.each(branches)("%s covers pass and fail", (name, breakSnapshot) => {
  const input = snapshot();
  expect(doctor[name](input).status).toBe("PASS");
  breakSnapshot(input);
  const res = doctor[name](input);
  expect(res.status).toBe("FAIL");
  expect(res.fix).toEqual(expect.any(String));
  expect(res.fix).not.toMatch(/\n/);
});
test("mainnet skips Friendbot with a warning", () => {
  const input = snapshot(); input.env.STELLAR_NETWORK = "mainnet";
  expect(doctor.checkFriendbot(input).status).toBe("WARN");
});
test("summary and JSON output are stable", () => {
  const report = doctor.diagnose(snapshot());
  expect(report.summary).toEqual({ PASS: 8, WARN: 0, FAIL: 0 });
  expect(report.exitCode).toBe(0);
  expect(doctor.format(report)).toContain("Summary: 8 PASS, 0 WARN, 0 FAIL");
  expect(JSON.parse(doctor.format(report, true))).toEqual(report);
});
test.each([true, false])("main returns appropriate exit code when portFree=%s", async portFree => {
  const input = snapshot(); input.portFree = portFree;
  const write = jest.fn();
  const code = await doctor.main({ collectSnapshot: async () => input, write, json: true });
  expect(code).toBe(portFree ? 0 : 1);
  expect(JSON.parse(write.mock.calls[0][0]).exitCode).toBe(code);
});
