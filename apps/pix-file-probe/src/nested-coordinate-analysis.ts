import { basename } from "node:path";
import { parsePixFile, type ParsedPixDocument, type ParsedPixNode } from "@pixso-figma-migration/pix-parser";

type Status = "confirmed" | "not-found";

interface Point {
  x: number;
  y: number;
}

interface CoordinateEvidence {
  sample: string;
  nodePath: string;
  known: { local: Point; ancestorTranslations: Point[]; absolute: Point };
  decoded: { local: Point; absolute: Point | null };
  fieldPath: "PixsoNode.transform.m02/m12";
  recordOffset: number;
  confidence: Status;
}

export interface NestedCoordinateReport {
  schemaVersion: 1;
  generatedAt: string;
  privacy: { localOnly: true; pathsRedacted: true; realFilesCommitted: false };
  sampleCount: number;
  integrity: Array<{
    group: "single-level" | "double-level" | "grandparent-only" | "siblings";
    samples: string[];
    decodedAndReencodedExactly: boolean;
    nodeCountStable: boolean;
    targetGuidsStable: boolean;
    parentChainsStable: boolean;
    pureTranslationMatrices: boolean;
    onlyExpectedSemanticChanges: boolean;
    notes: string[];
  }>;
  coordinateComposition: {
    status: Status;
    model: "translation-only-ancestor-sum";
    parserStatus: "confirmed-translation-only";
    localFieldPath: "PixsoNode.transform.m02/m12";
    samples: CoordinateEvidence[];
    limitations: string[];
  };
  conclusion: { status: "PASS" | "STOP"; reason: string };
}

const sampleDefinitions = [
  definition("nested-single-00.pix", "single-level", { x: 10, y: 20 }, [{ x: 0, y: 0 }]),
  definition("nested-single-100-200.pix", "single-level", { x: 10, y: 20 }, [{ x: 100, y: 200 }]),
  definition("nested-single-neg.pix", "single-level", { x: 10, y: 20 }, [{ x: -50, y: 30 }]),
  definition("nested-double-positive.pix", "double-level", { x: 5, y: 6 }, [{ x: 100, y: 200 }, { x: 30, y: 40 }]),
  definition("nested-double-negative.pix", "double-level", { x: 5, y: 6 }, [{ x: -40, y: 50 }, { x: -30, y: -20 }]),
  definition("nested-grandparent-00.pix", "grandparent-only", { x: 5, y: 6 }, [{ x: 0, y: 0 }, { x: 30, y: 40 }]),
  definition("nested-grandparent-80-neg20.pix", "grandparent-only", { x: 5, y: 6 }, [{ x: 80, y: -20 }, { x: 30, y: 40 }]),
  definition("nested-siblings-00.pix", "siblings", { x: 10, y: 20 }, [{ x: 0, y: 0 }, { x: 0, y: 0 }]),
  definition("nested-siblings-00.pix", "siblings", { x: 50, y: 60 }, [{ x: 0, y: 0 }, { x: 0, y: 0 }]),
  definition("nested-siblings-moved.pix", "siblings", { x: 10, y: 20 }, [{ x: 0, y: 0 }, { x: 100, y: -30 }]),
  definition("nested-siblings-moved.pix", "siblings", { x: 50, y: 60 }, [{ x: 0, y: 0 }, { x: 100, y: -30 }])
] as const;

export const nestedCoordinateSampleNames = [...new Set(sampleDefinitions.map((sample) => sample.sample))];

