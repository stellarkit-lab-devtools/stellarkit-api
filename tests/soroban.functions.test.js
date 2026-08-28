const request = require("supertest");
const express = require("express");
const { xdr, Contract, StrKey } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    sorobanServer: {
      getLedgerEntries: jest.fn(),
    },
  };
});

const { sorobanServer } = require("../src/config/stellar");
const sorobanRouter = require("../src/routes/soroban");
const errorHandler = require("../src/middleware/errorHandler");
const cacheService = require("../src/services/cache");
const {
  parseFunctionsFromWasm,
  CONTRACT_SPEC_SECTION,
} = require("../src/utils/contractSpec");

function buildApp() {
  const app = express();
  app.use("/soroban", sorobanRouter);
  app.use(errorHandler);
  return app;
}

function encodeLeb128(value) {
  const bytes = [];
  let remaining = value >>> 0;
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining !== 0);
  return Buffer.from(bytes);
}

function buildWasmWithSpec(specBytes) {
  const name = Buffer.from(CONTRACT_SPEC_SECTION);
  const payload = Buffer.concat([encodeLeb128(name.length), name, specBytes || Buffer.alloc(0)]);
  const section = Buffer.concat([
    Buffer.from([0x00]),
    encodeLeb128(payload.length),
    payload,
  ]);
  const header = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  return Buffer.concat([header, section]);
}

function makeFunctionEntry(name, params, returnType) {
  const inputs = params.map(([paramName, type]) =>
    new xdr.ScSpecFunctionInputV0({
      doc: "",
      name: paramName,
      type,
    }),
  );

  return xdr.ScSpecEntry.scSpecEntryFunctionV0(
    new xdr.ScSpecFunctionV0({
      doc: "",
      name,
      inputs,
      outputs: returnType ? [returnType] : [],
    }),
  );
}

function buildInstanceEntry({ contractId, executableType = "wasm", wasmHash }) {
  const address = new Contract(contractId).address().toScAddress();
  const executable =
    executableType === "wasm"
      ? new xdr.ContractExecutable("contractExecutableWasm", wasmHash || Buffer.alloc(32, 1))
      : new xdr.ContractExecutable("contractExecutableStellarAsset", undefined);

  const instance = new xdr.ScContractInstance({
    executable,
    storage: null,
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

function mockLedgerEntries({ instance, wasmBytes }) {
  sorobanServer.getLedgerEntries.mockImplementation(async (key) => {
    const kind = key && typeof key.switch === "function" ? key.switch().name : "";
    if (kind === "contractCode") {
      if (!wasmBytes) return { entries: [] };
      return {
        entries: [
          {
            val: {
              contractCode: () => ({
                code: () => wasmBytes,
              }),
            },
          },
        ],
      };
    }

    return { entries: instance ? [instance] : [] };
  });
}

describe("GET /soroban/contract/:id/functions", () => {
  const app = buildApp();
  const contractId = StrKey.encodeContract(Buffer.alloc(32, 3));

  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
  });

  it("returns 404 when the contract does not exist", async () => {
    mockLedgerEntries({ instance: null });

    const res = await request(app).get(`/soroban/contract/${contractId}/functions`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ContractNotFound");
  });

  it("returns an empty functions array when the contract has no exported functions", async () => {
    mockLedgerEntries({
      instance: buildInstanceEntry({ contractId, executableType: "stellar_asset" }),
    });

    const res = await request(app).get(`/soroban/contract/${contractId}/functions`);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { functions: [] },
    });
  });

  it("returns multiple function signatures parsed from the contract ABI", async () => {
    const transfer = makeFunctionEntry(
      "transfer",
      [
        ["from", xdr.ScSpecTypeDef.scSpecTypeAddress()],
        ["to", xdr.ScSpecTypeDef.scSpecTypeAddress()],
        ["amount", xdr.ScSpecTypeDef.scSpecTypeI128()],
      ],
      xdr.ScSpecTypeDef.scSpecTypeVoid(),
    );
    const balance = makeFunctionEntry(
      "balance",
      [["id", xdr.ScSpecTypeDef.scSpecTypeAddress()]],
      xdr.ScSpecTypeDef.scSpecTypeI128(),
    );
    const wasmBytes = buildWasmWithSpec(
      Buffer.concat([transfer.toXDR(), balance.toXDR()]),
    );

    expect(parseFunctionsFromWasm(wasmBytes)).toHaveLength(2);

    mockLedgerEntries({
      instance: buildInstanceEntry({ contractId, executableType: "wasm" }),
      wasmBytes,
    });

    const res = await request(app).get(`/soroban/contract/${contractId}/functions`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.functions).toEqual([
      {
        name: "transfer",
        params: [
          { name: "from", type: "Address" },
          { name: "to", type: "Address" },
          { name: "amount", type: "I128" },
        ],
        returnType: "Void",
      },
      {
        name: "balance",
        params: [{ name: "id", type: "Address" }],
        returnType: "I128",
      },
    ]);
  });

  it("returns an empty functions array for WASM with no spec functions", async () => {
    mockLedgerEntries({
      instance: buildInstanceEntry({ contractId, executableType: "wasm" }),
      wasmBytes: buildWasmWithSpec(Buffer.alloc(0)),
    });

    const res = await request(app).get(`/soroban/contract/${contractId}/functions`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.functions).toEqual([]);
  });

  it("caches the response with a 60 second TTL", async () => {
    mockLedgerEntries({
      instance: buildInstanceEntry({ contractId, executableType: "stellar_asset" }),
    });

    const first = await request(app).get(`/soroban/contract/${contractId}/functions`);
    const second = await request(app).get(`/soroban/contract/${contractId}/functions`);

    expect(first.headers["x-cache"]).toBe("MISS");
    expect(second.headers["x-cache"]).toBe("HIT");
    expect(sorobanServer.getLedgerEntries).toHaveBeenCalledTimes(1);
    expect(second.body.data).toEqual(first.body.data);
  });

  it("validates the contract ID", async () => {
    const res = await request(app).get("/soroban/contract/NOT_A_CONTRACT/functions");

    expect(res.statusCode).toBe(400);
    expect(res.body.error.type).toBe("ValidationError");
    expect(sorobanServer.getLedgerEntries).not.toHaveBeenCalled();
  });
});
