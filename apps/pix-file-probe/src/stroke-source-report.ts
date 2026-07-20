import type { StrokeSourceReport } from "./stroke-source-analysis.js";

export function renderStrokeSourceMarkdown(report: StrokeSourceReport): string {
  return `# PIX stroke source provenance differential report

> Source .pix files stayed local. This report contains synthetic sample names, decoded field paths, value summaries, and record offsets only.

## Conclusion

- Status: **${report.conclusion.status}**
- Samples used: ${report.sampleCount}
- Missing samples: ${report.missingSamples.length ? report.missingSamples.join(", ") : "none"}
- Reason: ${report.conclusion.reason}
- General .pix parsing support claimed: **no**

## Integrity

| Check | Result |
| --- | --- |
| Decode/re-encode samples | ${report.integrity.decodedSamples}/${report.sampleCount} |
| Stable target GUID | ${yes(report.integrity.targetGuidStable)} |
| Stable target identity | ${yes(report.integrity.targetIdentityStable)} |
| Stable node count | ${yes(report.integrity.nodeCountStable)} |
| Unexpected decoded changes | ${report.integrity.unexpectedDecodedChanges.length ? cell(report.integrity.unexpectedDecodedChanges.join("; ")) : "none"} |

## Sample Summary

| Sample | Expected source | GUID | Nodes | Record offset | Visible stroke |
| --- | --- | --- | ---: | ---: | --- |
${report.samples.map((sample) => `| ${sample.sample} | ${sample.expectedSource} | ${sample.targetGuid ?? "n/a"} | ${sample.nodeCount} | ${sample.recordOffset ?? -1} | ${cell(JSON.stringify(sample.visibleStroke))} |`).join("\n")}

## Source Evidence

| Source | Status | Identity candidate paths | Value paths | Samples |
| --- | --- | --- | --- | --- |
| Shared style | ${report.styleReference.status} | ${paths(report.styleReference.candidateIdentityFieldPaths)} | ${paths(report.styleReference.valueFieldPaths)} | ${report.styleReference.samples.join(", ")} |
| Variable binding | ${report.variableBinding.status} | ${paths(report.variableBinding.candidateIdentityFieldPaths)} | ${paths(report.variableBinding.valueFieldPaths)} | ${report.variableBinding.samples.join(", ")} |

## Evidence Chains

Style:

${report.styleReference.evidenceChains.map((item) => `- ${item}`).join("\n")}

${limits(report.styleReference.limitations)}

Variable:

${report.variableBinding.evidenceChains.map((item) => `- ${item}`).join("\n")}

${limits(report.variableBinding.limitations)}

## Complete Decoded-Node Structured Diffs

${report.completeDecodedNodeDiffs.map(renderPairDiff).join("\n\n")}

## Parser Boundary

The parser keeps \`attributes.stroke\` as resolved visible appearance only. Source provenance is research diagnostics only, and this report does not make the production parser emit unconfirmed style or variable binding fields.
`;
}

function renderPairDiff(diff: StrokeSourceReport["completeDecodedNodeDiffs"][number]): string {
  const rows = diff.changedFields.map((field) =>
    `| ${field.path} | \`${cell(JSON.stringify(field.left))}\` | \`${cell(JSON.stringify(field.right))}\` |`
  ).join("\n");
  return `### ${diff.leftSample} -> ${diff.rightSample}

Changed fields: ${diff.changedFieldCount}

| Field path | Left | Right |
| --- | --- | --- |
${rows || "| none | `null` | `null` |"}`;
}

function paths(items: string[]): string {
  return items.length ? items.map((item) => `\`${item}\``).join(", ") : "none";
}

function limits(items: string[]): string {
  return items.length ? `Limitations:\n\n${items.map((item) => `- ${item}`).join("\n")}` : "Limitations: none";
}

function yes(value: boolean): string {
  return value ? "yes" : "no";
}

function cell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
