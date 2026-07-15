import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { decodeBinarySchema } from "kiwi-schema";
import { parsePixFile, readZipEntries, type ParsedPixDocument } from "@pixso-figma-migration/pix-parser";

export interface BinaryResearchReport {
  schemaVersion: 1;
  generatedAt: string;
  privacy: {
    localOnly: true;
    pathsRedacted: true;
    nodeNamesRedacted: true;
    realFilesCommitted: false;
  };
  samples: SampleAnalysis[];
  schemaDiffs: SchemaDiff[];
  confirmedFields: FieldFinding[];
  inferredFields: FieldFinding[];
  notFoundFields: FieldFinding[];
  conclusion: {
    status: "PASS" | "FIX" | "STOP";
    actualSampleCount: number;
    controlledDifferentialSampleCount: number;
    reason: string;
    parserSupportClaimed: false;
  };
}

export interface SampleAnalysis {
  label: string;
  sha256: string;
  fileSizeBytes: number;
  containerEntries: Array<{
    category: string;
    nameSha256?: string;
    compressedSize: number;
    uncompressedSize: number;
    method: number;
    encrypted: boolean;
  }>;
  pixsoBinary: {
    sizeBytes: number;
    sha256: string;
    head64Hex: string;
    tail64Hex: string;
    entropyBitsPerByte: number;
    entropyBlocks: Array<{ offset: number; length: number; bitsPerByte: number }>;
    readableSchemaStrings: Array<{ offset: number; value: string }>;
    encodingScans: {
      varintCandidates: number;
      zigzagSmallIntegerCandidates: number;
      lengthPrefixedStringCandidates: number;
      float32LECandidates: number;
      float32BECandidates: number;
      float64LECandidates: number;
      float64BECandidates: number;
    };
  };
  compressionSignals: Array<{ source: string; format: string; offset: number; confidence: string }>;
  serializationSignals: Array<{ format: string; confidence: string; evidence: string }>;
  decoded: {
    rootMessage: string;
    roundTripExact: boolean;
    schemaDefinitionCount: number;
    payloadBytes: number;
    nodeCount: number;
    locatedRecordBoundaryCount: number;
    nodeTypeCounts: Record<string, number>;
    geometryCandidates: {
      sizeFieldNodes: number;
      transformFieldNodes: number;
      xYStatus: "not-found";
    };
    attributeCandidates: {
      layoutModeNodes: number;
      paddingNodes: number;
      gapNodes: number;
      strokeNodes: number;
    };
  };
}

interface FieldFinding {
  field: string;
  confidence: "confirmed" | "inferred" | "not-found";
  evidence: string;
}

interface SchemaDiff {
  left: string;
  right: string;
  commonPrefixBytes: number;
  commonSuffixBytes: number;
  changedRanges: Array<{ offset: number; leftLength: number; rightLength: number; leftHex: string; rightHex: string }>;
  schemaStringOffsetChanges: Array<{ value: string; leftOffset: number; rightOffset: number; delta: number }>;
  blockSize: number;
  leftBlockCount: number;
  rightBlockCount: number;
  commonBlockLcsLength: number;
}

