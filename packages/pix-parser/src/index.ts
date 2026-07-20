import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { compileSchema, decodeBinarySchema, type Schema } from "kiwi-schema";
import { readZipEntries, type ZipEntry } from "./zip.js";

export type Confidence = "confirmed" | "inferred" | "not-found";

export interface ParsedPixNode {
  id?: string;
  name?: string;
  type?: string;
  parentId?: string | null;
  rect: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
  attributes: {
    layoutMode?: string;
    padding?: { top?: number; right?: number; bottom?: number; left?: number };
    stroke?: {
      weight?: number;
      align: string;
      paints: Array<{
        type?: string;
        color?: { r?: number; g?: number; b?: number; a?: number };
        opacity?: number;
        visible?: boolean;
        blendMode?: string;
      }>;
    };
  };
  raw: {
    recordOffset: number;
    recordLength: number;
    transform?: Record<string, number>;
    confidence: Confidence;
    fieldConfidence: Record<string, Confidence>;
    diagnostics: {
      gapCandidate?: number;
      paddingCandidate?: { top?: number; right?: number; bottom?: number; left?: number };
      computedAbsoluteX?: number;
      computedAbsoluteY?: number;
      coordinateCompositionStatus: "confirmed-translation-only" | "not-found";
      styleReference: "not-found";
      variableBinding: "not-found";
    };
  };
}

export interface ParsedPixDocument {
  serialization: "kiwi";
  compression: "zstd";
  coordinateModel: "local-transform";
  schemaDefinitionCount: number;
  rootMessage: "PixsoMsg";
  rootRoundTripExact: boolean;
  payloadEntry: string;
  payloadBytes: number;
  nodes: ParsedPixNode[];
  entries: ZipEntry[];
}

export interface DecodedPixResearchNode {
  recordOffset: number;
  recordLength: number;
  decoded: Record<string, unknown>;
}

export interface DecodedPixResearchDocument {
  serialization: "kiwi";
  compression: "zstd";
  schemaDefinitionCount: number;
  rootMessage: "PixsoMsg";
  rootRoundTripExact: boolean;
  payloadEntry: string;
  payloadBytes: number;
  nodes: DecodedPixResearchNode[];
  entries: ZipEntry[];
}

interface KiwiGuid {
  sessionID?: number;
  localID?: number;
}

interface KiwiNode {
  guid?: KiwiGuid;
  parentIndex?: { guid?: KiwiGuid };
  name?: string;
  type?: string;
  size?: { x?: number; y?: number };
  transform?: Record<string, number>;
  stackMode?: string;
  stackPaddingTop?: number;
  stackPaddingRight?: number;
  stackPaddingBottom?: number;
  stackPaddingLeft?: number;
  stackSpacing?: number;
  strokeWeight?: number;
  borderTopWeight?: number;
  borderRightWeight?: number;
  borderBottomWeight?: number;
  borderLeftWeight?: number;
  strokeAlign?: string;
  strokePaints?: KiwiPaint[];
}

interface KiwiPaint {
  type?: string;
  color?: { r?: number; g?: number; b?: number; a?: number };
  opacity?: number;
  visible?: boolean;
  blendMode?: string;
}

interface KiwiMessage {
  pixsoNodes?: KiwiNode[];
}

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const MAX_DECOMPRESSED_BYTES = 512 * 1024 * 1024;

export async function parsePixFile(filePath: string): Promise<ParsedPixDocument> {
  const source = await readPixSource(filePath);
  return parsePixBuffers(source.schemaBytes, source.payloadEntryName, source.wrappedPayload, source.entries);
}

