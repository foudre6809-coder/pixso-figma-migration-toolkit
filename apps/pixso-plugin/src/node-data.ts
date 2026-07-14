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
}

export function createRootRefs(nodes: RawNode[]): RootRef[] {
  return nodes.map((node, originalIndex) => ({ node, originalIndex }));
}

export function rootPath(ref: RootRef): string[] {
  return [`${String(ref.node.name ?? "Unnamed")}[${ref.originalIndex}]`];
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
