import type { NestedCoordinateReport } from "./nested-coordinate-analysis.js";

export function renderNestedCoordinateMarkdown(report: NestedCoordinateReport): string {
  const integrityRows = report.integrity.map((group) =>
    `| ${group.group} | ${group.samples.length} | ${yes(group.decodedAndReencodedExactly)} | ${yes(group.nodeCountStable)} | ${yes(group.targetGuidsStable)} | ${yes(group.parentChainsStable)} | ${yes(group.pureTranslationMatrices)} | ${yes(group.onlyExpectedSemanticChanges)} |`
  ).join("\n");
  const evidenceRows = report.coordinateComposition.samples.map((sample) =>
    `| ${sample.sample} | ${sample.nodePath} | \`${json(sample.known.local)}\` | \`${json(sample.known.ancestorTranslations)}\` | \`${json(sample.known.absolute)}\` | \`${json(sample.decoded.absolute)}\` | ${sample.recordOffset} | ${sample.confidence} |`
  ).join("\n");
  return `# PIX nested translation coordinate report

> Source .pix files remained local. This report contains only synthetic filenames, numeric evidence, structural paths, offsets, and limitations.

## Conclusion

- Status: **${report.conclusion.status}**
- Controlled files: ${report.sampleCount}
- Model: **${report.coordinateComposition.model}**
- Parser marker: **${report.coordinateComposition.parserStatus}**
- Reason: ${report.conclusion.reason}
- General .pix or full transform support claimed: **no**

## Integrity

| Group | Files | Exact round trip | Stable count | Stable GUIDs | Stable parent chains | Pure translation | Only intended semantic changes |
| --- | ---: | --- | --- | --- | --- | --- | --- |
${integrityRows}

${report.integrity.flatMap((group) => group.notes.map((note) => `- ${group.group}: ${note}`)).join("\n")}

## Coordinate evidence

| Sample | Node path | Local | Ancestor translations | Expected absolute | Decoded absolute | Record offset | Confidence |
| --- | --- | --- | --- | --- | --- | ---: | --- |
${evidenceRows}

The confirmed rule for these controlled samples is:

\`computedAbsolute = node local translation + each ancestor translation\`

The two sibling nodes retain local positions (10,20) and (50,60), so their local delta remains exactly (40,40) before and after their direct parent moves.

## Parser boundary

\`rect.x/y\` remain parent-local. The parser writes \`computedAbsoluteX/Y\` only under \`raw.diagnostics\` and only when the complete available chain is a pure translation ending at a root Canvas or root node. The status is \`confirmed-translation-only\`.

Limitations:

${report.coordinateComposition.limitations.map((item) => `- ${item}`).join("\n")}
`;
}

function yes(value: boolean): string {
  return value ? "yes" : "no";
}

function json(value: unknown): string {
  return JSON.stringify(value).replaceAll("|", "\\|");
}