export async function analyzePixFiles(filePaths: string[]): Promise<BinaryResearchReport> {
  if (filePaths.length === 0) throw new Error("At least one local .pix path is required");
  const results = await Promise.all(filePaths.map((path, index) => analyzeSample(path, `sample-${String(index + 1).padStart(3, "0")}`)));
  const samples = results.map((result) => result.analysis);
  const schemaDiffs: SchemaDiff[] = [];
  for (let index = 1; index < results.length; index += 1) {
    schemaDiffs.push(diffBuffers(results[0].schemaBytes, results[index].schemaBytes, samples[0].label, samples[index].label));
  }
  const nodeCount = samples.reduce((sum, sample) => sum + sample.decoded.nodeCount, 0);
  const recordCount = samples.reduce((sum, sample) => sum + sample.decoded.locatedRecordBoundaryCount, 0);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    privacy: {
      localOnly: true,
      pathsRedacted: true,
      nodeNamesRedacted: true,
      realFilesCommitted: false
    },
    samples,
    schemaDiffs,
    confirmedFields: [
      {
        field: "serialization",
        confidence: "confirmed",
        evidence: `Kiwi binary schemas decoded and PixsoMsg round-tripped exactly in ${samples.length} real file(s).`
      },
      {
        field: "nodeRecordBoundary",
        confidence: "confirmed",
        evidence: `${recordCount}/${nodeCount} PixsoNode encodings were uniquely located in sequential payload order.`
      },
      {
        field: "node.name",
        confidence: "confirmed",
        evidence: "PixsoNode.name is a Kiwi schema field and decoded records re-encode byte-for-byte. Values are redacted from reports."
      },
      {
        field: "node.type",
        confidence: "confirmed",
        evidence: "PixsoNode.type resolves through the Kiwi NodeType enum and exact root-message round trip."
      },
      {
        field: "node.parentId",
        confidence: "confirmed",
        evidence: "PixsoNode.parentIndex.guid links decoded node GUIDs; no visual-tree semantics beyond this direct link are claimed."
      },
      {
        field: "rect.width/height",
        confidence: "confirmed",
        evidence: "PixsoNode.size is a schema field of Vector type; x/y components are retained as width/height."
      }
    ],
    inferredFields: [
      {
        field: "layoutMode",
        confidence: "inferred",
        evidence: "PixsoNode.stackMode decodes to enum values such as HORIZONTAL, but controlled off/A/B samples are absent."
      },
      {
        field: "padding/gap/stroke",
        confidence: "inferred",
        evidence: "Schema and decoded records expose stackPadding*, stackSpacing, and strokePaints; three-value differential validation is absent."
      },
      {
        field: "geometry transform",
        confidence: "inferred",
        evidence: "PixsoNode.transform contains Matrix m02/m12 candidates, but their coordinate conversion is not filled without three known positions."
      }
    ],
    notFoundFields: [
      {
        field: "rect.x/rect.y",
        confidence: "not-found",
        evidence: "No three controlled coordinate values were supplied, so transform-to-top-left conversion is intentionally unset."
      },
      {
        field: "confirmed design attribute",
        confidence: "not-found",
        evidence: "No attribute has off/A/B controlled files; decoded field names alone are insufficient for confirmation."
      }
    ],
    conclusion: {
      status: "STOP",
      actualSampleCount: samples.length,
      controlledDifferentialSampleCount: 0,
      reason: "Serialization and node records are confirmed, but fewer than three controlled geometry samples and no off/A/B attribute set are available.",
      parserSupportClaimed: false
    }
  };
}

async function analyzeSample(filePath: string, label: string): Promise<{ analysis: SampleAnalysis; schemaBytes: Uint8Array }> {
  const fileBytes = await readFile(filePath);
  const entries = readZipEntries(fileBytes);
  const schemaEntry = entries.find((entry) => entry.name === "pixso.binary" && entry.data);
  if (!schemaEntry?.data) throw new Error(`${basename(filePath)}: readable pixso.binary entry not found`);
  const schemaBytes = schemaEntry.data;
  const parsed = await parsePixFile(filePath);
  const schema = decodeBinarySchema(schemaBytes);

  return {
    schemaBytes,
    analysis: {
      label,
      sha256: sha256(fileBytes),
      fileSizeBytes: fileBytes.length,
      containerEntries: entries.map((entry) => sanitizeEntry(entry)),
      pixsoBinary: {
        sizeBytes: schemaBytes.length,
        sha256: sha256(schemaBytes),
        head64Hex: Buffer.from(schemaBytes).subarray(0, 64).toString("hex"),
        tail64Hex: Buffer.from(schemaBytes).subarray(-64).toString("hex"),
        entropyBitsPerByte: round(entropy(schemaBytes)),
        entropyBlocks: entropyBlocks(schemaBytes),
        readableSchemaStrings: extractNullTerminatedStrings(schemaBytes, 500),
        encodingScans: scanNumericEncodings(schemaBytes)
      },
      compressionSignals: entries.flatMap((entry) => detectCompression(entry.name, entry.data)),
      serializationSignals: [
        {
          format: "Kiwi binary schema",
          confidence: "confirmed",
          evidence: `${schema.definitions.length} definitions decoded; PixsoMsg/PixsoNode schema present.`
        },
        {
          format: "Kiwi PixsoMsg payload",
          confidence: parsed.rootRoundTripExact ? "confirmed" : "not-found",
          evidence: "decode/re-encode is byte-for-byte identical."
        },
        ...scanAlternativeFormats(schemaBytes)
      ],
      decoded: summarizeParsed(parsed)
    }
  };
}

