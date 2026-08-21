import { describe, expect, it } from "vitest";
import { StrokePaintSummarySchema, schemaVersion, validateCapabilityReport, validateMigrationMap } from "../packages/migration-schema/src";

describe("capability report schema", () => {
  it("keeps old capability reports compatible", () => {
    const report = validateCapabilityReport({
      schemaVersion,
      createdAt: "2026-07-14T00:00:00.000Z",
      sourceTool: "pixso",
      checkedNodeCount: 1,
      availableFields: ["layoutMode"],
      unavailableFields: [],
      notes: []
    });

    expect(report.nodeTypeCounts).toEqual({});
    expect(report.fieldCoverage).toEqual([]);
  });

  it("accepts recursive field coverage and safe sample values", () => {
    const report = validateCapabilityReport({
      schemaVersion,
      createdAt: "2026-07-14T00:00:00.000Z",
      sourceTool: "pixso",
      checkedNodeCount: 12,
      checkedRootCount: 1,
      availableFields: ["layoutMode"],
      unavailableFields: [],
      nodeTypeCounts: { FRAME: 2, TEXT: 10 },
      fieldCoverage: [
        { field: "layoutMode", availableCount: 2, unavailableCount: 10, sampleValues: ["HORIZONTAL", "NONE"] }
      ],
      notes: []
    });

    expect(report.fieldCoverage[0]?.sampleValues).toEqual(["HORIZONTAL", "NONE"]);
  });
});

describe("migration appearance schema", () => {
  it("keeps older stroke summaries compatible while defaulting new reference metadata", () => {
    const summary = StrokePaintSummarySchema.parse({
      count: 1,
      paintTypes: ["SOLID"],
      opacities: [1],
      styleId: null,
      styleName: null,
      isMixed: false,
      hasGradient: false,
      hasVariableReference: false,
      completeSingleSolid: true
    });
    expect(summary.boundVariables).toEqual({});
    expect(summary.paintStyleIds).toEqual([]);
  });

  it("keeps migration maps without appearance fields compatible", () => {
    const node = {
      migrationId: "node", name: "Frame", type: "FRAME", path: ["Frame[0]"], childMigrationIds: [],
      rect: { value: { x: 0, y: 0, width: 100, height: 40 }, source: "native" }, visible: { value: true, source: "native" },
      layout: Object.fromEntries(["mode", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "gap", "widthMode", "heightMode"].map((key) => [key, { value: null, source: "unavailable" }])),
      component: { componentKey: { value: null, source: "unavailable" }, mainComponentId: { value: null, source: "unavailable" }, instanceOf: { value: null, source: "unavailable" } },
      text: { characters: { value: null, source: "unavailable" }, styleSummary: { value: null, source: "unavailable" } },
      asset: { svgSummary: { value: null, source: "unavailable" }, imageFillSummary: { value: null, source: "unavailable" } }, riskFlags: []
    };
    const map = validateMigrationMap({ schemaVersion, createdAt: new Date().toISOString(), sourceTool: "pixso", sourceEnvironment: { deployment: "private" }, exportScope: "selection", nodes: [node], warnings: [] });
    expect(map.nodes[0]?.appearance.fill.source).toBe("unavailable");
    expect(map.nodes[0]?.layout.positioning.source).toBe("unavailable");
    expect(() =>
      validateMigrationMap({
        schemaVersion,
        createdAt: new Date().toISOString(),
        sourceTool: "pixso",
        sourceEnvironment: { deployment: "private" },
        exportScope: "selection",
        nodes: [node, { ...node }],
        warnings: []
      })
    ).toThrow(/迁移标识重复/);
  });

  it("accepts original root indices and structured image summaries", () => {
    const node = {
      migrationId: "image", originalIndex: 7, indexSource: "page", name: "Image", type: "IMAGE", path: ["Image[7]"], childMigrationIds: [],
      rect: { value: { x: 0, y: 0, width: 100, height: 40 }, source: "native" }, visible: { value: true, source: "native" },
      layout: {
        ...Object.fromEntries(["mode", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "gap", "widthMode", "heightMode"].map((key) => [key, { value: null, source: "unavailable" }])),
        layoutAlign: { value: "STRETCH", source: "native" },
        layoutGrow: { value: 1, source: "native" },
        positioning: { value: "ABSOLUTE", source: "native" },
        primaryAxisSizingMode: { value: "AUTO", source: "native" },
        counterAxisSizingMode: { value: "FIXED", source: "native" },
        minWidth: { value: 100, source: "native" },
        maxWidth: { value: 400, source: "native" },
        minHeight: { value: 36, source: "native" },
        maxHeight: { value: 72, source: "native" }
      },
      component: { componentKey: { value: null, source: "unavailable" }, mainComponentId: { value: null, source: "unavailable" }, instanceOf: { value: null, source: "unavailable" } },
      text: { characters: { value: null, source: "unavailable" }, styleSummary: { value: null, source: "unavailable" } },
      asset: {
        svgSummary: { value: null, source: "unavailable" },
        imageFillSummary: { value: { count: 1, scaleModes: ["FILL"], opacities: [1], blendModes: ["NORMAL"], hashes: ["hash"], hasTransform: true }, source: "native" }
      },
      appearance: {
        fill: { value: null, source: "native" },
        stroke: { value: { color: { r: 0.5, g: 0.6, b: 0.7 }, opacity: 0.8 }, source: "native" },
        strokeWeight: { value: 1, source: "native" },
        strokeAlign: { value: "INSIDE", source: "native" },
        cornerRadii: { value: [4, 4, 4, 4], source: "native" },
        opacity: { value: 0.9, source: "native" },
        strokeSummary: {
          value: {
            count: 1,
            paintTypes: ["SOLID"],
            opacities: [0.8],
            styleId: "style-id",
            styleName: "Input/Border",
            isMixed: false,
            hasGradient: false,
            hasVariableReference: true,
            boundVariables: { color: ["border-color"] },
            paintStyleIds: ["paint-style"],
            completeSingleSolid: true
          },
          source: "native"
        }
      },
      riskFlags: []
    };
    const map = validateMigrationMap({ schemaVersion, createdAt: new Date().toISOString(), sourceTool: "pixso", sourceEnvironment: { deployment: "private" }, exportScope: "selection", nodes: [node], warnings: [] });

    expect(map.nodes[0]?.originalIndex).toBe(7);
    expect(map.nodes[0]?.indexSource).toBe("page");
    expect(map.nodes[0]?.asset.imageFillSummary.value).toEqual(expect.objectContaining({ count: 1, hasTransform: true }));
    expect(map.nodes[0]?.layout).toEqual(expect.objectContaining({ minWidth: { value: 100, source: "native" } }));
    expect(map.nodes[0]?.appearance.strokeSummary?.value).toEqual(expect.objectContaining({
      styleName: "Input/Border",
      boundVariables: { color: ["border-color"] },
      completeSingleSolid: true
    }));
  });
});
