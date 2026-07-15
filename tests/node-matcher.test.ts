import { describe, expect, it } from "vitest";
import { native, unavailable, type MigrationNode } from "../packages/migration-schema/src";
import {
  assessRecoveryCompatibility,
  canSafelyRebuildMainComponent,
  createSafeGeometryRestorePlan,
  isHighConfidenceUniqueMatch,
  matchNodes,
  normalizeFlattenedRoot
} from "../packages/node-matcher/src";
import {
  classifyApplyFailureStatus,
  classifyPreviewStatus,
  classifyBackgroundRectangle,
  assessStructureMatch,
  createLayoutPlan,
  createAppearanceRecoveryPlan,
  shouldWriteReferencedStrokeValue,
  selectSafeLayoutOperations,
  createOperationExecutionPlan,
  createRepairSafetyPolicy,
  hasDirectSolidAppearance,
  protectAbsoluteChildrenBeforeLayout,
  protectRetainedBackgroundBeforeLayout,
  requiresLaunchSelection
} from "../packages/layout-engine/src";

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
      heightMode: native("HUG"),
      positioning: unavailable(),
      layoutAlign: unavailable(),
      layoutGrow: unavailable()
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

  it("only accepts unique high-confidence matches for component rebuilding", () => {
    const confident = {
      migrationId: "source",
      candidateId: "candidate",
      score: 0.9,
      status: "matched" as const,
      reasons: ["name", "type", "rect"]
    };
    expect(isHighConfidenceUniqueMatch(confident)).toBe(true);
    expect(canSafelyRebuildMainComponent("COMPONENT", "FRAME", confident)).toBe(true);
    expect(canSafelyRebuildMainComponent("INSTANCE", "FRAME", confident)).toBe(false);
    expect(canSafelyRebuildMainComponent("COMPONENT", "GROUP", confident)).toBe(false);
    expect(canSafelyRebuildMainComponent("COMPONENT", "FRAME", confident, true)).toBe(false);
    expect(isHighConfidenceUniqueMatch({
      migrationId: "source",
      candidateId: "candidate",
      score: 0.79,
      status: "matched",
      reasons: ["name", "type", "rect"]
    })).toBe(false);
    expect(isHighConfidenceUniqueMatch({
      migrationId: "source",
      candidateId: "candidate",
      score: 1,
      status: "ambiguous",
      reasons: ["migrationId"]
    })).toBe(false);
  });

  it("restores only the root size and keeps its canvas position", () => {
    const source = node({ rect: native({ x: -9904, y: -8545, width: 1366, height: 6169 }) });
    const plan = createSafeGeometryRestorePlan(
      source,
      undefined,
      { migrationId: source.migrationId, candidateId: "root", score: 0.9, status: "matched", reasons: ["name", "type", "path"] },
      { x: -663, y: 4665, width: 1326, height: 6132 },
      { parentCandidateMatched: false, coordinates: "local", canResizeRoot: true }
    );

    expect(plan).toEqual({ width: 1366, height: 6169 });
  });

  it("restores local position only under the matched static parent", () => {
    const parent = node({ migrationId: "parent", layout: { ...node().layout, mode: native("NONE") } });
    const child = node({ parentMigrationId: "parent", rect: native({ x: 20, y: 17, width: 1326, height: 6132 }) });
    const match = {
      migrationId: child.migrationId,
      candidateId: "child",
      score: 0.9,
      status: "matched" as const,
      reasons: ["name", "type", "path"]
    };

    expect(
      createSafeGeometryRestorePlan(child, parent, match, { x: 0, y: 0, width: 1326, height: 6132 }, {
        parentCandidateMatched: true,
        coordinates: "local",
        canResizeRoot: true
      })
    ).toEqual({ x: 20, y: 17 });
    expect(
      createSafeGeometryRestorePlan(child, parent, match, { x: 0, y: 0, width: 1326, height: 6132 }, {
        parentCandidateMatched: false,
        coordinates: "local",
        canResizeRoot: true
      })
    ).toBeUndefined();
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

  it("sets a retained background absolute before layout and preserves its position", () => {
    const events: string[] = [];
    let positioning: "AUTO" | "ABSOLUTE" = "AUTO";
    const background = {
      x: 12,
      y: 7,
      get layoutPositioning() {
        return positioning;
      },
      set layoutPositioning(value: "AUTO" | "ABSOLUTE") {
        positioning = value;
        events.push(`positioning:${value}`);
      }
    };

    protectRetainedBackgroundBeforeLayout(background, () => {
      events.push("layoutMode");
      if (background.layoutPositioning !== "ABSOLUTE") {
        background.x += 100;
        background.y += 100;
      }
    });

    expect(events).toEqual(["positioning:ABSOLUTE", "layoutMode", "positioning:ABSOLUTE"]);
    expect({ x: background.x, y: background.y }).toEqual({ x: 12, y: 7 });
  });

  it("reapplies absolute positioning after layout when the runtime ignores the first write", () => {
    const events: string[] = [];
    let layoutEnabled = false;
    let positioning: "AUTO" | "ABSOLUTE" = "AUTO";
    const background = {
      x: 12,
      y: 7,
      get layoutPositioning() {
        return positioning;
      },
      set layoutPositioning(value: "AUTO" | "ABSOLUTE") {
        events.push(`positioning:${value}`);
        if (layoutEnabled) positioning = value;
      }
    };

    protectRetainedBackgroundBeforeLayout(background, () => {
      events.push("layoutMode");
      layoutEnabled = true;
      background.x += 100;
      background.y += 100;
    });

    expect(events).toEqual(["positioning:ABSOLUTE", "layoutMode", "positioning:ABSOLUTE"]);
    expect(background.layoutPositioning).toBe("ABSOLUTE");
    expect({ x: background.x, y: background.y }).toEqual({ x: 12, y: 7 });
  });

  it("creates Figma auto layout operations from migration data", () => {
    const plan = createLayoutPlan(node());

    expect(plan.shouldApply).toBe(true);
    expect(plan.operations).toContainEqual({ property: "layoutMode", value: "HORIZONTAL" });
    expect(plan.operations).toContainEqual({ property: "paddingRight", value: 16 });
    expect(plan.operations).toContainEqual({ property: "itemSpacing", value: 8 });
  });

  it("does not count a preview node without planned changes as will-modify", () => {
    expect(classifyPreviewStatus({ plannedChanges: 0, needsReview: false, blocked: false })).toBe("verified");
    expect(classifyPreviewStatus({ plannedChanges: 1, needsReview: false, blocked: false })).toBe("modified");
    expect(classifyPreviewStatus({ plannedChanges: 1, needsReview: true, blocked: false })).toBe("partial");
    expect(classifyPreviewStatus({ plannedChanges: 1, needsReview: false, blocked: true })).toBe("failed");
  });

  it("reports a later failure as partial after earlier changes were applied", () => {
    expect(classifyApplyFailureStatus(2)).toBe("partial");
    expect(classifyApplyFailureStatus(0)).toBe("failed");
  });

  it("requires an explicit launch selection for selection and artboard maps", () => {
    expect(requiresLaunchSelection("selection")).toBe(true);
    expect(requiresLaunchSelection("artboard")).toBe(true);
    expect(requiresLaunchSelection("page")).toBe(false);
  });

  it("does not treat an empty instance wrapper as recoverable appearance", () => {
    const wrapper = node({
      type: "INSTANCE",
      appearance: {
        fill: native(null),
        stroke: native(null),
        strokeWeight: native(1),
        strokeAlign: native("INSIDE"),
        cornerRadii: native([0, 0, 0, 0])
      }
    });
    expect(hasDirectSolidAppearance(wrapper)).toBe(false);
    expect(
      hasDirectSolidAppearance(
        node({
          type: "FRAME",
          appearance: {
            fill: native({ color: { r: 1, g: 1, b: 1 }, opacity: 1 }),
            stroke: native({ color: { r: 0.8, g: 0.82, b: 0.89 }, opacity: 1 }),
            strokeWeight: native(1),
            strokeAlign: native("INSIDE"),
            cornerRadii: native([4, 4, 4, 4])
          }
        })
      )
    ).toBe(true);
  });

  it("keeps complete solid stroke values recoverable when style and variable metadata exist", () => {
    const source = node({
      appearance: {
        fill: native({ color: { r: 1, g: 1, b: 1 }, opacity: 1 }),
        stroke: native({ color: { r: 0.7, g: 0.75, b: 0.85 }, opacity: 0.8 }),
        strokeWeight: native(1),
        strokeAlign: native("INSIDE"),
        cornerRadii: native([4, 4, 4, 4]),
        opacity: native(0.9),
        strokeSummary: native({
          count: 1,
          paintTypes: ["SOLID"],
          opacities: [0.8],
          styleId: "pixso-style",
          styleName: "Input/Border",
          isMixed: false,
          hasGradient: false,
          hasVariableReference: true,
          boundVariables: { color: ["pixso-border-color"] },
          paintStyleIds: [],
          completeSingleSolid: true
        })
      }
    });

    expect(createAppearanceRecoveryPlan(source)).toEqual({
      fill: true,
      stroke: true,
      strokeWeight: true,
      strokeAlign: true,
      cornerRadii: true,
      opacity: true
    });
  });

  it("keeps incomplete gradient stroke diagnostic-only", () => {
    const source = node({
      appearance: {
        ...node().appearance,
        stroke: unavailable("渐变描边仅诊断"),
        strokeSummary: native({
          count: 1,
          paintTypes: ["GRADIENT_LINEAR"],
          opacities: [1],
          styleId: null,
          styleName: null,
          isMixed: false,
          hasGradient: true,
          hasVariableReference: false,
          boundVariables: {},
          paintStyleIds: [],
          completeSingleSolid: false
        })
      }
    });

    expect(createAppearanceRecoveryPlan(source).stroke).toBe(false);
  });

  it("preserves an existing Figma binding when the Pixso stroke also has a reference", () => {
    expect(shouldWriteReferencedStrokeValue(true, true)).toBe(false);
    expect(shouldWriteReferencedStrokeValue(true, false)).toBe(true);
    expect(shouldWriteReferencedStrokeValue(false, true)).toBe(true);
  });

  it("keeps safe appearance work enabled when layout is high risk", () => {
    expect(
      createOperationExecutionPlan({ layoutRequested: true, layoutRisk: "high", appearanceSafe: true, componentSafe: false })
    ).toEqual({ applyLayout: false, applyAppearance: true, applyComponent: false, needsReview: true });
  });

  it("keeps safe component rebuilding enabled when layout is high risk", () => {
    expect(
      createOperationExecutionPlan({ layoutRequested: true, layoutRisk: "high", appearanceSafe: false, componentSafe: true })
    ).toEqual({ applyLayout: false, applyAppearance: false, applyComponent: true, needsReview: true });
  });

  it("default conservative repair never enables root resize or child position writes", () => {
    const policy = createRepairSafetyPolicy("conservative", true);
    expect(policy.applyGeometry).toBe(false);
    expect(policy.applyLayout).toBe(false);
    expect(policy.convertGroup).toBe(false);
    expect(policy.rebuildComponent).toBe(false);
    expect(policy.applyAppearance).toBe(true);
  });

  it("diagnostic mode performs no writes", () => {
    expect(Object.values(createRepairSafetyPolicy("diagnostic", true)).some(Boolean)).toBe(false);
  });

  it("requires an explicit experimental switch before structural geometry writes", () => {
    expect(createRepairSafetyPolicy("structural").applyGeometry).toBe(false);
    expect(createRepairSafetyPolicy("structural", true).applyGeometry).toBe(true);
  });

  function safeStructure(overrides = {}) {
    return assessStructureMatch({
      parentMatchHighConfidence: true,
      sourceChildCount: 10,
      targetChildCount: 10,
      matchedChildCount: 10,
      orderConsistency: 1,
      hasMask: false,
      hasBooleanDependency: false,
      hasRotation: false,
      hasComplexTransform: false,
      hasUnknownAbsolute: false,
      hasOverlap: false,
      sourceWidth: 200,
      sourceHeight: 40,
      targetWidth: 200,
      targetHeight: 40,
      geometryWriteRequired: false,
      externalBoundsStable: true,
      ...overrides
    });
  }

  it("does not apply auto layout when child counts differ", () => {
    expect(safeStructure({ targetChildCount: 9 }).eligibleForAutoLayout).toBe(false);
  });

  it("does not apply auto layout below a 90 percent child match", () => {
    expect(safeStructure({ matchedChildCount: 8 }).eligibleForAutoLayout).toBe(false);
  });

  it("does not convert a Group containing a mask", () => {
    expect(safeStructure({ hasMask: true }).eligibleForGroupConversion).toBe(false);
  });

  it("does not permit structure writes when geometry correction would be required", () => {
    const assessment = safeStructure({ geometryWriteRequired: true, externalBoundsStable: false });
    expect(assessment.eligibleForAutoLayout).toBe(false);
    expect(assessment.eligibleForGroupConversion).toBe(false);
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

  it("does not flag missing auto layout on drawing nodes as a partial failure", () => {
    const base = node();
    const plan = createLayoutPlan(
      node({
        type: "VECTOR",
        layout: {
          ...base.layout,
          mode: unavailable()
        }
      })
    );

    expect(plan.shouldApply).toBe(false);
    expect(plan.warnings).toEqual([]);
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

  it("skips auto layout when overlapping children have unknown positioning", () => {
    const plan = createLayoutPlan(node(), {
      children: [
        node({ migrationId: "a", rect: native({ x: 0, y: 0, width: 100, height: 40 }) }),
        node({ migrationId: "b", rect: native({ x: 20, y: 10, width: 100, height: 40 }) })
      ]
    });

    expect(plan.shouldApply).toBe(false);
    expect(plan.riskLevel).toBe("high");
    expect(plan.warnings.join(" ")).toContain("重叠子节点");
  });

  it("allows known absolute children to be protected during structural layout", () => {
    const absoluteLayout = { ...node().layout, positioning: native("ABSOLUTE" as const) };
    const plan = createLayoutPlan(node(), {
      children: [
        node({ migrationId: "a", rect: native({ x: 0, y: 0, width: 100, height: 40 }), layout: absoluteLayout }),
        node({ migrationId: "b", rect: native({ x: 20, y: 10, width: 100, height: 40 }), layout: absoluteLayout })
      ]
    });

    expect(plan.shouldApply).toBe(true);
    expect(plan.riskLevel).toBe("low");
  });

  it("plans child alignment, growth, fill sizing, absolute positioning and min-max sizes", () => {
    const plan = createLayoutPlan(
      node({
        type: "FRAME",
        layout: {
          ...node().layout,
          mode: native("NONE"),
          widthMode: native("FILL"),
          heightMode: native("FILL"),
          positioning: native("ABSOLUTE"),
          layoutAlign: native("STRETCH"),
          layoutGrow: native(1),
          minWidth: native(120),
          maxWidth: native(480),
          minHeight: native(36),
          maxHeight: native(72)
        }
      })
    );

    expect(plan.operations).toEqual(expect.arrayContaining([
      { property: "layoutSizingHorizontal", value: "FILL" },
      { property: "layoutSizingVertical", value: "FILL" },
      { property: "layoutAlign", value: "STRETCH" },
      { property: "layoutGrow", value: 1 },
      { property: "layoutPositioning", value: "ABSOLUTE" },
      { property: "minWidth", value: 120 },
      { property: "maxWidth", value: 480 },
      { property: "minHeight", value: 36 },
      { property: "maxHeight", value: 72 }
    ]));
    expect(plan.operations.some((operation) => operation.property === "layoutMode")).toBe(false);
  });

  it("gates container operations by self structure and item operations by parent structure", () => {
    const operations = [
      { property: "layoutMode", value: "HORIZONTAL" },
      { property: "paddingLeft", value: 12 },
      { property: "layoutSizingHorizontal", value: "FILL" },
      { property: "layoutGrow", value: 1 }
    ];
    expect(selectSafeLayoutOperations(operations, true, false)).toEqual({
      allowed: operations.slice(0, 2),
      skippedContainerCount: 0,
      skippedItemCount: 2,
      itemOperationCount: 2
    });
    expect(selectSafeLayoutOperations(operations, false, true)).toEqual({
      allowed: operations.slice(2),
      skippedContainerCount: 2,
      skippedItemCount: 0,
      itemOperationCount: 2
    });
  });

  it("protects explicit absolute children without replacing their current coordinates", () => {
    const children = [
      { x: 17, y: 9, layoutPositioning: "AUTO" as "AUTO" | "ABSOLUTE" },
      { x: 81, y: 13, layoutPositioning: "AUTO" as "AUTO" | "ABSOLUTE" }
    ];
    protectAbsoluteChildrenBeforeLayout(children, () => {
      children.forEach((child) => {
        child.x += 100;
        child.y += 100;
      });
    });

    expect(children).toEqual([
      { x: 17, y: 9, layoutPositioning: "ABSOLUTE" },
      { x: 81, y: 13, layoutPositioning: "ABSOLUTE" }
    ]);
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
