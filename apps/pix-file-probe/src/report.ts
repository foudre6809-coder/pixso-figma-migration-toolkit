import type { BinaryResearchReport } from "./analysis.js";

export function renderBinaryResearchMarkdown(report: BinaryResearchReport): string {
  const sampleRows = report.samples.map((sample) =>
    `| ${sample.label} | ${sample.fileSizeBytes} | ${sample.pixsoBinary.sizeBytes} | ${sample.decoded.payloadBytes} | ${sample.decoded.nodeCount} | ${sample.decoded.roundTripExact ? "yes" : "no"} |`
  ).join("\n");
  const confirmedRows = report.confirmedFields.map(fieldRow).join("\n");
  const inferredRows = report.inferredFields.map(fieldRow).join("\n");
  const missingRows = report.notFoundFields.map(fieldRow).join("\n");
  const entrySections = report.samples.map((sample) => {
    const rows = sample.containerEntries.map((entry) =>
      `| ${entry.category} | ${entry.compressedSize} | ${entry.uncompressedSize} | ${entry.method} | ${entry.encrypted ? "yes" : "no"} |`
    ).join("\n");
    return `### ${sample.label}\n\nSHA-256: \`${sample.sha256}\`\n\n| Entry category | Compressed | Uncompressed | Method | Encrypted |\n| --- | ---: | ---: | ---: | --- |\n${rows}`;
  }).join("\n\n");
  const diffSections = report.schemaDiffs.length === 0
    ? "No cross-sample schema diff was available."
    : report.schemaDiffs.map((diff) =>
      `- ${diff.left} → ${diff.right}: common prefix ${diff.commonPrefixBytes} bytes; common suffix ${diff.commonSuffixBytes} bytes; ${diff.commonBlockLcsLength}/${diff.leftBlockCount} left-side ${diff.blockSize}-byte blocks retained in block LCS; ${diff.changedRanges.length} direct hex changed ranges and ${diff.schemaStringOffsetChanges.length} shared-string offset changes retained.`
    ).join("\n");
  const signalSections = report.samples.map((sample) => {
    const serial = sample.serializationSignals.map((signal) => `  - ${signal.format}: **${signal.confidence}** — ${signal.evidence}`).join("\n");
    const compression = sample.compressionSignals.length
      ? sample.compressionSignals.map((signal) => `  - ${signal.format} at offset ${signal.offset} in ${signal.source} (${signal.confidence})`).join("\n")
      : "  - No compression signature found in inspected entry bytes.";
    const scans = sample.pixsoBinary.encodingScans;
    return `### ${sample.label}\n\n- Serialization:\n${serial}\n- Compression:\n${compression}\n- pixso.binary entropy: ${sample.pixsoBinary.entropyBitsPerByte} bits/byte\n- Schema strings retained with offsets: ${sample.pixsoBinary.readableSchemaStrings.length}/500\n- Numeric scans: varint=${scans.varintCandidates}, zigzag-small=${scans.zigzagSmallIntegerCandidates}, length-prefixed-string=${scans.lengthPrefixedStringCandidates}, float32LE/BE=${scans.float32LECandidates}/${scans.float32BECandidates}, float64LE/BE=${scans.float64LECandidates}/${scans.float64BECandidates}\n- Node types: ${Object.entries(sample.decoded.nodeTypeCounts).map(([type, count]) => `${type}=${count}`).join(", ")}`;
  }).join("\n\n");

  return `# PIX binary differential research

> This report confirms a serialization and record boundary only where byte-for-byte evidence exists. It does **not** claim general .pix parsing support.

## Conclusion

- Status: **${report.conclusion.status}**
- Actual real files inspected: ${report.conclusion.actualSampleCount}
- Controlled differential samples: ${report.conclusion.controlledDifferentialSampleCount}
- Reason: ${report.conclusion.reason}
- Parser support claimed: **no**

## Sample summary

| Sample | File bytes | pixso.binary bytes | Decoded payload bytes | Nodes | Exact root round trip |
| --- | ---: | ---: | ---: | ---: | --- |
${sampleRows}

## Confirmed fields

| Field | Confidence | Evidence |
| --- | --- | --- |
${confirmedRows}

## Inferred fields

| Field | Confidence | Evidence |
| --- | --- | --- |
${inferredRows}

## Not found / not validated

| Field | Confidence | Evidence |
| --- | --- | --- |
${missingRows}

## Container entries

Entry names and node names that may contain business text are redacted. Non-standard entry names are represented by category and SHA-256 in JSON.

${entrySections}

## Format and entropy evidence

${signalSections}

## Schema hexadecimal/block diff

${diffSections}

The JSON companion includes pixso.binary head/tail hex, 4 KiB entropy blocks, schema-string offsets, sanitized entry-name hashes, direct changed ranges, and block LCS metrics.

## Geometry status

- \`PixsoNode.size\` is confirmed and maps to width/height.
- \`PixsoNode.transform\` is decoded and \`m02/m12\` are coordinate candidates.
- \`rect.x\` and \`rect.y\` remain unset because three controlled known coordinate values were not supplied.
- No integer, float32, float64, endian, varint, or zigzag match is promoted to a field meaning without controlled values.

## Design attribute status

- \`stackMode\`, \`stackPadding*\`, \`stackSpacing\`, and \`strokePaints\` are decoded schema fields.
- They remain inferred as requested design attributes until off/A/B controlled samples produce stable value changes.

## Next validation required

1. Three files with one frame at three documented x/y pairs and unchanged IDs/content.
2. For each of Auto Layout, padding, gap, stroke, and radius: off, value A, and value B files.
3. Save the same minimal document twice unchanged to separate IDs/timestamps from semantic changes.
4. Keep all real files local; rerun \`pix-binary-inspect\` and commit only the redacted reports.
`;
}

function fieldRow(item: { field: string; confidence: string; evidence: string }): string {
  return `| ${escapeCell(item.field)} | ${item.confidence} | ${escapeCell(item.evidence)} |`;
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
