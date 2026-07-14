import {
  type ImageFillSummary,
  type MigrationNode,
  type StrokePaintSummary,
  type EffectsSummary,
  native,
  unavailable
} from "@pixso-figma-migration/migration-schema";

export type RawNode = Record<string, any>;

export interface RootRef {
  node: RawNode;
  originalIndex: number;
  indexSource: "page" | "selection" | "unknown";
}

function pageIndexOf(node: RawNode, pageChildren: RawNode[]): number {
  const referenceIndex = pageChildren.indexOf(node);
  if (referenceIndex >= 0) return referenceIndex;
  if (typeof node.id !== "string") return -1;
  return pageChildren.findIndex((child) => child?.id === node.id);
}

export function createRootRefs(
  nodes: RawNode[],
  pageChildren?: RawNode[],
  fallbackIndexSource: RootRef["indexSource"] = "unknown"
): RootRef[] {
  return nodes.map((node, selectionIndex) => {
    const pageIndex = Array.isArray(pageChildren) ? pageIndexOf(node, pageChildren) : -1;
    return pageIndex >= 0
      ? { node, originalIndex: pageIndex, indexSource: "page" }
      : { node, originalIndex: selectionIndex, indexSource: fallbackIndexSource };
  });
}

export function rootPath(ref: RootRef): string[] {
  return [`${String(ref.node.name ?? "Unnamed")}[${ref.originalIndex}]`];
}

export function rootIndexWarnings(refs: RootRef[]): string[] {
  return refs.some((ref) => ref.indexSource !== "page")
    ? ["当前范围无法确认根节点在页面中的真实索引，已回退到选择顺序；根路径索引可信度下降，请在 Figma 匹配结果中重点复核同名节点。"]
    : [];
}

export function hasImageFill(fills: unknown): boolean {
  return Array.isArray(fills) && fills.some((paint) => paint?.type === "IMAGE");
}

export function classifyPixsoNodeType(node: RawNode): MigrationNode["type"] {
  const type = String(node.type ?? "UNKNOWN").toUpperCase();
  if (["FRAME", "GROUP", "COMPONENT", "INSTANCE", "TEXT"].includes(type)) {
    return type as MigrationNode["type"];
  }
  if (hasImageFill(node.fills)) return "IMAGE";
  if (["VECTOR", "BOOLEAN"].includes(type)) return type as MigrationNode["type"];
  if (["RECTANGLE", "ELLIPSE", "LINE", "POLYGON", "STAR", "SHAPE_PATH"].includes(type)) return "VECTOR";
  if (type.includes("IMAGE")) return "IMAGE";
  return "UNKNOWN";
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}

function visiblePaints(paints: unknown): any[] {
  return Array.isArray(paints) ? paints.filter((paint) => paint?.visible !== false) : [];
}

export function summarizeStrokes(
  node: RawNode
): NonNullable<MigrationNode["appearance"]["strokeSummary"]> {
  if (!Array.isArray(node.strokes)) return unavailable("未开放描边 Paint 字段。");
  const strokes = visiblePaints(node.strokes);
  const styleId = [node.strokeStyleId, node.strokeStyle?.id].find((value) => typeof value === "string") ?? null;
  const styleName = [node.strokeStyleName, node.strokeStyle?.name].find((value) => typeof value === "string") ?? null;
  const paintTypes = uniqueStrings(strokes.map((paint) => paint?.type));
  return native<StrokePaintSummary>({
    count: strokes.length,
    paintTypes,
    opacities: strokes.map((paint) => (typeof paint.opacity === "number" ? paint.opacity : 1)),
    styleId,
    styleName,
    isMixed: node.strokeWeight === "mixed",
    hasGradient: paintTypes.some((type) => type.includes("GRADIENT")),
    hasVariableReference: Boolean(
      styleId || strokes.some((paint) => paint?.boundVariables || paint?.variableId || paint?.styleId)
    ),
    completeSingleSolid: strokes.length === 1 && strokes[0]?.type === "SOLID"
  });
}