export async function decodePixFileForResearch(filePath: string): Promise<DecodedPixResearchDocument> {
  const source = await readPixSource(filePath);
  const payload = decompressWrappedPayload(source.wrappedPayload);
  const decoded = decodePayload(source.schemaBytes, payload);
  return {
    serialization: "kiwi",
    compression: "zstd",
    schemaDefinitionCount: decoded.schema.definitions.length,
    rootMessage: "PixsoMsg",
    rootRoundTripExact: decoded.rootRoundTripExact,
    payloadEntry: source.payloadEntryName,
    payloadBytes: decoded.payloadBuffer.length,
    nodes: decoded.sourceNodes.map((node, index) => ({
      recordOffset: decoded.recordBoundaries[index]!.recordOffset,
      recordLength: decoded.recordBoundaries[index]!.recordLength,
      decoded: node as Record<string, unknown>
    })),
    entries: source.entries
  };
}

async function readPixSource(filePath: string): Promise<{
  schemaBytes: Uint8Array;
  payloadEntryName: string;
  wrappedPayload: Uint8Array;
  entries: ZipEntry[];
}> {
  const fileBytes = await readFile(filePath);
  const entries = readZipEntries(fileBytes);
  if (entries.some((entry) => entry.encrypted)) throw new Error("Encrypted ZIP entries are not supported");
  const schemaEntry = entries.find((entry) => entry.name === "pixso.binary" && entry.data);
  if (!schemaEntry?.data) throw new Error("pixso.binary entry not found or not readable");
  const payloadEntry = entries.find(
    (entry) => entry.name.toLowerCase().endsWith(".pix") && entry.name !== "pixso.binary" && entry.data
  );
  if (!payloadEntry?.data) throw new Error("Nested .pix payload entry not found or not readable");
  return {
    schemaBytes: schemaEntry.data,
    payloadEntryName: payloadEntry.name,
    wrappedPayload: payloadEntry.data,
    entries
  };
}

export function parsePixBuffers(
  schemaBytes: Uint8Array,
  payloadEntryName: string,
  wrappedPayload: Uint8Array,
  entries: ZipEntry[] = []
): ParsedPixDocument {
  const payload = decompressWrappedPayload(wrappedPayload);
  return parseDecodedPixsoPayload(schemaBytes, payloadEntryName, payload, entries);
}

export function parseDecodedPixsoPayload(
  schemaBytes: Uint8Array,
  payloadEntryName: string,
  payload: Uint8Array,
  entries: ZipEntry[] = []
): ParsedPixDocument {
  const decodedPayload = decodePayload(schemaBytes, payload);
  const nodes = decodedPayload.sourceNodes.map((node, index) => {
    const boundary = decodedPayload.recordBoundaries[index]!;
    return mapNode(node, boundary.recordOffset, boundary.recordLength);
  });
  applyTranslationComposition(nodes);

  return {
    serialization: "kiwi",
    compression: "zstd",
    coordinateModel: "local-transform",
    schemaDefinitionCount: decodedPayload.schema.definitions.length,
    rootMessage: "PixsoMsg",
    rootRoundTripExact: true,
    payloadEntry: payloadEntryName,
    payloadBytes: decodedPayload.payloadBuffer.length,
    nodes,
    entries
  };
}

function decodePayload(
  schemaBytes: Uint8Array,
  payload: Uint8Array
): {
  schema: Schema;
  payloadBuffer: Buffer;
  sourceNodes: KiwiNode[];
  recordBoundaries: Array<{ recordOffset: number; recordLength: number }>;
  rootRoundTripExact: boolean;
} {
  const schema = decodeBinarySchema(schemaBytes);
  validatePixsoSchema(schema);
  const payloadBuffer = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
  const compiled = compileSchema(schema);
  const decoded = compiled.decodePixsoMsg(payloadBuffer) as KiwiMessage;
  const roundTrip = Buffer.from(compiled.encodePixsoMsg(decoded) as Uint8Array);
  const exact = roundTrip.equals(payloadBuffer);
  if (!exact) throw new Error("PixsoMsg decode/re-encode did not reproduce the payload exactly");
  const sourceNodes = decoded.pixsoNodes;
  if (!Array.isArray(sourceNodes)) throw new Error("PixsoMsg.pixsoNodes is not an array");

  let searchOffset = 0;
  const recordBoundaries = sourceNodes.map((node) => {
    const encoded = Buffer.from(compiled.encodePixsoNode(node) as Uint8Array);
    const recordOffset = payloadBuffer.indexOf(encoded, searchOffset);
    if (recordOffset < 0) throw new Error("Unable to locate an encoded PixsoNode record boundary");
    searchOffset = recordOffset + encoded.length;
    return { recordOffset, recordLength: encoded.length };
  });
  return { schema, payloadBuffer, sourceNodes, recordBoundaries, rootRoundTripExact: exact };
}

