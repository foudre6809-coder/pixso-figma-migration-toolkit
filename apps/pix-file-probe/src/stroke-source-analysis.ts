import { basename } from "node:path";
import {
  decodePixFileForResearch,
  parsePixFile,
  type DecodedPixResearchNode,
  type ParsedPixDocument,
  type ParsedPixNode
} from "@pixso-figma-migration/pix-parser";

type Status = "confirmed" | "inferred" | "not-found";
type Conclusion = "PASS" | "FIX" | "STOP";

interface ChangedField {
  path: string;
  left: unknown;
  right: unknown;
}

interface PairDiff {
  leftSample: string;
  rightSample: string;
  changedFieldCount: number;
  changedFields: ChangedField[];
}

interface SampleSummary {
  sample: string;
  decoded: boolean;
  targetName: string | null;
  targetType: string | null;
  targetGuid: string | null;
  nodeCount: number;
  recordOffset: number | null;
  visibleStroke: {
    weight: number | null;
    align: string | null;
    color: string | null;
  };
  expectedSource: "inline" | "shared-style" | "detached-style" | "variable-bound" | "variable-detached";
}

interface SourceEvidence {
  status: Status;
  candidateIdentityFieldPaths: string[];
  valueFieldPaths: string[];
  samples: string[];
  evidenceChains: string[];
  limitations: string[];
}

export interface StrokeSourceReport {
  schemaVersion: 1;
  generatedAt: string;
  privacy: { localOnly: true; pathsRedacted: true; realFilesCommitted: false };
  sampleCount: number;
  requiredSamples: string[];
  missingSamples: string[];
  integrity: {
    decodedSamples: number;
    targetGuidStable: boolean;
    targetIdentityStable: boolean;
    nodeCountStable: boolean;
    unexpectedDecodedChanges: string[];
  };
  samples: SampleSummary[];
  completeDecodedNodeDiffs: PairDiff[];
  styleReference: SourceEvidence;
  variableBinding: SourceEvidence;
  parserBoundary: {
    attributesStrokeResolvedAppearanceOnly: true;
    sourceFieldsInDiagnosticsOnly: true;
    parserSourceOutputChanged: false;
  };
  conclusion: { status: Conclusion; reason: string };
}

export const strokeSourceSampleNames = [
  "stroke-inline-blue.pix",
  "stroke-style-blue.pix",
  "stroke-style-detached-blue.pix",
  "stroke-style-value-blue.pix",
  "stroke-style-value-green.pix",
  "stroke-inline-variable-value.pix",
  "stroke-variable-bound.pix",
  "stroke-variable-detached.pix",
  "stroke-variable-value-a.pix",
  "stroke-variable-value-b.pix"
];

const expectedSource = new Map<string, SampleSummary["expectedSource"]>([
  ["stroke-inline-blue.pix", "inline"],
  ["stroke-style-blue.pix", "shared-style"],
  ["stroke-style-detached-blue.pix", "detached-style"],
  ["stroke-style-value-blue.pix", "shared-style"],
  ["stroke-style-value-green.pix", "shared-style"],
  ["stroke-inline-variable-value.pix", "inline"],
  ["stroke-variable-bound.pix", "variable-bound"],
  ["stroke-variable-detached.pix", "variable-detached"],
  ["stroke-variable-value-a.pix", "variable-bound"],
  ["stroke-variable-value-b.pix", "variable-bound"]
]);

