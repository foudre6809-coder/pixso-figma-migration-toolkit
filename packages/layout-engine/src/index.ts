import type { MigrationNode } from "@pixso-figma-migration/migration-schema";

export interface LayoutPlan {
  migrationId: string;
  shouldApply: boolean;
  operations: Array<{ property: string; value: string | number }>;
  warnings: string[];
}

export interface LayoutPlanContext {
  children?: MigrationNode[];
}

export interface BackgroundRectangleCandidate {
  type: string;
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  isMask: boolean;
  rotation: number;
  opacity: number;
  blendMode: string;
  hasOnlySolidFills: boolean;
}

export type BackgroundRectangleClassification = "promote" | "retain" | "none";

function approximatelyEqual(left: number, right: number, tolerance: number): boolean {
  return Math.abs(left - right) <= tolerance;
}

export function classifyBackgroundRectangle(
  candidate: BackgroundRectangleCandidate,
  containerWidth: number,
  containerHeight: number,
  tolerance = 1
): BackgroundRectangleClassification {
  const coversContainer =
    candidate.type === "RECTANGLE" &&
    candidate.index === 0 &&
    candidate.visible &&
    !candidate.isMask &&
    approximatelyEqual(candidate.x, 0, tolerance) &&
    approximatelyEqual(candidate.y, 0, tolerance) &&
    approximatelyEqual(candidate.width, containerWidth, tolerance) &&
    approximatelyEqual(candidate.height, containerHeight, tolerance);

  if (!coversContainer) return "none";

  const canPromote =
    approximatelyEqual(candidate.rotation, 0, 0.01) &&
    approximatelyEqual(candidate.opacity, 1, 0.001) &&
    candidate.blendMode === "NORMAL" &&
    candidate.hasOnlySolidFills;

  return canPromote ? "promote" : "retain";
}

function hasNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function inferHugHeight(node: MigrationNode, children: MigrationNode[]): boolean {
  const mode = node.layout.mode.value;
  const container = node.rect.value;
  const top = node.layout.paddingTop.value;
  const bottom = node.layout.paddingBottom.value;
  const gap = node.layout.gap.value;
  const visibleChildren = children.filter((child) => child.visible.value !== false && child.rect.value);
  if (!container || !hasNumber(top) || !hasNumber(bottom) || !hasNumber(gap) || !visibleChildren.length) return false;

  const heights = visibleChildren.map((child) => child.rect.value?.height ?? 0);
  const contentHeight =
    mode === "HORIZONTAL"
      ? Math.max(...heights)
      : mode === "VERTICAL"
        ? heights.reduce((sum, height) => sum + height, 0) + gap * Math.max(0, heights.length - 1)
        : 0;
  const expectedHeight = top + contentHeight + bottom;
  const tolerance = Math.max(2, container.height * 0.05);
  return Math.abs(container.height - expectedHeight) <= tolerance;
}

function sizingProperty(mode: "HORIZONTAL" | "VERTICAL", dimension: "width" | "height"): string {
  if (mode === "HORIZONTAL") return dimension === "width" ? "primaryAxisSizingMode" : "counterAxisSizingMode";
  return dimension === "height" ? "primaryAxisSizingMode" : "counterAxisSizingMode";
}

export function createLayoutPlan(node: MigrationNode, context: LayoutPlanContext = {}): LayoutPlan {
  const operations: LayoutPlan["operations"] = [];
  const warnings: string[] = [];
  const mode = node.layout.mode.value;

  if (mode === "HORIZONTAL" || mode === "VERTICAL") {
    operations.push({ property: "layoutMode", value: mode });
  } else {
    return {
      migrationId: node.migrationId,
      shouldApply: false,
      operations,
      warnings: ["没有可恢复的自动布局方向。"]
    };
  }

  const numericFields = [
    ["paddingTop", node.layout.paddingTop.value],
    ["paddingRight", node.layout.paddingRight.value],
    ["paddingBottom", node.layout.paddingBottom.value],
    ["paddingLeft", node.layout.paddingLeft.value],
    ["itemSpacing", node.layout.gap.value]
  ] as const;

  for (const [property, value] of numericFields) {
    if (hasNumber(value)) operations.push({ property, value });
    else warnings.push(`${property} 字段不可用`);
  }

  const widthMode = node.layout.widthMode.value;
  const inferredHugHeight = node.layout.heightMode.value === null && inferHugHeight(node, context.children ?? []);
  const heightMode = inferredHugHeight ? "HUG" : node.layout.heightMode.value;

  if (widthMode === "HUG" || widthMode === "FIXED") {
    operations.push({ property: sizingProperty(mode, "width"), value: widthMode === "HUG" ? "AUTO" : "FIXED" });
  }
  if (heightMode === "HUG" || heightMode === "FIXED") {
    operations.push({ property: sizingProperty(mode, "height"), value: heightMode === "HUG" ? "AUTO" : "FIXED" });
    if (heightMode === "HUG" && node.rect.value && node.rect.value.height > 0) {
      operations.push({ property: "minHeight", value: node.rect.value.height });
    }
  }

  if (inferredHugHeight) warnings.push("高度根据 Pixso 原始尺寸、子节点高度、Padding 和 Gap 推断为自适应。");

  if (node.layout.widthMode.source === "inferred" || node.layout.heightMode.source === "inferred") {
    warnings.push("尺寸模式来自推断，请人工确认。");
  }

  return {
    migrationId: node.migrationId,
    shouldApply: operations.length > 0,
    operations,
    warnings
  };
}
