#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readZipEntries } from "@pixso-figma-migration/pix-parser";

export async function runProbe(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write("Usage: pix-file-probe <local-file.pix>\n");
    return 0;
  }
  if (argv.length !== 1 || !argv[0].toLowerCase().endsWith(".pix")) throw new Error("Exactly one local .pix path is required");
  const path = resolve(argv[0]);
  const bytes = await readFile(path);
  const entries = readZipEntries(bytes);
  const report = {
    sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    first256BytesHex: bytes.subarray(0, 256).toString("hex"),
    zip: true,
    encryptedEntryCount: entries.filter((entry) => entry.encrypted).length,
    entries: entries.map((entry) => ({
      category: entry.name === "pixso.binary" || entry.name === "VERSION" ? entry.name : entry.name.toLowerCase().endsWith(".pix") ? "design-payload.pix" : "asset",
      compressedSize: entry.compressedSize,
      uncompressedSize: entry.uncompressedSize,
      method: entry.compressionMethod,
      encrypted: entry.encrypted
    })),
    payloadParsingClaimed: false
  };
  await writeFile(resolve("pix-probe-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write("PASS\n");
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runProbe(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`FIX: ${message}\n`);
    process.exitCode = 1;
  });
}