export async function analyzeStrokeSourcePixFiles(filePaths: string[]): Promise<StrokeSourceReport> {
  const byName = new Map(filePaths.map((filePath) => [basename(filePath), filePath]));
  const presentNames = strokeSourceSampleNames.filter((sample) => byName.has(sample));
  const missingSamples = strokeSourceSampleNames.filter((sample) => !byName.has(sample));
  const parsed = new Map<string, ParsedPixDocument>();
  const rawTargets = new Map<string, DecodedPixResearchNode>();

  for (const sample of presentNames) {
    const filePath = byName.get(sample)!;
    parsed.set(sample, await parsePixFile(filePath));
    const raw = await decodePixFileForResearch(filePath);
    rawTargets.set(sample, targetRawNode(raw.nodes));
  }

  const samples = presentNames.map((sample) => summarizeSample(sample, parsed.get(sample)!));
  const completeDecodedNodeDiffs = buildPairDiffs(presentNames, rawTargets);
  const styleReference = analyzeStyleEvidence(presentNames, rawTargets);
  const variableBinding = analyzeVariableEvidence(presentNames, rawTargets, missingSamples);
  const pass = styleReference.status === "confirmed" && variableBinding.status === "confirmed";
  const fix = styleReference.status !== "not-found" || variableBinding.status !== "not-found";

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    privacy: { localOnly: true, pathsRedacted: true, realFilesCommitted: false },
    sampleCount: presentNames.length,
    requiredSamples: strokeSourceSampleNames,
    missingSamples,
    integrity: {
      decodedSamples: samples.filter((sample) => sample.decoded).length,
      targetGuidStable: new Set(samples.map((sample) => sample.targetGuid)).size === 1,
      targetIdentityStable: samples.every((sample) => sample.targetName === "StrokeTarget" && sample.targetType === "RECTANGLE"),
      nodeCountStable: new Set(samples.map((sample) => sample.nodeCount)).size === 1,
      unexpectedDecodedChanges: summarizeUnexpectedChanges(completeDecodedNodeDiffs)
    },
    samples,
    completeDecodedNodeDiffs,
    styleReference,
    variableBinding,
    parserBoundary: {
      attributesStrokeResolvedAppearanceOnly: true,
      sourceFieldsInDiagnosticsOnly: true,
      parserSourceOutputChanged: false
    },
    conclusion: {
      status: pass ? "PASS" : fix ? "FIX" : "STOP",
      reason: pass
        ? "Shared style and variable binding identity chains were both confirmed in controlled samples."
        : fix
          ? "At least one stroke source chain has evidence, but the matrix is incomplete or one chain is not confirmed."
          : "No decoded source identity evidence was found in the available controlled samples."
    }
  };
}

function summarizeSample(sample: string, document: ParsedPixDocument): SampleSummary {
  const node = targetParsedNode(document);
  const paint = node.attributes.stroke?.paints[0];
  return {
    sample,
    decoded: document.rootRoundTripExact,
    targetName: node.name ?? null,
    targetType: node.type ?? null,
    targetGuid: node.id ?? null,
    nodeCount: document.nodes.length,
    recordOffset: node.raw.recordOffset,
    visibleStroke: {
      weight: node.attributes.stroke?.weight ?? null,
      align: node.attributes.stroke?.align ?? null,
      color: colorHex(paint?.color)
    },
    expectedSource: expectedSource.get(sample)!
  };
}

function targetParsedNode(document: ParsedPixDocument): ParsedPixNode {
  const matches = document.nodes.filter((node) => node.name === "StrokeTarget" && node.type === "RECTANGLE");
  if (matches.length !== 1) throw new Error(`Expected one RECTANGLE named StrokeTarget; found ${matches.length}`);
  return matches[0];
}

function targetRawNode(nodes: DecodedPixResearchNode[]): DecodedPixResearchNode {
  const matches = nodes.filter((node) => node.decoded.name === "StrokeTarget" && node.decoded.type === "RECTANGLE");
  if (matches.length !== 1) throw new Error(`Expected one decoded RECTANGLE named StrokeTarget; found ${matches.length}`);
  return matches[0]!;
}

