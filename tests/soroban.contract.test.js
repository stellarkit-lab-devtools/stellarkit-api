const request = require("supertest");
const { xdr, Contract, StrKey } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    sorobanServer: {
      getLedgerEntries: jest.fn(),
      getLatestLedger: jest.fn(),
      getContractData: jest.fn(),
    },
  };
});

jest.mock("../src/utils/contractDeployment", () => ({
  fetchContractDeployment: jest.fn(),
}));

const { sorobanServer } = require("../src/config/stellar");
const { fetchContractDeployment } = require("../src/utils/contractDeployment");
const app = require("../src/index");

function buildInstanceEntry({ contractId, executableType = "wasm", wasmHash, storageEntries = [] }) {
  const address = new Contract(contractId).address().toScAddress();
  const executable =
    executableType === "wasm"
      ? new xdr.ContractExecutable("contractExecutableWasm", wasmHash || Buffer.alloc(32, 1))
      : new xdr.ContractExecutable("contractExecutableStellarAsset", undefined);

  const instance = new xdr.ScContractInstance({
    executable,
    storage: storageEntries.length ? storageEntries : null,
  });

  const contractData = new xdr.ContractDataEntry({
    ext: new xdr.ExtensionPoint(0),
    contract: address,
    key: xdr.ScVal.scvLedgerKeyContractInstance(),
    durability: xdr.ContractDataDurability.persistent(),
    val: xdr.ScVal.scvContractInstance(instance),
  });

  return {
    lastModifiedLedgerSeq: 100,
    liveUntilLedgerSeq: 200,
    val: xdr.LedgerEntryData.contractData(contractData),
  };
}

function getContractDataResponseFromEntry(entry, contractId) {
  const contractData = entry.val.contractData();
  return {
    contractId,
    key: contractData.key(),
    durability: contractData.durability(),
    val: contractData.val(),
  };
}

describe("GET /soroban/contract/:id", () => {
  const contractId = StrKey.encodeContract(Buffer.alloc(32, 2));
  const deployer = "GAAZI4TCRTYY5OJHCTJC2A4Q4SY6CJWJH5IAJTGKIN2ER'LBNCVKOCCWN";
  const deployedAt = "2024-06-01T12:00:00.000Z";
  const deployedLedger = 42;

  beforeEach(() => {
    jest.clearAllMocks();
    sorobanServer.getLatestLedger.mockResolved({ sequence: 150 });
    fetchContractDeployment.mockResolved({
      deployer,
      deployedAt,
      deployedLedger,
    });
  });

  it("returns enriched wasm contract details with deployment metadata", async () => {
    const wasmHash = Buffer.alloc(32, 7);
    const entry = buildInstanceEntry({ contractId, executableType: "wasm", wasmHash });
    sorobanServer.getLedgerEntries.mockResolved({ entries: [entry] });
    sorobanServer.getContractData.mockResolved(getContractDataResponseFromEntry(entry, contractId));

    const res = await request(app).get(`/soroban/contract/${contractId}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({
      contractId,
      wasmHash: wasmHash.toString("hex"),
      deployer,
      deployedAt,
      deployedLedger,
      isExpired: false,
      executable: { type: "wasm", wasmHash: wasmHash.toString("hex") },
      lastModifiedLedger: 100,
      expiryLedger: 200,
    });
    expect(res.body.data.wasmHash).toHaveLength(64);
    expect(typeof res.body.data.deployedAt).toBe("string");
    expect(res.body.data.deployedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof res.body.data.isExpired).toBe("boolean");
    expect(typeof res.body.data.deployedLedger).toBe("number");
  });

  it("marks the contract as expired when the current ledger is past expiry", async () => {
    sorobanServer.getLatestLedger.mockResolved({ sequence: 250 });
    const entry = buildInstanceEntry({ contractId, executableType: "wasm" });
    sorobanServer.getLedgerEntries.mockResolved({ entries: [entry] });
    sorobanServer.getContractData.mockResolved(getContractDataResponseFromEntry(entry, contractId));

    const res = await request(app).get(`/soroban/contract/${contractId}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.isExpired).toBe(true);
  });

  it("returns normalized stellar_asset contract details", async () => {
    const entry = buildInstanceEntry({ contractId, executableType: "stellar_asset" });
    sorobanServer.getLedgerEntries.mockResolved({ entries: [entry] });
    sorobanServer.getContractData.mockResolved(getContractDataResponseFromEntry(entry, contractId));

    const res = await request(app).get(`/soroban/contract/${contractId}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.wasmHash).toBe(null);
    expect(res.body.data.executable).toEqual({ type: "stellar_asset", wasmHash: null });
    expect(res.body.data).toMatchObject({
      deployer,
      deployedAt,
      deployedLedger,
      isExpired: false,
    });
  });

  it("returns 404 when the contract is not found", async () => {
    sorobanServer.getLedgerEntries.mockResolved({ entries: [] });
    sorobanServer.getContractData.mockResolved(null);

    const res = await request(app).get(`/soroban/contract/${contractId}`);

    expect(res.statusCode).toBe(404);
    expect(res.body.error.type).toBe("ContractNotFound");
  });

  it("validates the contract ID", async () => {
    const res = await request(app).get("/soroban/contract/NOTA_CONTRACT");

    expect(res.statusCode).toBe(400);
    expect(res.body.error.type).toBe("ValidationError");
    expect(sorobanServer.getLedgerEntries).not.toHaveBeenCalled();
  });
});