import type { MigrationNode } from "@pixso-figma-migration/migration-schema";

export interface LayoutPlan {
  migrationId: string;
  shouldApply: boolean;
  operations: Array<{ property: string; value: string | number }>;
  warnings: string[];
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

export function createLayoutPlan(node: MigrationNode): LayoutPlan {
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

  if (node.layout.widthMode.value === "HUG") operations.push({ property: "primaryAxisSizingMode", value: "AUTO" });
  if (node.layout.heightMode.value === "HUG") operations.push({ property: "counterAxisSizingMode", value: "AUTO" });

  if (node.layout.widthMode.source === "inferred" || node.layout.heightMode.source === "inferred") {
    warnings.push("尺寸模式来自推断，请人工确认。")
  }

  return {
    migrationId: node.migrationId,
    shouldApply: operations.length > 0,
    operations,
    warnings
  };
}
