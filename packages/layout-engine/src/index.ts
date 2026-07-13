import type { MigrationNode } from "@pixso-figma-migration/migration-schema";

export interface LayoutPlan {
  migrationId: string;
  shouldApply: boolean;
  operations: Array<{ property: string; value: string | number }>;
  warnings: string[];
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
      warnings: ["No recoverable auto layout mode."]
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
    else warnings.push(`${property} unavailable`);
  }

  if (node.layout.widthMode.value === "HUG") operations.push({ property: "primaryAxisSizingMode", value: "AUTO" });
  if (node.layout.heightMode.value === "HUG") operations.push({ property: "counterAxisSizingMode", value: "AUTO" });

  if (node.layout.widthMode.source === "inferred" || node.layout.heightMode.source === "inferred") {
    warnings.push("Sizing mode was inferred; verify manually.");
  }

  return {
    migrationId: node.migrationId,
    shouldApply: operations.length > 1,
    operations,
    warnings
  };
}
