import { describe, expect, it } from "vitest";
import { schemaVersion, validateCapabilityReport, validateMigrationMap } from "../packages/migration-schema/src";

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
      layout: Object.fromEntries(["mode", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "gap", "widthMode", "heightMode"].map((key) => [key, { value: null, source: "unavailable" }])),
      component: { componentKey: { value: null, source: "unavailable" }, mainComponentId: { value: null, source: "unavailable" }, instanceOf: { value: null, source: "unavailable" } },
      text: { characters: { value: null, source: "unavailable" }, styleSummary: { value: null, source: "unavailable" } },
      asset: {
        svgSummary: { value: null, source: "unavailable" },
        imageFillSummary: { value: { count: 1, scaleModes: ["FILL"], opacities: [1], blendModes: ["NORMAL"], hashes: ["hash"], hasTransform: true }, source: "native" }
      },
      riskFlags: []
    };
    const map = validateMigrationMap({ schemaVersion, createdAt: new Date().toISOString(), sourceTool: "pixso", sourceEnvironment: { deployment: "private" }, exportScope: "selection", nodes: [node], warnings: [] });

    expect(map.nodes[0]?.originalIndex).toBe(7);
    expect(map.nodes[0]?.indexSource).toBe("page");
    expect(map.nodes[0]?.asset.imageFillSummary.value).toEqual(expect.objectContaining({ count: 1, hasTransform: true }));
  });
});