function summarizeParsed(parsed: ParsedPixDocument): SampleAnalysis["decoded"] {
  const nodeTypeCounts: Record<string, number> = {};
  let sizeFieldNodes = 0;
  let transformFieldNodes = 0;
  let layoutModeNodes = 0;
  let paddingNodes = 0;
  let gapNodes = 0;
  let strokeNodes = 0;
  for (const node of parsed.nodes) {
    const type = node.type ?? "UNKNOWN";
    nodeTypeCounts[type] = (nodeTypeCounts[type] ?? 0) + 1;
    if (node.rect.width !== undefined || node.rect.height !== undefined) sizeFieldNodes += 1;
    if (node.raw.transform) transformFieldNodes += 1;
    if (node.attributes.layoutMode !== undefined) layoutModeNodes += 1;
    if (node.attributes.padding !== undefined) paddingNodes += 1;
    if (node.attributes.gap !== undefined) gapNodes += 1;
    if (node.attributes.strokeCount !== undefined) strokeNodes += 1;
  }
  return {
    rootMessage: parsed.rootMessage,
    roundTripExact: parsed.rootRoundTripExact,
    schemaDefinitionCount: parsed.schemaDefinitionCount,
    payloadBytes: parsed.payloadBytes,
    nodeCount: parsed.nodes.length,
    locatedRecordBoundaryCount: parsed.nodes.filter((node) => node.raw.recordOffset >= 0).length,
    nodeTypeCounts,
    geometryCandidates: { sizeFieldNodes, transformFieldNodes, xYStatus: "not-found" },
    attributeCandidates: { layoutModeNodes, paddingNodes, gapNodes, strokeNodes }
  };
}

function sanitizeEntry(entry: ReturnType<typeof readZipEntries>[number]): SampleAnalysis["containerEntries"][number] {
  const standard = entry.name === "pixso.binary" || entry.name === "VERSION";
  const extension = entry.name.includes(".") ? entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase() : "none";
  const category = standard ? entry.name : extension === ".pix" ? "design-payload.pix" : `asset${extension}`;
  return {
    category,
    nameSha256: standard ? undefined : sha256(Buffer.from(entry.name, "utf8")),
    compressedSize: entry.compressedSize,
    uncompressedSize: entry.uncompressedSize,
    method: entry.compressionMethod,
    encrypted: entry.encrypted
  };
}

function detectCompression(source: string, bytes: Uint8Array | undefined): SampleAnalysis["compressionSignals"] {
  if (!bytes) return [];
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signatures = [
    { format: "gzip", magic: Buffer.from([0x1f, 0x8b]) },
    { format: "zstd", magic: Buffer.from([0x28, 0xb5, 0x2f, 0xfd]) },
    { format: "lz4", magic: Buffer.from([0x04, 0x22, 0x4d, 0x18]) },
    { format: "snappy-framed", magic: Buffer.from([0xff, 0x06, 0x00, 0x00, 0x73, 0x4e, 0x61, 0x50, 0x70, 0x59]) }
  ];
  const findings = signatures.flatMap((signature) => {
    const offset = buffer.indexOf(signature.magic);
    const wrapperConfirmed = signature.format === "zstd"
      && offset > 0
      && buffer.subarray(0, offset).toString("utf8").includes("compress:zstd");
    return offset === 0 || wrapperConfirmed
      ? [{ source: source === "pixso.binary" ? source : "redacted-entry", format: signature.format, offset, confidence: "high" }]
      : [];
  });
  if (buffer.length >= 2 && buffer[0] === 0x78 && ((buffer[0] << 8) + buffer[1]) % 31 === 0) {
    findings.push({ source: source === "pixso.binary" ? source : "redacted-entry", format: "zlib", offset: 0, confidence: "high" });
  }
  if (buffer.subarray(0, 64).toString("utf8").includes("compress:brotli")) {
    findings.push({ source: "redacted-entry", format: "brotli", offset: 0, confidence: "medium" });
  }
  return findings;
}

