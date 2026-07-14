import { describe, expect, it } from "vitest";
import { native, unavailable, type MigrationNode } from "../packages/migration-schema/src";
import { assessRecoveryCompatibility, matchNodes, normalizeFlattenedRoot } from "../packages/node-matcher/src";
import { classifyBackgroundRectangle, createLayoutPlan } from "../packages/layout-engine/src";

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
    appearance: {
      fill: unavailable(),
      stroke: unavailable(),
      strokeWeight: unavailable(),
      strokeAlign: unavailable(),
      cornerRadii: unavailable()
    },
    riskFlags: [],
    ...overrides
  };
}

describe("node matcher", () => {
  it("normalizes paths and direct-child coordinates when Sketch flattens the root artboard", () => {
    const root = node({
      migrationId: "root",
      name: "Input 输入框",
      type: "FRAME",
      path: ["Input 输入框[0]"],
      rect: native({ x: -683, y: 4648, width: 1366, height: 6169 }),
      layout: { ...node().layout, mode: native("NONE") }
    });
    const child = node({
      migrationId: "child",
      name: "Rectangle Copy 6",
      type: "VECTOR",
      path: ["Input 输入框[0]", "Rectangle Copy 6[0]"],
      parentMigrationId: "root",
      rect: native({ x: 20, y: 17, width: 1326, height: 6132 })
    });

    const result = normalizeFlattenedRoot([root, child], [
      {
        id: "target",
        name: "Rectangle Copy 6",
        type: "VECTOR",
        path: ["Rectangle Copy 6[0]"],
        rect: { x: -663, y: 4665, width: 1326, height: 6132 }
      }
    ]);

    expect(result.flattenedRoot?.migrationId).toBe("root");
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].path).toEqual(["Rectangle Copy 6[0]"]);
    expect(result.nodes[0].rect.value).toEqual({ x: -663, y: 4665, width: 1326, height: 6132 });
  });

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

  it("matches a Pixso frame imported through Sketch as a Figma group", () => {
    const source = node({
      name: "InputNumber 数字输入框",
      type: "FRAME",
      path: ["InputNumber 数字输入框[0]"],
      rect: native({ x: 883, y: 4652, width: 1366, height: 2172 })
    });
    const [result] = matchNodes([source], [
      {
        id: "figma-group",
        name: "InputNumber 数字输入框",
        type: "GROUP",
        path: ["InputNumber 数字输入框"],
        rect: { x: 883, y: 4652, width: 1366, height: 2172 }
      }
    ]);

    expect(result.status).toBe("matched");
    expect(result.reasons).toEqual(expect.arrayContaining(["name", "type", "path", "rect"]));
  });

  it("matches an unknown private Pixso node from structure and geometry", () => {
    const source = node({
      name: "Rectangle Copy 6",
      type: "UNKNOWN",
      path: ["InputNumber 数字输入框[0]", "Rectangle Copy 6[0]"],
      rect: native({ x: 20, y: 17, width: 1326, height: 2130 })
    });
    const [result] = matchNodes([source], [
      {
        id: "figma-vector",
        name: "Rectangle Copy 6",
        type: "VECTOR",
        path: ["InputNumber 数字输入框", "Rectangle Copy 6"],
        rect: { x: 20, y: 17, width: 1326, height: 2130 }
      }
    ]);

    expect(result.status).toBe("matched");
    expect(result.reasons).not.toContain("type");
  });

  it("uses sibling indices to disambiguate repeated names", () => {
    const source = node({
      name: "单位",
      type: "TEXT",
      path: ["InputNumber 数字输入框[0]", "编组[10]", "单位[2]"],
      rect: native({ x: 8, y: 8, width: 28, height: 20 })
    });
    const [result] = matchNodes([source], [
      {
        id: "wrong-sibling",
        name: "单位",
        type: "TEXT",
        path: ["InputNumber 数字输入框[0]", "编组[9]", "单位[2]"],
        rect: { x: 8, y: 8, width: 28, height: 20 }
      },
      {
        id: "exact-sibling",
        name: "单位",
        type: "TEXT",
        path: ["InputNumber 数字输入框[0]", "编组[10]", "单位[2]"],
        rect: { x: 8, y: 8, width: 28, height: 20 }
      }
    ]);

    expect(result.status).toBe("matched");
    expect(result.candidateId).toBe("exact-sibling");
  });

  it("assigns candidates one-to-one and retries the remaining node", () => {
    const first = node({
      migrationId: "first",
      path: ["Design System[0]", "Button/Primary[0]"],
      rect: native({ x: 10, y: 20, width: 120, height: 40 })
    });
    const second = node({
      migrationId: "second",
      path: ["Design System[0]", "Button/Primary[1]"],
      rect: native({ x: 210, y: 20, width: 120, height: 40 })
    });
    const results = matchNodes([first, second], [
      {
        id: "candidate-first",
        name: "Button/Primary",
        type: "COMPONENT",
        path: ["Design System[0]", "Button/Primary[0]"],
        rect: { x: 10, y: 20, width: 120, height: 40 }
      },
      {
        id: "candidate-second",
        name: "Button/Primary",
        type: "COMPONENT",
        path: ["Design System[0]", "Button/Primary[1]"],
        rect: { x: 210, y: 20, width: 120, height: 40 }
      }
    ]);

    expect(results.map((result) => result.candidateId)).toEqual(["candidate-first", "candidate-second"]);
    expect(new Set(results.map((result) => result.candidateId)).size).toBe(2);
  });

  it("keeps duplicated persisted migration ids ambiguous", () => {
    const [result] = matchNodes([node()], [
      {
        id: "copy-a",
        name: "Button/Primary",
        type: "COMPONENT",
        path: ["Design System[0]", "Button/Primary[0]"],
        rect: { x: 10, y: 20, width: 120, height: 40 },
        migrationId: "pxm_button"
      },
      {
        id: "copy-b",
        name: "Button/Primary",
        type: "COMPONENT",
        path: ["Design System[0]", "Button/Primary[0]"],
        rect: { x: 10, y: 20, width: 120, height: 40 },
        migrationId: "pxm_button"
      }
    ]);

    expect(result.status).toBe("ambiguous");
  });

  it("rejects explicit incompatible node types even with identical geometry", () => {
    const [result] = matchNodes([node({ type: "TEXT" })], [
      {
        id: "wrong-type",
        name: "Button/Primary",
        type: "RECTANGLE",
        path: ["Design System[0]", "Button/Primary[0]"],
        rect: { x: 10, y: 20, width: 120, height: 40 }
      }
    ]);

    expect(result.status).toBe("unmatched");
  });
});

