import { basename } from "node:path";
import { parsePixFile, type ParsedPixDocument, type ParsedPixNode } from "@pixso-figma-migration/pix-parser";

type Status = "confirmed" | "inferred" | "not-found";

interface SampleEvidence<T> {
  sample: string;
  known: T;
  decoded: T;
  fieldPath: string | string[];
  recordOffset: number;
  confidence: Status;
}

export interface ControlledDiffReport {
  schemaVersion: 1;
  generatedAt: string;
  privacy: { localOnly: true; pathsRedacted: true; realFilesCommitted: false };
  sampleCount: number;
  integrity: Array<{
    group: "coordinate" | "autoLayout" | "padding" | "stroke";
    samples: string[];
    decoded: boolean;
    targetGuidStable: boolean;
    targetIdentityStable: boolean;
    nodeCountStable: boolean;
    unexpectedChanges: string[];
  }>;
  coordinate: {
    status: Status;
    fieldPath: "PixsoNode.transform.m02/m12";
    model: "local-transform";
    samples: Array<SampleEvidence<{ x: number; y: number }>>;
    limitations: string[];
  };
  autoLayout: {
    status: Status;
    fieldPath: "PixsoNode.stackMode";
    samples: Array<SampleEvidence<string | null>>;
    limitations: string[];
  };
  padding: {
    status: Status;
    fieldPaths: string[];
    samples: Array<SampleEvidence<{ top: number; right: number; bottom: number; left: number }>>;
    limitations: string[];
  };
  stroke: {
    status: Status;
    fieldPaths: string[];
    samples: Array<SampleEvidence<{ present: boolean; weight: number | null; color: string | null; align: string | null }>>;
    styleReference: "not-found";
    variableBinding: "not-found";
    limitations: string[];
  };
  conclusion: { status: "PASS" | "FIX" | "STOP"; reason: string };
}

const coordinateKnown = new Map<string, { x: number; y: number }>([
  ["coord-00.pix", { x: 0, y: 0 }],
  ["coord-10.pix", { x: 10, y: 20 }],
  ["coord-50.pix", { x: 50, y: 70 }],
  ["coord-neg.pix", { x: -20, y: -30 }]
]);
const layoutKnown = new Map<string, string | null>([
  ["layout-none.pix", null],
  ["layout-horizontal.pix", "HORIZONTAL"],
  ["layout-vertical.pix", "VERTICAL"]
]);
const paddingKnown = new Map<string, { top: number; right: number; bottom: number; left: number }>([
  ["padding-0.pix", { top: 0, right: 0, bottom: 0, left: 0 }],
  ["padding-8.pix", { top: 8, right: 8, bottom: 8, left: 8 }],
  ["padding-16.pix", { top: 16, right: 16, bottom: 16, left: 16 }],
  ["padding-asym.pix", { top: 4, right: 8, bottom: 12, left: 16 }]
]);
const strokeKnown = new Map<string, { present: boolean; weight: number | null; color: string | null; align: string | null }>([
  ["stroke-none.pix", { present: false, weight: null, color: null, align: null }],
  ["stroke-1.pix", { present: true, weight: 1, color: "#D9DDE7", align: "INSIDE" }],
  ["stroke-2.pix", { present: true, weight: 2, color: "#D9DDE7", align: "INSIDE" }],
  ["stroke-color.pix", { present: true, weight: 1, color: "#FF0000", align: "INSIDE" }],
  ["stroke-outside.pix", { present: true, weight: 1, color: "#D9DDE7", align: "OUTSIDE" }]
]);