function buildPairDiffs(names: string[], rawTargets: Map<string, DecodedPixResearchNode>): PairDiff[] {
  const pairs = [
    ["stroke-inline-blue.pix", "stroke-style-blue.pix"],
    ["stroke-style-blue.pix", "stroke-style-detached-blue.pix"],
    ["stroke-style-value-blue.pix", "stroke-style-value-green.pix"],
    ["stroke-inline-variable-value.pix", "stroke-variable-bound.pix"],
    ["stroke-variable-bound.pix", "stroke-variable-detached.pix"],
    ["stroke-variable-value-a.pix", "stroke-variable-value-b.pix"]
  ] as const;
  return pairs
    .filter(([left, right]) => names.includes(left) && names.includes(right))
    .map(([leftSample, rightSample]) => {
      const changedFields = diffObjects(rawTargets.get(leftSample)!.decoded, rawTargets.get(rightSample)!.decoded);
      return { leftSample, rightSample, changedFieldCount: changedFields.length, changedFields };
    });
}

function analyzeStyleEvidence(names: string[], rawTargets: Map<string, DecodedPixResearchNode>): SourceEvidence {
  const required = ["stroke-inline-blue.pix", "stroke-style-blue.pix", "stroke-style-detached-blue.pix", "stroke-style-value-blue.pix", "stroke-style-value-green.pix"];
  const missing = required.filter((sample) => !names.includes(sample));
  if (missing.length) {
    return sourceEvidence("not-found", [], [], names.filter((sample) => required.includes(sample)), [], [`Missing style samples: ${missing.join(", ")}`]);
  }
  const inline = flatten(rawTargets.get("stroke-inline-blue.pix")!.decoded);
  const styleBlue = flatten(rawTargets.get("stroke-style-blue.pix")!.decoded);
  const detached = flatten(rawTargets.get("stroke-style-detached-blue.pix")!.decoded);
  const styleValueBlue = flatten(rawTargets.get("stroke-style-value-blue.pix")!.decoded);
  const styleValueGreen = flatten(rawTargets.get("stroke-style-value-green.pix")!.decoded);
  const identity = commonPaths(styleBlue, styleValueBlue, styleValueGreen)
    .filter((path) => !same(inline.get(path), styleBlue.get(path)) && !same(detached.get(path), styleBlue.get(path)))
    .filter((path) => !isVisibleStrokeValuePath(path));
  const valuePaths = changedPaths(styleValueBlue, styleValueGreen).filter(isVisibleStrokeValuePath);
  return sourceEvidence(
    identity.length ? "confirmed" : "not-found",
    identity,
    valuePaths,
    required,
    [
      "inline -> style introduces stable non-appearance fields",
      "style -> detached removes those fields while keeping the visible blue stroke",
      "style blue -> style green keeps identity fields stable; decoded target visible stroke did not change"
    ],
    identity.length
      ? [
        "Shared style evidence is scoped to color style binding on stroke paint.",
        valuePaths.length
          ? "Shared style value propagation changed decoded visible stroke fields."
          : "The style-value-green sample did not change decoded visible stroke fields; shared style definition value storage remains not-found."
      ]
      : ["No stable non-appearance style identity field was found."]
  );
}

function analyzeVariableEvidence(names: string[], rawTargets: Map<string, DecodedPixResearchNode>, missingSamples: string[]): SourceEvidence {
  const required = ["stroke-inline-variable-value.pix", "stroke-variable-bound.pix", "stroke-variable-detached.pix", "stroke-variable-value-a.pix", "stroke-variable-value-b.pix"];
  const presentRequired = required.filter((sample) => names.includes(sample));
  const missing = required.filter((sample) => missingSamples.includes(sample));
  const inline = rawTargets.get("stroke-inline-variable-value.pix");
  const bound = rawTargets.get("stroke-variable-bound.pix");
  const valueA = rawTargets.get("stroke-variable-value-a.pix");
  if (!inline || !bound || !valueA) {
    return sourceEvidence("not-found", [], [], presentRequired, [], [`Missing required variable baseline/bound samples: ${missing.join(", ")}`]);
  }
  const inlineFlat = flatten(inline.decoded);
  const boundFlat = flatten(bound.decoded);
  const valueAFlat = flatten(valueA.decoded);
  const identity = commonPaths(boundFlat, valueAFlat)
    .filter((path) => !same(inlineFlat.get(path), boundFlat.get(path)))
    .filter((path) => !isVisibleStrokeValuePath(path));
  const valueB = rawTargets.get("stroke-variable-value-b.pix");
  const valuePaths = valueB ? changedPaths(valueAFlat, flatten(valueB.decoded)).filter(isVisibleStrokeValuePath) : [];
  return sourceEvidence(
    identity.length && valueB && names.includes("stroke-variable-detached.pix") ? "confirmed" : identity.length ? "inferred" : "not-found",
    identity,
    valuePaths,
    presentRequired,
    [
      "inline variable value -> variable bound introduces candidate non-appearance fields",
      "variable bound -> value A is stable",
      "variable detached and value B samples are required to confirm identity and value propagation"
    ],
    missing.length ? [`Missing variable samples: ${missing.join(", ")}`] : []
  );
}

