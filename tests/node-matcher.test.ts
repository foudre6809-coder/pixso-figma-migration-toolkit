import { describe, expect, it } from "vitest";
import { native, unavailable, type MigrationNode } from "../packages/migration-schema/src";
import { assessRecoveryCompatibility, matchNodes } from "../packages/node-matcher/src";
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

  it("matches indexed Pixso paths to Sketch-imported Figma paths", () => {
    const [result] = matchNodes([node()], [
      {
        id: "figma-node",
        name: "Button/Primary",
        type: "COMPONENT",
        path: ["Design System", "Button/Primary"],
        rect: { x: 10, y: 20, width: 120, height: 40 }
      }
    ]);

    expect(result.status).toBe("matched");
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

describe("recovery diagnostics", () => {
  it("blocks unsafe component conversion", () => {
    const issues = assessRecoveryCompatibility(node(), { type: "FRAME" });

    expect(issues).toContainEqual(expect.objectContaining({ code: "component-type-mismatch", severity: "error" }));
  });

  it("reports an instance whose main component cannot be verified", () => {
    const source = node({
      type: "INSTANCE",
      component: { componentKey: unavailable(), mainComponentId: unavailable(), instanceOf: native("Button/Primary") }
    });
    const issues = assessRecoveryCompatibility(source, { type: "INSTANCE", mainComponentName: "Button/Secondary" });

    expect(issues).toContainEqual(expect.objectContaining({ code: "instance-rebind-required", severity: "warning" }));
  });

  it("reports text and size differences", () => {
    const source = node({ type: "TEXT", text: { characters: native("Save"), styleSummary: unavailable() } });
    const issues = assessRecoveryCompatibility(source, {
      type: "TEXT",
      textCharacters: "Submit",
      rect: { x: 10, y: 20, width: 80, height: 40 }
    });

    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["text-content-mismatch", "size-mismatch"]));
  });
});
