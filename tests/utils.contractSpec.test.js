const { xdr } = require("@stellar/stellar-sdk");
const {
  extractCustomSection,
  parseFunctionsFromWasm,
  CONTRACT_SPEC_SECTION,
} = require("../src/utils/contractSpec");

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

describe("contractSpec WASM helpers", () => {
  it("extracts the contractspecv0 custom section", () => {
    const payload = Buffer.from("hello-spec");
    const wasm = buildWasmWithSpec(payload);
    expect(extractCustomSection(wasm, CONTRACT_SPEC_SECTION).toString()).toBe("hello-spec");
  });

  it("returns an empty function list when the WASM has no spec entries", () => {
    const wasm = buildWasmWithSpec(Buffer.alloc(0));
    expect(parseFunctionsFromWasm(wasm)).toEqual([]);
  });

  it("parses multiple exported functions from the ABI", () => {
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

    const specBytes = Buffer.concat([transfer.toXDR(), balance.toXDR()]);
    const wasm = buildWasmWithSpec(specBytes);
    const functions = parseFunctionsFromWasm(wasm);

    expect(functions).toEqual([
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
});