function validatePixsoSchema(schema: Schema): void {
  const pixsoMsg = schema.definitions.find((definition) => definition.name === "PixsoMsg");
  const pixsoNode = schema.definitions.find((definition) => definition.name === "PixsoNode");
  if (!pixsoMsg || pixsoMsg.kind !== "MESSAGE") throw new Error("Kiwi PixsoMsg definition not found");
  if (!pixsoNode || pixsoNode.kind !== "MESSAGE") throw new Error("Kiwi PixsoNode definition not found");
  const nodeField = pixsoMsg.fields.find((field) => field.name === "pixsoNodes");
  if (nodeField?.type !== "PixsoNode" || !nodeField.isArray) {
    throw new Error("PixsoMsg.pixsoNodes[] schema field not found");
  }
}

function decompressWrappedPayload(bytes: Uint8Array): Buffer {
  const wrapped = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const markerOffset = wrapped.indexOf(ZSTD_MAGIC);
  const header = wrapped.subarray(0, Math.max(markerOffset, 0)).toString("utf8");
  if (markerOffset < 0 || !header.includes("pixso-kw") || !header.includes("compress:zstd")) {
    throw new Error("Expected pixso-kw Zstandard wrapper was not found");
  }
  const result = spawnSync("zstd", ["-d", "-q", "-c"], {
    input: wrapped.subarray(markerOffset),
    maxBuffer: MAX_DECOMPRESSED_BYTES
  });
  if (result.error) throw new Error(`Unable to run zstd: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`zstd decompression failed: ${result.stderr.toString("utf8").trim()}`);
  return result.stdout;
}

function mapNode(node: KiwiNode, recordOffset: number, recordLength: number): ParsedPixNode {
  const id = guidToId(node.guid);
  const parentId = guidToId(node.parentIndex?.guid);
  const isRootParent = parentId === "0:0";
  const width = finiteNumber(node.size?.x);
  const height = finiteNumber(node.size?.y);
  const x = finiteNumber(node.transform?.m02);
  const y = finiteNumber(node.transform?.m12);
  const padding = {
    top: finiteNumber(node.stackPaddingTop),
    right: finiteNumber(node.stackPaddingRight),
    bottom: finiteNumber(node.stackPaddingBottom),
    left: finiteNumber(node.stackPaddingLeft)
  };
  const hasPaddingCandidate = Object.values(padding).some((value) => value !== undefined);
  const hasPadding = node.stackMode !== undefined && hasPaddingCandidate;
  const fieldConfidence: Record<string, Confidence> = {
    id: id === null ? "not-found" : "confirmed",
    name: typeof node.name === "string" ? "confirmed" : "not-found",
    type: typeof node.type === "string" ? "confirmed" : "not-found",
    parentId: parentId === null ? "not-found" : "confirmed",
    "rect.x": x === undefined ? "not-found" : "confirmed",
    "rect.y": y === undefined ? "not-found" : "confirmed",
    "rect.width": width === undefined ? "not-found" : "confirmed",
    "rect.height": height === undefined ? "not-found" : "confirmed",
    layoutMode: node.stackMode === undefined ? "not-found" : "confirmed",
    padding: hasPadding ? "confirmed" : "not-found",
    gap: node.stackSpacing === undefined ? "not-found" : "inferred",
    stroke: node.strokePaints === undefined ? "not-found" : "confirmed"
  };
  const borderWeights = [node.borderTopWeight, node.borderRightWeight, node.borderBottomWeight, node.borderLeftWeight]
    .map(finiteNumber);
  const uniformBorderWeight = borderWeights.every((value) => value !== undefined && value === borderWeights[0])
    ? borderWeights[0]
    : undefined;
  const stroke = node.strokePaints === undefined ? undefined : {
    weight: finiteNumber(node.strokeWeight) ?? uniformBorderWeight,
    align: node.strokeAlign ?? "INSIDE",
    paints: node.strokePaints.map((paint) => ({
      type: paint.type,
      color: paint.color,
      opacity: finiteNumber(paint.opacity),
      visible: paint.visible,
      blendMode: paint.blendMode
    }))
  };
  return {
    id: id ?? undefined,
    name: node.name,
    type: node.type,
    parentId: parentId === null ? undefined : isRootParent ? null : parentId,
    rect: { x, y, width, height },
    attributes: {
      layoutMode: node.stackMode,
      padding: hasPadding ? padding : undefined,
      stroke
    },
    raw: {
      recordOffset,
      recordLength,
      transform: node.transform,
      confidence: "confirmed",
      fieldConfidence,
      diagnostics: {
        gapCandidate: finiteNumber(node.stackSpacing),
        paddingCandidate: hasPaddingCandidate ? padding : undefined,
        coordinateCompositionStatus: "not-found",
        styleReference: "not-found",
        variableBinding: "not-found"
      }
    }
  };
}

function applyTranslationComposition(nodes: ParsedPixNode[]): void {
  const byId = new Map(nodes.flatMap((node) => node.id ? [[node.id, node] as const] : []));
  const cache = new Map<string, { x: number; y: number } | null>();

  const compute = (node: ParsedPixNode, visiting: Set<string>): { x: number; y: number } | null => {
    if (!node.id) return null;
    const cached = cache.get(node.id);
    if (cached !== undefined) return cached;
    if (visiting.has(node.id)) return null;
    visiting.add(node.id);

    let result: { x: number; y: number } | null = null;
    if (isCanvasOrigin(node)) {
      result = { x: 0, y: 0 };
    } else if (isPureTranslation(node)) {
      const local = { x: node.rect.x!, y: node.rect.y! };
      if (node.parentId === null) {
        result = local;
      } else if (typeof node.parentId === "string") {
        const parent = byId.get(node.parentId);
        const parentPosition = parent ? compute(parent, visiting) : null;
        if (parentPosition) result = { x: parentPosition.x + local.x, y: parentPosition.y + local.y };
      }
    }

    visiting.delete(node.id);
    cache.set(node.id, result);
    return result;
  };

  for (const node of nodes) {
    const position = compute(node, new Set());
    if (!position || isCanvasOrigin(node)) continue;
    node.raw.diagnostics.computedAbsoluteX = position.x;
    node.raw.diagnostics.computedAbsoluteY = position.y;
    node.raw.diagnostics.coordinateCompositionStatus = "confirmed-translation-only";
  }
}

function isCanvasOrigin(node: ParsedPixNode): boolean {
  return node.type === "CANVAS" && node.parentId === null && node.raw.transform === undefined;
}

function isPureTranslation(node: ParsedPixNode): boolean {
  const transform = node.raw.transform;
  return node.rect.x !== undefined && node.rect.y !== undefined &&
    transform?.m00 === 1 && transform.m01 === 0 && transform.m10 === 0 && transform.m11 === 1 &&
    transform.m02 === node.rect.x && transform.m12 === node.rect.y;
}

function guidToId(guid: KiwiGuid | undefined): string | null {
  if (typeof guid?.sessionID !== "number" || typeof guid.localID !== "number") return null;
  return `${guid.sessionID}:${guid.localID}`;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export { readZipEntries, type ZipEntry } from "./zip.js";
