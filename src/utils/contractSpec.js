const { xdr } = require("@stellar/stellar-sdk");

const CONTRACT_SPEC_SECTION = "contractspecv0";

const PRIMITIVE_TYPES = {
  scSpecTypeVal: "Val",
  scSpecTypeBool: "Bool",
  scSpecTypeVoid: "Void",
  scSpecTypeError: "Error",
  scSpecTypeU32: "U32",
  scSpecTypeI32: "I32",
  scSpecTypeU64: "U64",
  scSpecTypeI64: "I64",
  scSpecTypeTimepoint: "Timepoint",
  scSpecTypeDuration: "Duration",
  scSpecTypeU128: "U128",
  scSpecTypeI128: "I128",
  scSpecTypeU256: "U256",
  scSpecTypeI256: "I256",
  scSpecTypeBytes: "Bytes",
  scSpecTypeString: "String",
  scSpecTypeSymbol: "Symbol",
  scSpecTypeAddress: "Address",
  scSpecTypeMuxedAddress: "MuxedAddress",
};

/**
 * Decode an unsigned LEB128 integer from a buffer.
 * @returns {[number, number]} value and bytes consumed
 */
function readLeb128(buf, offset) {
  let result = 0;
  let shift = 0;
  let bytes = 0;

  while (offset + bytes < buf.length) {
    const byte = buf[offset + bytes];
    bytes += 1;
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }

  return [result, bytes];
}

/**
 * Extract a named custom section from a WASM binary.
 *
 * @param {Buffer|Uint8Array} wasmBytes
 * @param {string} sectionName
 * @returns {Buffer|null}
 */
function extractCustomSection(wasmBytes, sectionName) {
  const buf = Buffer.isBuffer(wasmBytes) ? wasmBytes : Buffer.from(wasmBytes);
  if (buf.length < 8) return null;

  const magic = buf.subarray(0, 4).toString("binary");
  if (magic !== "\0asm") return null;

  let offset = 8;
  while (offset < buf.length) {
    const sectionId = buf[offset];
    offset += 1;
    const [sectionLen, lenSize] = readLeb128(buf, offset);
    offset += lenSize;
    const payloadStart = offset;
    const payloadEnd = offset + sectionLen;

    if (payloadEnd > buf.length) return null;

    if (sectionId === 0) {
      const [nameLen, nameLenSize] = readLeb128(buf, payloadStart);
      const nameStart = payloadStart + nameLenSize;
      const nameEnd = nameStart + nameLen;
      const name = buf.subarray(nameStart, nameEnd).toString("utf8");
      if (name === sectionName) {
        return Buffer.from(buf.subarray(nameEnd, payloadEnd));
      }
    }

    offset = payloadEnd;
  }

  return null;
}

/**
 * Parse a concatenated XDR stream of ScSpecEntry values.
 *
 * @param {Buffer} buffer
 * @returns {import('@stellar/stellar-sdk').xdr.ScSpecEntry[]}
 */
function processSpecEntryStream(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const entries = [];

  try {
    const stellarSdk = require("@stellar/stellar-sdk");
    const cereal = stellarSdk.cereal;
    if (cereal && cereal.XdrReader && typeof xdr.ScSpecEntry.read === "function") {
      const reader = new cereal.XdrReader(buf);
      while (!reader.eof) {
        entries.push(xdr.ScSpecEntry.read(reader));
      }
      return entries;
    }
  } catch {
    // Fall through to length-prefixed consume.
  }

  let offset = 0;
  while (offset < buf.length) {
    const remaining = buf.subarray(offset);
    try {
      const entry = xdr.ScSpecEntry.fromXDR(remaining);
      const encoded = entry.toXDR();
      if (!encoded.length) break;
      entries.push(entry);
      offset += encoded.length;
    } catch {
      break;
    }
  }

  return entries;
}

/**
 * Convert an ScSpecTypeDef into a readable type string.
 *
 * @param {import('@stellar/stellar-sdk').xdr.ScSpecTypeDef} typeDef
 * @returns {string}
 */
function specTypeToString(typeDef) {
  if (!typeDef) return "Void";

  const kind = typeDef.switch().name;
  if (PRIMITIVE_TYPES[kind]) return PRIMITIVE_TYPES[kind];

  switch (kind) {
    case "scSpecTypeOption":
      return `Option<${specTypeToString(typeDef.option().valueType())}>`;
    case "scSpecTypeResult":
      return `Result<${specTypeToString(typeDef.result().okType())}, ${specTypeToString(typeDef.result().errorType())}>`;
    case "scSpecTypeVec":
      return `Vec<${specTypeToString(typeDef.vec().elementType())}>`;
    case "scSpecTypeMap":
      return `Map<${specTypeToString(typeDef.map().keyType())}, ${specTypeToString(typeDef.map().valueType())}>`;
    case "scSpecTypeTuple": {
      const parts = typeDef.tuple().valueTypes().map(specTypeToString);
      return `(${parts.join(", ")})`;
    }
    case "scSpecTypeBytesN":
      return `BytesN<${typeDef.bytesN().n()}>`;
    case "scSpecTypeUdt":
      return typeDef.udt().name().toString();
    default:
      return kind.replace(/^scSpecType/, "") || "Val";
  }
}

/**
 * Map an ScSpecFunctionV0 XDR value to the public API shape.
 *
 * @param {import('@stellar/stellar-sdk').xdr.ScSpecFunctionV0} fn
 * @returns {{ name: string, params: Array<{ name: string, type: string }>, returnType: string }}
 */
function mapFunction(fn) {
  const params = (fn.inputs() || []).map((input) => ({
    name: input.name().toString(),
    type: specTypeToString(input.type()),
  }));

  const outputs = fn.outputs() || [];
  let returnType = "Void";
  if (outputs.length === 1) {
    returnType = specTypeToString(outputs[0]);
  } else if (outputs.length > 1) {
    returnType = `(${outputs.map(specTypeToString).join(", ")})`;
  }

  return {
    name: fn.name().toString(),
    params,
    returnType,
  };
}

/**
 * Parse exported contract functions from a WASM binary's ABI (contractspecv0).
 *
 * @param {Buffer|Uint8Array} wasmBytes
 * @returns {Array<{ name: string, params: Array<{ name: string, type: string }>, returnType: string }>}
 */
function parseFunctionsFromWasm(wasmBytes) {
  if (!wasmBytes || !wasmBytes.length) return [];

  try {
    const { contract } = require("@stellar/stellar-sdk");
    if (contract && contract.Spec && typeof contract.Spec.fromWasm === "function") {
      try {
        const spec = contract.Spec.fromWasm(Buffer.from(wasmBytes));
        return spec.funcs().map(mapFunction);
      } catch (err) {
        if (/at least one entry/i.test(err.message || "")) return [];
      }
    }
  } catch {
    // Manual parse below.
  }

  const specBytes = extractCustomSection(wasmBytes, CONTRACT_SPEC_SECTION);
  if (!specBytes || specBytes.length === 0) return [];

  return processSpecEntryStream(specBytes)
    .filter((entry) => entry.switch().name === "scSpecEntryFunctionV0")
    .map((entry) => mapFunction(entry.functionV0()));
}

module.exports = {
  extractCustomSection,
  processSpecEntryStream,
  specTypeToString,
  mapFunction,
  parseFunctionsFromWasm,
  CONTRACT_SPEC_SECTION,
};