describe("layout engine", () => {
  const backgroundCandidate = {
    type: "RECTANGLE",
    index: 0,
    x: 0,
    y: 0,
    width: 200,
    height: 80,
    visible: true,
    isMask: false,
    rotation: 0,
    opacity: 1,
    blendMode: "NORMAL",
    hasOnlySolidFills: true
  };

  it("promotes a plain bottom rectangle that covers the group", () => {
    expect(classifyBackgroundRectangle(backgroundCandidate, 200, 80)).toBe("promote");
  });

  it("retains a full-size complex background as a child layer", () => {
    expect(classifyBackgroundRectangle({ ...backgroundCandidate, hasOnlySolidFills: false }, 200, 80)).toBe("retain");
    expect(classifyBackgroundRectangle({ ...backgroundCandidate, opacity: 0.5 }, 200, 80)).toBe("retain");
  });

  it("does not treat an inset or non-bottom rectangle as a background", () => {
    expect(classifyBackgroundRectangle({ ...backgroundCandidate, x: 8 }, 200, 80)).toBe("none");
    expect(classifyBackgroundRectangle({ ...backgroundCandidate, index: 1 }, 200, 80)).toBe("none");
  });

  it("creates Figma auto layout operations from migration data", () => {
    const plan = createLayoutPlan(node());

    expect(plan.shouldApply).toBe(true);
    expect(plan.operations).toContainEqual({ property: "layoutMode", value: "HORIZONTAL" });
    expect(plan.operations).toContainEqual({ property: "paddingRight", value: 16 });
    expect(plan.operations).toContainEqual({ property: "itemSpacing", value: 8 });
  });

  it("does not claim changes when auto layout data is unavailable", () => {
    const plan = createLayoutPlan(
      node({
        layout: {
          mode: unavailable(),
          paddingTop: unavailable(),
          paddingRight: unavailable(),
          paddingBottom: unavailable(),
          paddingLeft: unavailable(),
          gap: unavailable(),
          widthMode: unavailable(),
          heightMode: unavailable()
        }
      })
    );

    expect(plan.shouldApply).toBe(false);
    expect(plan.operations).toEqual([]);
  });

  it("applies a recoverable layout direction even when spacing is unavailable", () => {
    const plan = createLayoutPlan(
      node({
        layout: {
          mode: native("HORIZONTAL"),
          paddingTop: unavailable(),
          paddingRight: unavailable(),
          paddingBottom: unavailable(),
          paddingLeft: unavailable(),
          gap: unavailable(),
          widthMode: unavailable(),
          heightMode: unavailable()
        }
      })
    );

    expect(plan.shouldApply).toBe(true);
    expect(plan.operations).toEqual([{ property: "layoutMode", value: "HORIZONTAL" }]);
  });

  it("maps inferred hug height to the primary axis for vertical layouts", () => {
    const plan = createLayoutPlan(node({
      type: "INSTANCE",
      rect: native({ x: 0, y: 0, width: 230, height: 58 }),
      layout: {
        mode: native("VERTICAL"), paddingTop: native(0), paddingRight: native(0), paddingBottom: native(0), paddingLeft: native(0),
        gap: native(4), widthMode: unavailable(), heightMode: unavailable()
      }
    }), {
      children: [
        node({ migrationId: "child-a", rect: native({ x: 0, y: 0, width: 230, height: 36 }) }),
        node({ migrationId: "child-b", rect: native({ x: 0, y: 40, width: 108, height: 17 }) })
      ]
    });

    expect(plan.operations).toContainEqual({ property: "primaryAxisSizingMode", value: "AUTO" });
    expect(plan.operations).toContainEqual({ property: "minHeight", value: 58 });
  });

  it("maps inferred hug height to the counter axis for horizontal layouts", () => {
    const plan = createLayoutPlan(node({
      type: "FRAME",
      rect: native({ x: 0, y: 0, width: 344, height: 36 }),
      layout: {
        mode: native("HORIZONTAL"), paddingTop: native(7), paddingRight: native(12), paddingBottom: native(7), paddingLeft: native(12),
        gap: native(12), widthMode: unavailable(), heightMode: unavailable()
      }
    }), {
      children: [node({ migrationId: "child", rect: native({ x: 12, y: 7, width: 320, height: 22 }) })]
    });

    expect(plan.operations).toContainEqual({ property: "counterAxisSizingMode", value: "AUTO" });
    expect(plan.operations).toContainEqual({ property: "minHeight", value: 36 });
  });
});

describe("recovery diagnostics", () => {
  it("blocks unsafe component conversion to an incompatible node", () => {
    const issues = assessRecoveryCompatibility(node(), { type: "VECTOR" });

    expect(issues).toContainEqual(expect.objectContaining({ code: "component-type-mismatch", severity: "error" }));
  });

  it("allows layout-only recovery when a component imports as a group", () => {
    const issues = assessRecoveryCompatibility(node(), { type: "GROUP" });

    expect(issues).toContainEqual(expect.objectContaining({ code: "component-link-lost", severity: "warning" }));
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