export function summarizeEffects(
  effects: unknown
): NonNullable<MigrationNode["appearance"]["effectsSummary"]> {
  if (!Array.isArray(effects)) return unavailable("未开放效果字段。");
  const visible = effects.filter((effect) => effect?.visible !== false);
  return native<EffectsSummary>({
    count: visible.length,
    types: uniqueStrings(visible.map((effect) => effect?.type)),
    complete: visible.every((effect) => typeof effect?.type === "string")
  });
}

export interface AppearanceOwnerCandidate {
  reason: "self" | "full-size-background" | "ambiguous" | "unavailable";
  childIndex?: number;
}

function hasDirectPaint(node: RawNode): boolean {
  return visiblePaints(node.fills).length > 0 || visiblePaints(node.strokes).length > 0;
}

function withinBackgroundTolerance(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= Math.max(1, Math.abs(expected) * 0.01);
}

export function findAppearanceOwnerCandidate(node: RawNode): AppearanceOwnerCandidate {
  if (hasDirectPaint(node)) return { reason: "self" };
  if (!Array.isArray(node.children)) return { reason: "unavailable" };
  const candidates = node.children
    .map((child: RawNode, index: number) => ({ child, index }))
    .filter(({ child }: { child: RawNode }) => {
      const type = String(child.type ?? "").toUpperCase();
      return (
        type === "RECTANGLE" &&
        child.visible !== false &&
        !child.isMask &&
        !child.isBooleanOperation &&
        withinBackgroundTolerance(Number(child.x), 0) &&
        withinBackgroundTolerance(Number(child.y), 0) &&
        withinBackgroundTolerance(Number(child.width), Number(node.width)) &&
        withinBackgroundTolerance(Number(child.height), Number(node.height))
      );
    });
  if (candidates.length === 1 && candidates[0]?.index === 0) {
    return { reason: "full-size-background", childIndex: candidates[0].index };
  }
  return { reason: candidates.length > 0 ? "ambiguous" : "unavailable" };
}

export function summarizeImageFills(
  fills: unknown
): MigrationNode["asset"]["imageFillSummary"] {
  if (!Array.isArray(fills)) return unavailable("未开放图片填充字段。");
  const images = fills.filter((paint) => paint?.type === "IMAGE");
  if (!images.length) {
    return native<ImageFillSummary>({
      count: 0,
      scaleModes: [],
      opacities: [],
      blendModes: [],
      hashes: [],
      hasTransform: false
    });
  }
  return native<ImageFillSummary>({
    count: images.length,
    scaleModes: uniqueStrings(images.map((paint) => paint.scaleMode ?? paint.imageScaleMode ?? paint.scalingMode)),
    opacities: images.map((paint) => (typeof paint.opacity === "number" ? paint.opacity : 1)),
    blendModes: images.map((paint) => (typeof paint.blendMode === "string" ? paint.blendMode : "NORMAL")),
    hashes: uniqueStrings(images.map((paint) => paint.imageHash ?? paint.hash ?? paint.imageRef)),
    hasTransform: images.some((paint) =>
      [paint.imageTransform, paint.transform, paint.scalingTransform].some((value) => value !== undefined && value !== null)
    )
  });
}

export function readLayoutPositioning(node: RawNode): MigrationNode["layout"]["positioning"] {
  const candidates: Array<[string, unknown]> = [
    ["layoutPositioning", node.layoutPositioning],
    ["isAbsolute", node.isAbsolute],
    ["ignoreAutoLayout", node.ignoreAutoLayout]
  ];
  for (const [field, value] of candidates) {
    if (value === "ABSOLUTE" || value === true) return native("ABSOLUTE" as const);
    if (value === "AUTO" || value === false) return native("AUTO" as const);
    if (value !== undefined && value !== null) return unavailable(`${field} 的值无法识别。`);
  }
  return unavailable("未开放绝对定位或忽略自动布局字段。");
}