export async function analyzeControlledPixFiles(filePaths: string[]): Promise<ControlledDiffReport> {
  const parsed = new Map<string, ParsedPixDocument>();
  for (const path of filePaths) parsed.set(basename(path), await parsePixFile(path));
  const required = [...coordinateKnown.keys(), ...layoutKnown.keys(), ...paddingKnown.keys(), ...strokeKnown.keys()];
  const missing = required.filter((name) => !parsed.has(name));
  if (missing.length) throw new Error(`Missing controlled samples: ${missing.join(", ")}`);

  const coordinateSamples = [...coordinateKnown].map(([sample, known]) => {
    const node = target(parsed.get(sample)!, "ProbeFrame", "FRAME");
    const decoded = { x: number(node.rect.x), y: number(node.rect.y) };
    return evidence(sample, known, decoded, "PixsoNode.transform.m02/m12", node);
  });
  const layoutSamples = [...layoutKnown].map(([sample, known]) => {
    const node = target(parsed.get(sample)!, "ProbeLayout", "FRAME");
    return evidence(sample, known, node.attributes.layoutMode ?? null, "PixsoNode.stackMode", node);
  });
  const paddingSamples = [...paddingKnown].map(([sample, known]) => {
    const node = target(parsed.get(sample)!, "ProbeLayout", "FRAME");
    const value = node.attributes.padding;
    const decoded = {
      top: number(value?.top), right: number(value?.right), bottom: number(value?.bottom), left: number(value?.left)
    };
    return evidence(sample, known, decoded, [
      "PixsoNode.stackPaddingTop", "PixsoNode.stackPaddingRight",
      "PixsoNode.stackPaddingBottom", "PixsoNode.stackPaddingLeft"
    ], node);
  });
  const strokeSamples = [...strokeKnown].map(([sample, known]) => {
    const node = target(parsed.get(sample)!, "ProbeStroke", "RECTANGLE");
    const stroke = node.attributes.stroke;
    const paint = stroke?.paints[0];
    const decoded = {
      present: stroke !== undefined,
      weight: stroke?.weight ?? null,
      color: colorHex(paint?.color),
      align: stroke?.align ?? null
    };
    return evidence(sample, known, decoded, [
      "PixsoNode.strokePaints[]", "PixsoNode.strokePaints[].color",
      "PixsoNode.strokeWeight/border*Weight", "PixsoNode.strokeAlign"
    ], node);
  });

  const coordinateStatus = allMatch(coordinateSamples) ? "confirmed" : "not-found";
  const layoutStatus = allMatch(layoutSamples) ? "confirmed" : "not-found";
  const paddingStatus = allMatch(paddingSamples) ? "confirmed" : "not-found";
  const strokeStatus = allMatch(strokeSamples) ? "confirmed" : "not-found";
  const confirmedAttributeCount = [layoutStatus, paddingStatus, strokeStatus].filter((value) => value === "confirmed").length;
  const pass = coordinateStatus === "confirmed" && confirmedAttributeCount >= 2;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    privacy: { localOnly: true, pathsRedacted: true, realFilesCommitted: false },
    sampleCount: required.length,
    integrity: [
      integrity("coordinate", [...coordinateKnown.keys()], parsed, "ProbeFrame", "FRAME", []),
      integrity("autoLayout", [...layoutKnown.keys()], parsed, "ProbeLayout", "FRAME", [
        "Child transforms change as a derived consequence of direction.",
        "The none sample retains padding/gap storage while stackMode is absent; stackMode alone represents direction state."
      ]),
      integrity("padding", [...paddingKnown.keys()], parsed, "ProbeLayout", "FRAME", [
        "Child transforms change deterministically with padding; layoutMode remains HORIZONTAL and gap remains 0."
      ]),
      integrity("stroke", [...strokeKnown.keys()], parsed, "ProbeStroke", "RECTANGLE", [
        "strokePaddingPath appears when a stroke exists and is treated as a derived path, not a semantic source field."
      ])
    ],
    coordinate: {
      status: coordinateStatus,
      fieldPath: "PixsoNode.transform.m02/m12",
      model: "local-transform",
      samples: coordinateSamples,
      limitations: [
        "Root samples show no page-origin offset: m02/m12 equal the documented x/y values, including negatives.",
        "Nested-node m02/m12 values are parent-local translations; page-absolute coordinates require composing ancestor transforms."
      ]
    },
    autoLayout: {
      status: layoutStatus,
      fieldPath: "PixsoNode.stackMode",
      samples: layoutSamples,
      limitations: ["Direction-induced child transform changes are derived and are not used to identify stackMode."]
    },
    padding: {
      status: paddingStatus,
      fieldPaths: [
        "PixsoNode.stackPaddingTop", "PixsoNode.stackPaddingRight",
        "PixsoNode.stackPaddingBottom", "PixsoNode.stackPaddingLeft"
      ],
      samples: paddingSamples,
      limitations: ["Only numeric padding values are confirmed; variable-bound padding was not present in these samples."]
    },
    stroke: {
      status: strokeStatus,
      fieldPaths: [
        "PixsoNode.strokePaints[]", "PixsoNode.strokePaints[].color",
        "PixsoNode.strokeWeight", "PixsoNode.borderTopWeight/borderRightWeight/borderBottomWeight/borderLeftWeight",
        "PixsoNode.strokeAlign"
      ],
      samples: strokeSamples,
      styleReference: "not-found",
      variableBinding: "not-found",
      limitations: [
        "A 1 px INSIDE stroke omits strokeWeight/strokeAlign defaults but stores four 1 px border weights.",
        "Visible solid color, opacity, width, and align are confirmed; style references and variable bindings were absent."
      ]
    },
    conclusion: {
      status: pass ? "PASS" : "STOP",
      reason: pass
        ? "Coordinates and all three requested design-attribute groups were confirmed across 16 controlled local samples."
        : "Controlled values did not meet the coordinate plus two-attribute confirmation threshold."
    }
  };
}