export async function analyzeNestedCoordinateFiles(filePaths: string[]): Promise<NestedCoordinateReport> {
  const documents = new Map<string, ParsedPixDocument>();
  for (const path of filePaths) documents.set(basename(path), await parsePixFile(path));
  const missing = nestedCoordinateSampleNames.filter((name) => !documents.has(name));
  if (missing.length) throw new Error(`Missing nested coordinate samples: ${missing.join(", ")}`);

  const evidence = sampleDefinitions.map((known) => {
    const document = documents.get(known.sample)!;
    const node = findByLocalPoint(document, known.local);
    const absolute = decodedAbsolute(node);
    const decoded = { local: point(node.rect.x, node.rect.y), absolute };
    const matches = equal(decoded.local, known.local) && equal(absolute, known.absolute) &&
      node.raw.diagnostics.coordinateCompositionStatus === "confirmed-translation-only";
    return {
      sample: known.sample,
      nodePath: nodePath(document, node),
      known: { local: known.local, ancestorTranslations: known.ancestors, absolute: known.absolute },
      decoded,
      fieldPath: "PixsoNode.transform.m02/m12" as const,
      recordOffset: node.raw.recordOffset,
      confidence: matches ? "confirmed" as const : "not-found" as const
    };
  });

  const integrity = [
    integrityGroup("single-level", ["nested-single-00.pix", "nested-single-100-200.pix", "nested-single-neg.pix"], documents, ["ParentFrame"], [{ x: 10, y: 20 }], []),
    integrityGroup("double-level", ["nested-double-positive.pix", "nested-double-negative.pix"], documents, ["ParentFrame", "FrameB"], [{ x: 5, y: 6 }], []),
    integrityGroup("grandparent-only", ["nested-grandparent-00.pix", "nested-grandparent-80-neg20.pix"], documents, ["ParentFrame"], [{ x: 5, y: 6 }], [
      "FrameB and ChildRect local transforms remain unchanged while only ParentFrame moves."
    ]),
    integrityGroup("siblings", ["nested-siblings-00.pix", "nested-siblings-moved.pix"], documents, ["FrameB"], [{ x: 10, y: 20 }, { x: 50, y: 60 }], [
      "The two synthetic rectangles intentionally share a name; stable GUIDs and unique local positions identify them.",
      "Their local delta remains exactly (40,40) after the direct parent moves."
    ])
  ];
  const pass = evidence.every((item) => item.confidence === "confirmed") && integrity.every((group) =>
    group.decodedAndReencodedExactly && group.nodeCountStable && group.targetGuidsStable &&
    group.parentChainsStable && group.pureTranslationMatrices && group.onlyExpectedSemanticChanges
  );

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    privacy: { localOnly: true, pathsRedacted: true, realFilesCommitted: false },
    sampleCount: nestedCoordinateSampleNames.length,
    integrity,
    coordinateComposition: {
      status: pass ? "confirmed" : "not-found",
      model: "translation-only-ancestor-sum",
      parserStatus: "confirmed-translation-only",
      localFieldPath: "PixsoNode.transform.m02/m12",
      samples: evidence,
      limitations: [
        "Confirmed only for Page, Frame, and Rectangle chains containing translation matrices.",
        "Rotation, scale, skew, mirror, Auto Layout, Group, Section, Component/Instance, and page-origin offsets remain unverified.",
        "rect.x/y remain parent-local. Computed absolute coordinates are diagnostics-only and are omitted when any ancestor is missing or not a pure translation."
      ]
    },
    conclusion: {
      status: pass ? "PASS" : "STOP",
      reason: pass
        ? "Nested translation-only ancestor composition matched exactly across nine controlled local samples."
        : "At least one controlled hierarchy, local coordinate, or exact ancestor sum did not meet the confirmation threshold."
    }
  };
}

function definition(sample: string, group: "single-level" | "double-level" | "grandparent-only" | "siblings", local: Point, ancestors: Point[]) {
  return { sample, group, local, ancestors, absolute: add([local, ...ancestors]) };
}