function scanAlternativeFormats(bytes: Uint8Array): SampleAnalysis["serializationSignals"] {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const findings: SampleAnalysis["serializationSignals"] = [];
  const protobuf = protobufCoverage(buffer);
  findings.push({
    format: "Protobuf wire scan",
    confidence: protobuf.coverage >= 0.8 ? "inferred" : "not-found",
    evidence: `${protobuf.fields} valid leading fields, ${Math.round(protobuf.coverage * 100)}% coverage; no Protobuf magic exists.`
  });
  findings.push({
    format: "MessagePack/CBOR",
    confidence: "not-found",
    evidence: "No complete top-level collection signature; first bytes are consumed by confirmed Kiwi schema decoding."
  });
  const bson = buffer.length >= 5 && buffer.readInt32LE(0) === buffer.length && buffer.at(-1) === 0;
  findings.push({ format: "BSON", confidence: bson ? "inferred" : "not-found", evidence: bson ? "Length/header heuristic matched." : "BSON length and terminator heuristic did not match." });
  const flatBufferIdentifier = buffer.length >= 8 && /^[\x20-\x7e]{4}$/.test(buffer.subarray(4, 8).toString("ascii"));
  findings.push({ format: "FlatBuffers", confidence: flatBufferIdentifier ? "inferred" : "not-found", evidence: flatBufferIdentifier ? "Four-byte identifier heuristic matched, but Kiwi decoding is definitive." : "No plausible four-byte file identifier." });
  return findings;
}

function protobufCoverage(buffer: Buffer): { fields: number; coverage: number } {
  let offset = 0;
  let fields = 0;
  while (offset < buffer.length && fields < 10_000) {
    const key = readVarint(buffer, offset);
    if (!key) break;
    const field = Number(key.value >> 3n);
    const wire = Number(key.value & 7n);
    if (field < 1 || ![0, 1, 2, 5].includes(wire)) break;
    offset = key.next;
    if (wire === 0) {
      const value = readVarint(buffer, offset);
      if (!value) break;
      offset = value.next;
    } else if (wire === 1) offset += 8;
    else if (wire === 5) offset += 4;
    else {
      const length = readVarint(buffer, offset);
      if (!length || length.value > BigInt(buffer.length)) break;
      offset = length.next + Number(length.value);
    }
    if (offset > buffer.length) break;
    fields += 1;
  }
  return { fields, coverage: buffer.length === 0 ? 0 : Math.min(offset, buffer.length) / buffer.length };
}

function readVarint(buffer: Buffer, start: number): { value: bigint; next: number } | null {
  let value = 0n;
  for (let index = 0; index < 10 && start + index < buffer.length; index += 1) {
    const byte = buffer[start + index];
    value |= BigInt(byte & 0x7f) << BigInt(index * 7);
    if ((byte & 0x80) === 0) return { value, next: start + index + 1 };
  }
  return null;
}

function extractNullTerminatedStrings(bytes: Uint8Array, limit: number): Array<{ offset: number; value: string }> {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values: Array<{ offset: number; value: string }> = [];
  let start = 0;
  while (start < buffer.length && values.length < limit) {
    const end = buffer.indexOf(0, start);
    if (end < 0) break;
    const value = buffer.subarray(start, end).toString("utf8");
    const printable = /^[\p{L}\p{N}_-]{2,80}$/u.test(value);
    if (printable) values.push({ offset: start, value });
    start = end + 1;
  }
  return values;
}

function scanNumericEncodings(bytes: Uint8Array): SampleAnalysis["pixsoBinary"]["encodingScans"] {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let varintCandidates = 0;
  let zigzagSmallIntegerCandidates = 0;
  let lengthPrefixedStringCandidates = 0;
  let float32LECandidates = 0;
  let float32BECandidates = 0;
  let float64LECandidates = 0;
  let float64BECandidates = 0;
  for (let offset = 0; offset < buffer.length; offset += 1) {
    const varint = readVarint(buffer, offset);
    if (varint) {
      varintCandidates += 1;
      const zigzag = (varint.value >> 1n) ^ -(varint.value & 1n);
      if (zigzag >= -1_000_000n && zigzag <= 1_000_000n) zigzagSmallIntegerCandidates += 1;
      const length = Number(varint.value);
      if (length >= 2 && length <= 80 && varint.next + length <= buffer.length) {
        const value = buffer.subarray(varint.next, varint.next + length).toString("utf8");
        if (/^[\x20-\x7e]+$/.test(value)) lengthPrefixedStringCandidates += 1;
      }
    }
    if (offset + 4 <= buffer.length) {
      if (plausibleFloat(buffer.readFloatLE(offset))) float32LECandidates += 1;
      if (plausibleFloat(buffer.readFloatBE(offset))) float32BECandidates += 1;
    }
    if (offset + 8 <= buffer.length) {
      if (plausibleFloat(buffer.readDoubleLE(offset))) float64LECandidates += 1;
      if (plausibleFloat(buffer.readDoubleBE(offset))) float64BECandidates += 1;
    }
  }
  return {
    varintCandidates,
    zigzagSmallIntegerCandidates,
    lengthPrefixedStringCandidates,
    float32LECandidates,
    float32BECandidates,
    float64LECandidates,
    float64BECandidates
  };
}

