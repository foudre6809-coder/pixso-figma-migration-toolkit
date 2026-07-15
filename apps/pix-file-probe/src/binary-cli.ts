#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzePixFiles } from "./analysis.js";
import { renderBinaryResearchMarkdown } from "./report.js";

export async function runBinaryInspect(argv: string[]): Promise<number> {
  const { files, outputDirectory, help } = parseArguments(argv);
  if (help) {
    process.stdout.write("Usage: pix-binary-inspect <file.pix> [more.pix ...] [--output-dir <directory>]\n");
    return 0;
  }
  if (files.length === 0) throw new Error("At least one local .pix path is required");
  if (files.some((file) => !file.toLowerCase().endsWith(".pix"))) throw new Error("All inputs must use the .pix extension");
  const report = await analyzePixFiles(files.map((file) => resolve(file)));
  const destination = resolve(outputDirectory ?? "output");
  await mkdir(destination, { recursive: true });
  const jsonPath = resolve(destination, "pix-binary-diff-report.json");
  const markdownPath = resolve(destination, "pix-binary-diff-report.md");
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderBinaryResearchMarkdown(report), "utf8");
  process.stdout.write(`${report.conclusion.status}\n${jsonPath}\n${markdownPath}\n`);
  return report.conclusion.status === "FIX" ? 1 : 0;
}

function parseArguments(argv: string[]): { files: string[]; outputDirectory?: string; help: boolean } {
  const result: { files: string[]; outputDirectory?: string; help: boolean } = { files: [], help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") result.help = true;
    else if (argument === "--output-dir" || argument === "-o") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a directory`);
      result.outputDirectory = value;
      index += 1;
    } else if (argument.startsWith("-")) throw new Error(`Unknown option: ${argument}`);
    else result.files.push(argument);
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runBinaryInspect(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`FIX: ${message}\n`);
    process.exitCode = 1;
  });
}
