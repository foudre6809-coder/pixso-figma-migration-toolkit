import { describe, expect, it } from "vitest";
import { schemaVersion, validateCapabilityReport } from "../packages/migration-schema/src";

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
