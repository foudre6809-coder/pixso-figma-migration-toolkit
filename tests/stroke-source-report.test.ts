import { describe, expect, it } from "vitest";
import { renderStrokeSourceMarkdown } from "../apps/pix-file-probe/src/stroke-source-report";
import type { StrokeSourceReport } from "../apps/pix-file-probe/src/stroke-source-analysis";

describe("stroke source provenance report", () => {
  it("renders a FIX boundary without claiming parser source support", () => {
    const report: StrokeSourceReport = {
      schemaVersion: 1,
      generatedAt: "2026-07-20T00:00:00.000Z",
      privacy: { localOnly: true, pathsRedacted: true, realFilesCommitted: false },
      sampleCount: 3,
      requiredSamples: ["stroke-inline-variable-value.pix", "stroke-variable-bound.pix", "stroke-variable-value-b.pix"],
      missingSamples: ["stroke-variable-value-b.pix"],
      integrity: {
        decodedSamples: 3,
        targetGuidStable: true,
        targetIdentityStable: true,
        nodeCountStable: false,
        unexpectedDecodedChanges: []
      },
      samples: [{
        sample: "stroke-variable-bound.pix",
        decoded: true,
        targetName: "StrokeTarget",
        targetType: "RECTANGLE",
        targetGuid: "22:1",
        nodeCount: 15,
        recordOffset: 783,
        visibleStroke: { weight: 2, align: "INSIDE", color: "#3366FF" },
        expectedSource: "variable-bound"
      }],
      completeDecodedNodeDiffs: [{
        leftSample: "stroke-inline-variable-value.pix",
        rightSample: "stroke-variable-bound.pix",
        changedFieldCount: 1,
        changedFields: [{
          path: "strokePaints[0].colorVar.value.alias.guid.localID",
          left: null,
          right: 3
        }]
      }],
      styleReference: {
        status: "confirmed",
        candidateIdentityFieldPaths: ["inheritStrokeStyleID.sessionID", "inheritStrokeStyleID.localID"],
        valueFieldPaths: [],
        samples: ["stroke-style-blue.pix"],
        evidenceChains: ["inline -> style introduces stable non-appearance fields"],
        limitations: ["Shared style definition value storage remains not-found."]
      },
      variableBinding: {
        status: "inferred",
        candidateIdentityFieldPaths: ["strokePaints[0].colorVar.value.alias.guid.localID"],
        valueFieldPaths: [],
        samples: ["stroke-variable-bound.pix"],
        evidenceChains: ["variable detached and value B samples are required"],
        limitations: ["Missing variable samples: stroke-variable-value-b.pix"]
      },
      parserBoundary: {
        attributesStrokeResolvedAppearanceOnly: true,
        sourceFieldsInDiagnosticsOnly: true,
        parserSourceOutputChanged: false
      },
      conclusion: {
        status: "FIX",
        reason: "At least one stroke source chain has evidence, but the matrix is incomplete."
      }
    };

    const markdown = renderStrokeSourceMarkdown(report);
    expect(markdown).toContain("Status: **FIX**");
    expect(markdown).toContain("strokePaints[0].colorVar.value.alias.guid.localID");
    expect(markdown).toContain("The parser keeps `attributes.stroke` as resolved visible appearance only.");
    expect(markdown).toContain("General .pix parsing support claimed: **no**");
  });
});