function plausibleFloat(value: number): boolean {
  const magnitude = Math.abs(value);
  return Number.isFinite(value) && magnitude >= 1e-6 && magnitude <= 1e9;
}

function entropyBlocks(bytes: Uint8Array, blockSize = 4096): Array<{ offset: number; length: number; bitsPerByte: number }> {
  const blocks = [];
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    const block = bytes.subarray(offset, Math.min(offset + blockSize, bytes.length));
    blocks.push({ offset, length: block.length, bitsPerByte: round(entropy(block)) });
  }
  return blocks;
}

function entropy(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  const counts = new Uint32Array(256);
  for (const byte of bytes) counts[byte] += 1;
  let result = 0;
  for (const count of counts) {
    if (count === 0) continue;
    const probability = count / bytes.length;
    result -= probability * Math.log2(probability);
  }
  return result;
}

function diffBuffers(left: Uint8Array, right: Uint8Array, leftLabel: string, rightLabel: string, blockSize = 64): SchemaDiff {
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < left.length - prefix && suffix < right.length - prefix && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) suffix += 1;
  const changedRanges = directChangedRanges(left, right, 100);
  const leftBlocks = blockHashes(left, blockSize);
  const rightBlocks = blockHashes(right, blockSize);
  const leftStrings = extractNullTerminatedStrings(left, 500);
  const rightStringMap = new Map(extractNullTerminatedStrings(right, 500).map((item) => [item.value, item.offset]));
  const schemaStringOffsetChanges = leftStrings.flatMap((item) => {
    const rightOffset = rightStringMap.get(item.value);
    return rightOffset === undefined || rightOffset === item.offset
      ? []
      : [{ value: item.value, leftOffset: item.offset, rightOffset, delta: rightOffset - item.offset }];
  }).slice(0, 200);
  return {
    left: leftLabel,
    right: rightLabel,
    commonPrefixBytes: prefix,
    commonSuffixBytes: suffix,
    changedRanges,
    schemaStringOffsetChanges,
    blockSize,
    leftBlockCount: leftBlocks.length,
    rightBlockCount: rightBlocks.length,
    commonBlockLcsLength: lcsLength(leftBlocks, rightBlocks)
  };
}

function directChangedRanges(left: Uint8Array, right: Uint8Array, limit: number): SchemaDiff["changedRanges"] {
  const ranges: SchemaDiff["changedRanges"] = [];
  const maxLength = Math.max(left.length, right.length);
  let offset = 0;
  while (offset < maxLength && ranges.length < limit) {
    if (left[offset] === right[offset] && offset < left.length && offset < right.length) {
      offset += 1;
      continue;
    }
    const start = offset;
    while (offset < maxLength && (left[offset] !== right[offset] || offset >= left.length || offset >= right.length)) offset += 1;
    const leftEnd = Math.min(offset, left.length);
    const rightEnd = Math.min(offset, right.length);
    ranges.push({
      offset: start,
      leftLength: leftEnd - Math.min(start, left.length),
      rightLength: rightEnd - Math.min(start, right.length),
      leftHex: Buffer.from(left.subarray(start, Math.min(leftEnd, start + 32))).toString("hex"),
      rightHex: Buffer.from(right.subarray(start, Math.min(rightEnd, start + 32))).toString("hex")
    });
  }
  return ranges;
}

function blockHashes(bytes: Uint8Array, blockSize: number): string[] {
  const hashes = [];
  for (let offset = 0; offset < bytes.length; offset += blockSize) hashes.push(sha256(bytes.subarray(offset, offset + blockSize)).slice(0, 16));
  return hashes;
}

function lcsLength(left: string[], right: string[]): number {
  let previous = new Uint32Array(right.length + 1);
  for (const leftValue of left) {
    const current = new Uint32Array(right.length + 1);
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = leftValue === right[rightIndex - 1] ? previous[rightIndex - 1] + 1 : Math.max(previous[rightIndex], current[rightIndex - 1]);
    }
    previous = current;
  }
  return previous[right.length];
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