function integrityGroup(
  group: NestedCoordinateReport["integrity"][number]["group"],
  samples: string[],
  documents: Map<string, ParsedPixDocument>,
  movableNames: string[],
  targetPoints: Point[],
  notes: string[]
): NestedCoordinateReport["integrity"][number] {
  const parsed = samples.map((name) => documents.get(name)!);
  const targets = parsed.map((document) => targetPoints.map((value) => findByLocalPoint(document, value)));
  return {
    group,
    samples,
    decodedAndReencodedExactly: parsed.every((document) => document.rootRoundTripExact),
    nodeCountStable: new Set(parsed.map((document) => document.nodes.length)).size === 1,
    targetGuidsStable: targets.every((nodes) => equal(nodes.map((node) => node.id), targets[0].map((node) => node.id))),
    parentChainsStable: targets.every((nodes, index) => equal(
      nodes.map((node) => idChain(parsed[index], node)),
      targets[0].map((node) => idChain(parsed[0], node))
    )),
    pureTranslationMatrices: targets.every((nodes, index) => nodes.every((node) =>
      idChain(parsed[index], node).slice(0, -1).every((id) => {
        const ancestor = parsed[index].nodes.find((candidate) => candidate.id === id)!;
        return ancestor.type === "CANVAS" || isPureTranslation(ancestor);
      })
    )),
    onlyExpectedSemanticChanges: parsed.slice(1).every((document) =>
      equal(semanticSnapshot(document, movableNames), semanticSnapshot(parsed[0], movableNames))
    ),
    notes
  };
}

function semanticSnapshot(document: ParsedPixDocument, movableNames: string[]): unknown {
  return [...document.nodes].sort((left, right) => (left.id ?? "").localeCompare(right.id ?? "")).map((node) => {
    const movable = movableNames.includes(node.name ?? "");
    const transform = node.raw.transform ? { ...node.raw.transform } : undefined;
    if (movable && transform) {
      transform.m02 = 0;
      transform.m12 = 0;
    }
    return {
      id: node.id, parentId: node.parentId, name: node.name, type: node.type,
      rect: { ...node.rect, x: movable ? 0 : node.rect.x, y: movable ? 0 : node.rect.y },
      attributes: node.attributes,
      transform
    };
  });
}

function findByLocalPoint(document: ParsedPixDocument, local: Point): ParsedPixNode {
  const matches = document.nodes.filter((node) => node.name === "ChildRect" && node.type === "RECTANGLE" &&
    node.rect.x === local.x && node.rect.y === local.y);
  if (matches.length !== 1) throw new Error(`Expected one ChildRect at (${local.x},${local.y}); found ${matches.length}`);
  return matches[0];
}

function decodedAbsolute(node: ParsedPixNode): Point | null {
  const diagnostics = node.raw.diagnostics;
  return diagnostics.computedAbsoluteX === undefined || diagnostics.computedAbsoluteY === undefined
    ? null
    : { x: diagnostics.computedAbsoluteX, y: diagnostics.computedAbsoluteY };
}

function nodePath(document: ParsedPixDocument, node: ParsedPixNode): string {
  const byId = new Map(document.nodes.flatMap((candidate) => candidate.id ? [[candidate.id, candidate] as const] : []));
  const types: string[] = [];
  let current: ParsedPixNode | undefined = node;
  const visited = new Set<string>();
  while (current) {
    types.push(current.type ?? "UNKNOWN");
    if (!current.id || visited.has(current.id)) break;
    visited.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return types.join(" > ");
}

function idChain(document: ParsedPixDocument, node: ParsedPixNode): string[] {
  const byId = new Map(document.nodes.flatMap((candidate) => candidate.id ? [[candidate.id, candidate] as const] : []));
  const ids: string[] = [];
  let current: ParsedPixNode | undefined = node;
  const visited = new Set<string>();
  while (current?.id && !visited.has(current.id)) {
    visited.add(current.id);
    ids.push(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return ids;
}

function isPureTranslation(node: ParsedPixNode): boolean {
  const matrix = node.raw.transform;
  return matrix?.m00 === 1 && matrix.m01 === 0 && matrix.m10 === 0 && matrix.m11 === 1 &&
    matrix.m02 === node.rect.x && matrix.m12 === node.rect.y;
}

function point(x: number | undefined, y: number | undefined): Point {
  if (x === undefined || y === undefined) throw new Error("Expected decoded local coordinates");
  return { x, y };
}

function add(points: Point[]): Point {
  return points.reduce((sum, value) => ({ x: sum.x + value.x, y: sum.y + value.y }), { x: 0, y: 0 });
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
