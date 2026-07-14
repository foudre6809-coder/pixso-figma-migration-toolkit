import {
  type ImageFillSummary,
  type MigrationNode,
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
