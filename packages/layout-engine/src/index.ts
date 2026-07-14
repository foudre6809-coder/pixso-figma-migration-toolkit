import type { MigrationNode } from "@pixso-figma-migration/migration-schema";

export interface LayoutPlan {
  migrationId: string;
  shouldApply: boolean;
  riskLevel: "low" | "high";
  operations: Array<{ property: string; value: string | number }>;
  warnings: string[];
}

export interface LayoutPlanContext {
  children?: MigrationNode[];
}

export interface OperationExecutionPlan {
  applyLayout: boolean;
  applyAppearance: boolean;
  applyComponent: boolean;
  needsReview: boolean;
}

export function createOperationExecutionPlan(options: {
  layoutRequested: boolean;
  layoutRisk: "low" | "high";
  appearanceSafe: boolean;
  componentSafe: boolean;
}): OperationExecutionPlan {
  return {
    applyLayout: options.layoutRequested && options.layoutRisk === "low",
    applyAppearance: options.appearanceSafe,
    applyComponent: options.componentSafe,
    needsReview: options.layoutRequested && options.layoutRisk === "high"
  };
}

export function classifyPreviewStatus(options: {
  plannedChanges: number;
  needsReview: boolean;
  blocked: boolean;
}): "modified" | "verified" | "partial" | "failed" {
  if (options.blocked) return "failed";
  if (options.needsReview) return "partial";
  return options.plannedChanges > 0 ? "modified" : "verified";
}

export function classifyApplyFailureStatus(appliedChanges: number): "partial" | "failed" {
  return appliedChanges > 0 ? "partial" : "failed";
}

export function requiresLaunchSelection(exportScope: "selection" | "page" | "artboard"): boolean {
  return exportScope !== "page";
}

export function hasDirectSolidAppearance(node: MigrationNode): boolean {
  return Boolean(node.appearance.fill.value || node.appearance.stroke.value);
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

export interface RetainedBackgroundLike {
  x: number;
  y: number;
  layoutPositioning: "AUTO" | "ABSOLUTE";
}

export function protectRetainedBackgroundBeforeLayout<T extends RetainedBackgroundLike>(
  background: T,
  applyLayoutMode: () => void
): void {
  const position = { x: background.x, y: background.y };
  try {
    background.layoutPositioning = "ABSOLUTE";
  } catch {
    // Some Figma runtimes reject ABSOLUTE until the parent has Auto Layout.
  }
  applyLayoutMode();
  background.layoutPositioning = "ABSOLUTE";
  background.x = position.x;
  background.y = position.y;
}

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

function overlaps(left: MigrationNode, right: MigrationNode): boolean {
  const a = left.rect.value;
  const b = right.rect.value;
  if (!a || !b || left.visible.value === false || right.visible.value === false) return false;
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function hasUnconfirmedOverlappingChildren(children: MigrationNode[]): boolean {
  for (let left = 0; left < children.length; left += 1) {
    for (let right = left + 1; right < children.length; right += 1) {
      if (!overlaps(children[left], children[right])) continue;
      const leftUnknown = children[left].layout.positioning.source === "unavailable";
      const rightUnknown = children[right].layout.positioning.source === "unavailable";
      if (leftUnknown || rightUnknown) return true;
    }
  }
  return false;
}

export function hasAbsolutePositionedChildren(children: MigrationNode[]): boolean {
  return children.some((child) => child.layout.positioning.value === "ABSOLUTE");
}

function inferHugHeight(node: MigrationNode, children: MigrationNode[]): boolean {
  const mode = node.layout.mode.value;
  const container = node.rect.value;
  const top = node.layout.paddingTop.value;
  const bottom = node.layout.paddingBottom.value;
  const gap = node.layout.gap.value;
  const visibleChildren = children.filter(
    (child) => child.visible.value !== false && child.layout.positioning.value !== "ABSOLUTE" && child.rect.value
  );
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
    const layoutContainer = ["FRAME", "GROUP", "COMPONENT", "INSTANCE"].includes(node.type);
    const warnings =
      layoutContainer && node.layout.mode.source === "unavailable" ? ["没有可恢复的自动布局方向。"] : [];
    return {
      migrationId: node.migrationId,
      shouldApply: false,
      riskLevel: "low",
      operations,
      warnings
    };
  }

  if (hasUnconfirmedOverlappingChildren(context.children ?? [])) {
    return {
      migrationId: node.migrationId,
      shouldApply: false,
      riskLevel: "high",
      operations: [],
      warnings: ["检测到重叠子节点，但无法确认绝对定位/忽略自动布局属性，已跳过自动布局修复。"]
    };
  }

  if (hasAbsolutePositionedChildren(context.children ?? [])) {
    return {
      migrationId: node.migrationId,
      shouldApply: false,
      riskLevel: "high",
      operations: [],
      warnings: ["检测到绝对定位或忽略自动布局的子节点；当前版本尚未安全恢复逐子节点定位，已跳过自动布局修复。"]
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
    riskLevel: "low",
    operations,
    warnings
  };
}