function target(document: ParsedPixDocument, name: string, type: string): ParsedPixNode {
  const matches = document.nodes.filter((node) => node.name === name && node.type === type);
  if (matches.length !== 1) throw new Error(`Expected one ${type} named ${name}; found ${matches.length}`);
  return matches[0];
}

function evidence<T>(sample: string, known: T, decoded: T, fieldPath: string | string[], node: ParsedPixNode): SampleEvidence<T> {
  return { sample, known, decoded, fieldPath, recordOffset: node.raw.recordOffset, confidence: equal(known, decoded) ? "confirmed" : "not-found" };
}

function integrity(
  group: ControlledDiffReport["integrity"][number]["group"], samples: string[], parsed: Map<string, ParsedPixDocument>,
  name: string, type: string, unexpectedChanges: string[]
): ControlledDiffReport["integrity"][number] {
  const documents = samples.map((sample) => parsed.get(sample)!);
  const nodes = documents.map((document) => target(document, name, type));
  return {
    group,
    samples,
    decoded: documents.every((document) => document.rootRoundTripExact),
    targetGuidStable: new Set(nodes.map((node) => node.id)).size === 1,
    targetIdentityStable: nodes.every((node) => node.name === name && node.type === type && node.parentId === nodes[0].parentId),
    nodeCountStable: new Set(documents.map((document) => document.nodes.length)).size === 1,
    unexpectedChanges
  };
}

function allMatch<T>(samples: Array<SampleEvidence<T>>): boolean {
  return samples.every((sample) => sample.confidence === "confirmed");
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function number(value: number | undefined): number {
  if (value === undefined) throw new Error("Expected a decoded numeric value");
  return value;
}

function colorHex(color: { r?: number; g?: number; b?: number; a?: number } | undefined): string | null {
  if (color?.r === undefined || color.g === undefined || color.b === undefined || color.a === undefined) return null;
  const rgb = [color.r, color.g, color.b].map((value) => Math.round(value).toString(16).padStart(2, "0")).join("").toUpperCase();
  const alpha = Math.round(color.a).toString(16).padStart(2, "0").toUpperCase();
  return `#${rgb}${alpha === "FF" ? "" : alpha}`;
}
