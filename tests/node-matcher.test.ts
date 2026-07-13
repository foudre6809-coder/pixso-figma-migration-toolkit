import { describe, expect, it } from "vitest";
import { native, unavailable, type MigrationNode } from "../packages/migration-schema/src";
import { matchNodes } from "../packages/node-matcher/src";
import { createLayoutPlan } from "../packages/layout-engine/src";

function node(overrides: Partial<MigrationNode> = {}): MigrationNode {
  return {
    migrationId: "pxm_button",
    name: "Button/Primary",
    type: "COMPONENT",
    path: ["Design System[0]", "Button/Primary[0]"],
    childMigrationIds: [],
    rect: native({ x: 10, y: 20, width: 120, height: 40 }),
    visible: native(true),
    layout: {
      mode: native("HORIZONTAL"),
      paddingTop: native(8),
      paddingRight: native(16),
      paddingBottom: native(8),
      paddingLeft: native(16),
      gap: native(8),
      widthMode: native("HUG"),
      heightMode: native("HUG")
    },
    component: {
      componentKey: unavailable(),
      mainComponentId: unavailable(),
      instanceOf: unavailable()
    },
    text: {
      characters: unavailable(),
      styleSummary: unavailable()
    },
    asset: {
      svgSummary: unavailable(),
      imageFillSummary: unavailable()
    },
    riskFlags: [],
    ...overrides
  };
}

describe("node matcher", () => {
  it("matches confidently when migration id is present", () => {
    const [result] = matchNodes([node()], [
      {
        id: "figma-node",
        name: "Button/Primary",
        type: "COMPONENT",
        path: ["Design System[0]", "Button/Primary[0]"],
        rect: { x: 10, y: 20, width: 120, height: 40 },
        migrationId: "pxm_button"
      }
    ]);

    expect(result.status).toBe("matched");
    expect(result.candidateId).toBe("figma-node");
  });

  it("marks close duplicate candidates as ambiguous", () => {
    const [result] = matchNodes([node()], [
      {
        id: "a",
        name: "Button/Primary",
        type: "COMPONENT",
        path: ["Design System[0]", "Button/Primary[0]"],
        rect: { x: 10, y: 20, width: 120, height: 40 }
      },
      {
        id: "b",
        name: "Button/Primary",
        type: "COMPONENT",
        path: ["Design System[0]", "Button/Primary[0]"],
        rect: { x: 10, y: 20, width: 120, height: 40 }
      }
    ]);

    expect(result.status).toBe("ambiguous");
  });
});

describe("layout engine", () => {
  it("creates Figma auto layout operations from migration data", () => {
    const plan = createLayoutPlan(node());

    expect(plan.shouldApply).toBe(true);
    expect(plan.operations).toContainEqual({ property: "layoutMode", value: "HORIZONTAL" });
    expect(plan.operations).toContainEqual({ property: "paddingRight", value: 16 });
    expect(plan.operations).toContainEqual({ property: "itemSpacing", value: 8 });
  });
});