function sourceEvidence(
  status: Status,
  candidateIdentityFieldPaths: string[],
  valueFieldPaths: string[],
  samples: string[],
  evidenceChains: string[],
  limitations: string[]
): SourceEvidence {
  return { status, candidateIdentityFieldPaths, valueFieldPaths, samples, evidenceChains, limitations };
}

function summarizeUnexpectedChanges(diffs: PairDiff[]): string[] {
  return diffs
    .filter((diff) => diff.changedFields.some((field) => field.path === "guid.localID" || field.path === "guid.sessionID"))
    .map((diff) => `${diff.leftSample} -> ${diff.rightSample} changed target GUID`);
}

function diffObjects(left: Record<string, unknown>, right: Record<string, unknown>): ChangedField[] {
  const leftFlat = flatten(left);
  const rightFlat = flatten(right);
  const paths = [...new Set([...leftFlat.keys(), ...rightFlat.keys()])].sort();
  return paths
    .filter((path) => !same(leftFlat.get(path), rightFlat.get(path)))
    .map((path) => ({ path, left: leftFlat.get(path) ?? null, right: rightFlat.get(path) ?? null }));
}

function flatten(value: unknown, prefix = ""): Map<string, unknown> {
  const result = new Map<string, unknown>();
  if (value === null || typeof value !== "object") {
    result.set(prefix || "$", value);
    return result;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      for (const [path, nested] of flatten(item, `${prefix}[${index}]`)) result.set(path, nested);
    });
    if (value.length === 0) result.set(prefix, []);
    return result;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    for (const [nestedPath, nestedValue] of flatten(nested, path)) result.set(nestedPath, nestedValue);
  }
  return result;
}

function commonPaths(...maps: Array<Map<string, unknown>>): string[] {
  if (maps.length === 0) return [];
  return [...maps[0]!.keys()].filter((path) => maps.every((map) => map.has(path) && same(map.get(path), maps[0]!.get(path))));
}

function changedPaths(left: Map<string, unknown>, right: Map<string, unknown>): string[] {
  return [...new Set([...left.keys(), ...right.keys()])].filter((path) => !same(left.get(path), right.get(path))).sort();
}

function isVisibleStrokeValuePath(path: string): boolean {
  if (path.includes("colorVar")) return false;
  return path.includes("strokePaints") || path.includes("strokeWeight") || path.includes("border") || path.includes("strokeAlign");
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function colorHex(color: { r?: number; g?: number; b?: number; a?: number } | undefined): string | null {
  if (color?.r === undefined || color.g === undefined || color.b === undefined || color.a === undefined) return null;
  const rgb = [color.r, color.g, color.b].map((value) => Math.round(value).toString(16).padStart(2, "0")).join("").toUpperCase();
  const alpha = Math.round(color.a).toString(16).padStart(2, "0").toUpperCase();
  return `#${rgb}${alpha === "FF" ? "" : alpha}`;
}
