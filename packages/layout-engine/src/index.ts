import type { MigrationNode } from "@pixso-figma-migration/migration-schema";

export interface LayoutPlan {
  migrationId: string;
  shouldApply: boolean;
  riskLevel: "low" | "high";
  operations: LayoutOperation[];
  warnings: string[];
}

export interface LayoutOperation {
  property: string;
  value: string | number;
}

const containerLayoutProperties = new Set([
  "layoutMode",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "itemSpacing",
  "primaryAxisSizingMode",
  "counterAxisSizingMode"
]);

export function selectSafeLayoutOperations(
  operations: LayoutOperation[],
  selfStructureSafe: boolean,
  parentStructureSafe: boolean
): {
  allowed: LayoutOperation[];
  skippedContainerCount: number;
  skippedItemCount: number;
  itemOperationCount: number;
} {
  const container = operations.filter((operation) => containerLayoutProperties.has(operation.property));
  const item = operations.filter((operation) => !containerLayoutProperties.has(operation.property));
  return {
    allowed: [...(selfStructureSafe ? container : []), ...(parentStructureSafe ? item : [])],
    skippedContainerCount: selfStructureSafe ? 0 : container.length,
    skippedItemCount: parentStructureSafe ? 0 : item.length,
    itemOperationCount: item.length
  };
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

export interface AppearanceRecoveryPlan {
  fill: boolean;
  stroke: boolean;
  strokeWeight: boolean;
  strokeAlign: boolean;
  cornerRadii: boolean;
  opacity: boolean;
}

export function createAppearanceRecoveryPlan(node: MigrationNode): AppearanceRecoveryPlan {
  const strokeComplete =
    !node.appearance.strokeSummary ||
    (node.appearance.strokeSummary.source === "native" &&
      node.appearance.strokeSummary.value?.completeSingleSolid === true);
  const stroke = Boolean(node.appearance.stroke.value && strokeComplete);
  return {
    fill: Boolean(node.appearance.fill.value),
    stroke,
    strokeWeight: stroke && typeof node.appearance.strokeWeight.value === "number",
    strokeAlign: stroke && Boolean(node.appearance.strokeAlign.value),
    cornerRadii: Boolean(node.appearance.cornerRadii.value),
    opacity: typeof node.appearance.opacity?.value === "number"
  };
}

export function shouldWriteReferencedStrokeValue(
  sourceHasReference: boolean,
  targetHasReference: boolean,
  targetHasVisibleStroke = true
): boolean {
  return !sourceHasReference || !targetHasReference || !targetHasVisibleStroke;
}

export interface DetachedAppearanceBackgroundPlan {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function createDetachedAppearanceBackgroundPlan(options: {
  sourceWidth?: number;
  sourceHeight?: number;
  targetX?: number;
  targetY?: number;
  targetWidth?: number;
  targetHeight?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  tolerance?: number;
}): DetachedAppearanceBackgroundPlan | undefined {
  const values = [
    options.sourceWidth,
    options.sourceHeight,
    options.targetX,
    options.targetY,
    options.targetWidth,
    options.targetHeight,
    options.paddingTop,
    options.paddingRight,
    options.paddingBottom,
    options.paddingLeft
  ];
  if (values.some((value) => typeof value !== "number" || !Number.isFinite(value))) return undefined;
  const sourceWidth = options.sourceWidth!;
  const sourceHeight = options.sourceHeight!;
  const targetWidth = options.targetWidth!;
  const targetHeight = options.targetHeight!;
  const tolerance = options.tolerance ?? 3;
  if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) return undefined;
  if (Math.abs(sourceWidth - (targetWidth + options.paddingLeft! + options.paddingRight!)) > tolerance) return undefined;
  if (Math.abs(sourceHeight - (targetHeight + options.paddingTop! + options.paddingBottom!)) > tolerance) return undefined;
  return {
    x: options.targetX! - options.paddingLeft!,
    y: options.targetY! - options.paddingTop!,
    width: sourceWidth,
    height: sourceHeight
  };
}

export type RepairSafetyLevel = "diagnostic" | "conservative" | "structural";

export interface RepairSafetyPolicy {
  writeMigrationId: boolean;
  applyAppearance: boolean;
  applyLayout: boolean;
  convertGroup: boolean;
  rebuildComponent: boolean;
  applyGeometry: boolean;
}

export function createRepairSafetyPolicy(
  level: RepairSafetyLevel,
  experimentalGeometry = false
): RepairSafetyPolicy {
  if (level === "diagnostic") {
    return {
      writeMigrationId: false,
      applyAppearance: false,
      applyLayout: false,
      convertGroup: false,
      rebuildComponent: false,
      applyGeometry: false
    };
  }
  if (level === "conservative") {
    return {
      writeMigrationId: true,
      applyAppearance: true,
      applyLayout: false,
      convertGroup: false,
      rebuildComponent: false,
      applyGeometry: false
    };
  }
  return {
    writeMigrationId: true,
    applyAppearance: true,
    applyLayout: true,
    convertGroup: true,
    rebuildComponent: true,
    applyGeometry: experimentalGeometry
  };
}

export interface StructureMatchInput {
  parentMatchHighConfidence: boolean;
  sourceChildCount: number;
  targetChildCount: number;
  matchedChildCount: number;
  orderConsistency: number;
  hasMask: boolean;
  hasBooleanDependency: boolean;
  hasRotation: boolean;
  hasComplexTransform: boolean;
  hasUnknownAbsolute: boolean;
  hasOverlap: boolean;
  sourceWidth?: number;
  sourceHeight?: number;
  targetWidth?: number;
  targetHeight?: number;
  geometryWriteRequired: boolean;
  externalBoundsStable: boolean;
}

export interface StructureMatchAssessment extends StructureMatchInput {
  matchedRatio: number;
  sizeWithinTolerance: boolean;
  eligibleForAutoLayout: boolean;
  eligibleForGroupConversion: boolean;
  reasons: string[];
}

function dimensionWithinTolerance(source?: number, target?: number): boolean {
  if (source === undefined || target === undefined) return false;
  return Math.abs(source - target) <= Math.max(2, Math.abs(source) * 0.02);
}

export function assessStructureMatch(input: StructureMatchInput): StructureMatchAssessment {
  const matchedRatio = input.sourceChildCount === 0 ? (input.targetChildCount === 0 ? 1 : 0) : input.matchedChildCount / input.sourceChildCount;
  const sizeWithinTolerance =
    dimensionWithinTolerance(input.sourceWidth, input.targetWidth) &&
    dimensionWithinTolerance(input.sourceHeight, input.targetHeight);
  const reasons: string[] = [];
  if (!input.parentMatchHighConfidence) reasons.push("父节点不是唯一高置信匹配");
  if (input.sourceChildCount !== input.targetChildCount) reasons.push("源与目标直接子节点数量不一致");
  if (matchedRatio < 0.9) reasons.push("直接子节点匹配率低于 90%");
  if (input.orderConsistency < 1) reasons.push("已匹配子节点顺序不一致");
  if (input.hasMask) reasons.push("存在 Mask");
  if (input.hasBooleanDependency) reasons.push("存在 Boolean 依赖");
  if (input.hasRotation) reasons.push("存在旋转");
  if (input.hasComplexTransform) reasons.push("存在复杂变换");
  if (input.hasUnknownAbsolute) reasons.push("存在未知绝对定位");
  if (input.hasOverlap) reasons.push("存在未确认重叠");
  if (!sizeWithinTolerance) reasons.push("目标尺寸与源尺寸差异超过 2px 或 2%");
  if (input.geometryWriteRequired) reasons.push("需要几何写回才能恢复结构");
  if (!input.externalBoundsStable) reasons.push("无法确认转换前后外部边界不变");

  const sharedSafe =
    input.parentMatchHighConfidence &&
    input.sourceChildCount === input.targetChildCount &&
    matchedRatio >= 0.9 &&
    input.orderConsistency === 1 &&
    !input.hasMask &&
    !input.hasUnknownAbsolute &&
    !input.hasOverlap &&
    sizeWithinTolerance &&
    !input.geometryWriteRequired &&
    input.externalBoundsStable;
  return {
    ...input,
    matchedRatio,
    sizeWithinTolerance,
    eligibleForAutoLayout: sharedSafe,
    eligibleForGroupConversion:
      sharedSafe && !input.hasBooleanDependency && !input.hasRotation && !input.hasComplexTransform,
    reasons
  };
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

export function protectAbsoluteChildrenBeforeLayout<T extends RetainedBackgroundLike>(
  children: T[],
  applyLayoutMode: () => void
): void {
  const positions = children.map((child) => ({ child, x: child.x, y: child.y }));
  for (const { child } of positions) {
    try {
      child.layoutPositioning = "ABSOLUTE";
    } catch {
      // Some runtimes accept ABSOLUTE only after the parent has Auto Layout.
    }
  }
  applyLayoutMode();
  for (const { child, x, y } of positions) {
    child.layoutPositioning = "ABSOLUTE";
    child.x = x;
    child.y = y;
  }
}

export function protectRetainedBackgroundBeforeLayout<T extends RetainedBackgroundLike>(
  background: T,
  applyLayoutMode: () => void
): void {
  protectAbsoluteChildrenBeforeLayout([background], applyLayoutMode);
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
  const setOperation = (property: string, value: string | number) => {
    const existing = operations.find((operation) => operation.property === property);
    if (existing) existing.value = value;
    else operations.push({ property, value });
  };

  const hasContainerLayout = mode === "HORIZONTAL" || mode === "VERTICAL";
  if (hasContainerLayout) {
    operations.push({ property: "layoutMode", value: mode });
  } else if (["FRAME", "GROUP", "COMPONENT", "INSTANCE"].includes(node.type) && node.layout.mode.source === "unavailable") {
    const layoutContainer = ["FRAME", "GROUP", "COMPONENT", "INSTANCE"].includes(node.type);
    if (layoutContainer) warnings.push("没有可恢复的自动布局方向。");
  }

  if (hasContainerLayout && hasUnconfirmedOverlappingChildren(context.children ?? [])) {
    return {
      migrationId: node.migrationId,
      shouldApply: false,
      riskLevel: "high",
      operations: [],
      warnings: ["检测到重叠子节点，但无法确认绝对定位/忽略自动布局属性，已跳过自动布局修复。"]
    };
  }

  const numericFields = hasContainerLayout ? [
    ["paddingTop", node.layout.paddingTop.value],
    ["paddingRight", node.layout.paddingRight.value],
    ["paddingBottom", node.layout.paddingBottom.value],
    ["paddingLeft", node.layout.paddingLeft.value],
    ["itemSpacing", node.layout.gap.value]
  ] as const : [];

  for (const [property, value] of numericFields) {
    if (hasNumber(value)) operations.push({ property, value });
    else warnings.push(`${property} 字段不可用`);
  }

  const widthMode = node.layout.widthMode.value;
  const inferredHugHeight = hasContainerLayout && node.layout.heightMode.value === null && inferHugHeight(node, context.children ?? []);
  const heightMode = inferredHugHeight ? "HUG" : node.layout.heightMode.value;

  if (hasContainerLayout && (widthMode === "HUG" || widthMode === "FIXED")) {
    operations.push({ property: sizingProperty(mode, "width"), value: widthMode === "HUG" ? "AUTO" : "FIXED" });
  }
  if (hasContainerLayout && (heightMode === "HUG" || heightMode === "FIXED")) {
    operations.push({ property: sizingProperty(mode, "height"), value: heightMode === "HUG" ? "AUTO" : "FIXED" });
    if (heightMode === "HUG" && node.rect.value && node.rect.value.height > 0) {
      operations.push({ property: "minHeight", value: node.rect.value.height });
    }
  }

  if (hasContainerLayout && node.layout.primaryAxisSizingMode?.value) {
    setOperation("primaryAxisSizingMode", node.layout.primaryAxisSizingMode.value);
  }
  if (hasContainerLayout && node.layout.counterAxisSizingMode?.value) {
    setOperation("counterAxisSizingMode", node.layout.counterAxisSizingMode.value);
  }
  if (widthMode === "FILL") operations.push({ property: "layoutSizingHorizontal", value: "FILL" });
  if (heightMode === "FILL") operations.push({ property: "layoutSizingVertical", value: "FILL" });

  const layoutAlign = node.layout.layoutAlign?.value;
  if (layoutAlign === "STRETCH" || layoutAlign === "INHERIT") {
    operations.push({ property: "layoutAlign", value: layoutAlign });
  } else if (layoutAlign) {
    warnings.push(`layoutAlign=${layoutAlign} 无法安全映射到 Figma。`);
  }
  if (typeof node.layout.layoutGrow?.value === "number") {
    operations.push({ property: "layoutGrow", value: node.layout.layoutGrow.value });
  }
  if (node.layout.positioning?.source === "native" && node.layout.positioning.value === "ABSOLUTE") {
    operations.push({ property: "layoutPositioning", value: "ABSOLUTE" });
  }

  const sizeLimits = [
    ["minWidth", node.layout.minWidth?.value],
    ["maxWidth", node.layout.maxWidth?.value],
    ["minHeight", node.layout.minHeight?.value],
    ["maxHeight", node.layout.maxHeight?.value]
  ] as const;
  for (const [property, value] of sizeLimits) {
    if (hasNumber(value)) setOperation(property, value);
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
