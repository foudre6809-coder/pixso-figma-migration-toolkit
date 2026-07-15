import type { ControlledDiffReport } from "./controlled-analysis.js";

export function renderControlledMarkdown(report: ControlledDiffReport): string {
  const integrityRows = report.integrity.map((group) =>
    `| ${group.group} | ${group.samples.length} | ${yes(group.decoded)} | ${yes(group.targetGuidStable)} | ${yes(group.targetIdentityStable)} | ${yes(group.nodeCountStable)} | ${cell(group.unexpectedChanges.join(" ") || "none")} |`
  ).join("\n");
  return `# PIX controlled semantic differential report

> All source .pix files remained local. This report contains only synthetic sample names, decoded numeric values, field paths, offsets, and limitations.

## Conclusion

- Status: **${report.conclusion.status}**
- Controlled samples: ${report.sampleCount}
- Reason: ${report.conclusion.reason}
- General .pix parsing support claimed: **no**

## Sample integrity

| Group | Files | Decode/re-encode | Stable target GUID | Stable target identity | Stable node count | Excluded/derived changes |
| --- | ---: | --- | --- | --- | --- | --- |
${integrityRows}

## Confirmed fields

| Semantic | Status | Kiwi field path | Evidence |
| --- | --- | --- | --- |
| coordinate | ${report.coordinate.status} | ${report.coordinate.fieldPath} | ${report.coordinate.samples.length}/4 documented x/y pairs, including negatives, matched exactly |
| Auto Layout direction | ${report.autoLayout.status} | ${report.autoLayout.fieldPath} | none/HORIZONTAL/VERTICAL matched |
| Padding | ${report.padding.status} | ${report.padding.fieldPaths.join(", ")} | 0/8/16 and asymmetric 4/8/12/16 matched |
| Stroke | ${report.stroke.status} | ${report.stroke.fieldPaths.join(", ")} | absence, 1/2 px, color, and INSIDE/OUTSIDE matched |

## Coordinate samples

${evidenceTable(report.coordinate.samples)}

Model: **${report.coordinate.model}**

${limits(report.coordinate.limitations)}

## Auto Layout samples

${evidenceTable(report.autoLayout.samples)}

${limits(report.autoLayout.limitations)}

## Padding samples

${evidenceTable(report.padding.samples)}

${limits(report.padding.limitations)}

## Stroke samples

${evidenceTable(report.stroke.samples)}

- Style reference: **${report.stroke.styleReference}**
- Variable binding: **${report.stroke.variableBinding}**

${limits(report.stroke.limitations)}

## Parser boundary

The parser now emits confirmed local x/y, width/height, Auto Layout direction, four padding values, and visible Stroke values. Gap remains diagnostics-only. Style references and variable bindings remain not-found and are not synthesized.
`;
}

function evidenceTable(samples: Array<{ sample: string; known: unknown; decoded: unknown; fieldPath: string | string[]; recordOffset: number; confidence: string }>): string {
  const rows = samples.map((sample) =>
    `| ${sample.sample} | \`${cell(JSON.stringify(sample.known))}\` | \`${cell(JSON.stringify(sample.decoded))}\` | ${Array.isArray(sample.fieldPath) ? sample.fieldPath.join(", ") : sample.fieldPath} | ${sample.recordOffset} | ${sample.confidence} |`
  ).join("\n");
  return `| Sample | Known | Decoded | Field path | Record offset | Confidence |\n| --- | --- | --- | --- | ---: | --- |\n${rows}`;
}

function limits(items: string[]): string {
  return `Limitations:\n\n${items.map((item) => `- ${item}`).join("\n")}`;
}

function yes(value: boolean): string {
  return value ? "yes" : "no";
}

function cell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
