#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzePixFiles } from "./analysis.js";
import { renderBinaryResearchMarkdown } from "./report.js";
import { analyzeControlledPixFiles } from "./controlled-analysis.js";
import { renderControlledMarkdown } from "./controlled-report.js";

export async function runBinaryInspect(argv: string[]): Promise<number> {
  const { files, outputDirectory, help } = parseArguments(argv);
  if (help) {
    process.stdout.write("Usage: pix-binary-inspect <file.pix> [more.pix ...] [--output-dir <directory>]\n");
    return 0;
  }
  if (files.length === 0) throw new Error("At least one local .pix path is required");
  if (files.some((file) => !file.toLowerCase().endsWith(".pix"))) throw new Error("All inputs must use the .pix extension");
  const destination = resolve(outputDirectory ?? "output");
  await mkdir(destination, { recursive: true });
  if (isControlledSet(files)) {
    const controlled = await analyzeControlledPixFiles(files.map((file) => resolve(file)));
    const jsonPath = resolve(destination, "pix-controlled-diff-report.json");
    const markdownPath = resolve(destination, "pix-controlled-diff-report.md");
    await writeFile(jsonPath, `${JSON.stringify(controlled, null, 2)}\n`, "utf8");
    await writeFile(markdownPath, renderControlledMarkdown(controlled), "utf8");
    process.stdout.write(`${controlled.conclusion.status}\n${jsonPath}\n${markdownPath}\n`);
    return controlled.conclusion.status === "FIX" ? 1 : 0;
  }
  const report = await analyzePixFiles(files.map((file) => resolve(file)));
  const jsonPath = resolve(destination, "pix-binary-diff-report.json");
  const markdownPath = resolve(destination, "pix-binary-diff-report.md");
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderBinaryResearchMarkdown(report), "utf8");
  process.stdout.write(`${report.conclusion.status}\n${jsonPath}\n${markdownPath}\n`);
  return report.conclusion.status === "FIX" ? 1 : 0;
}

const controlledNames = [
  "coord-00.pix", "coord-10.pix", "coord-50.pix", "coord-neg.pix",
  "layout-none.pix", "layout-horizontal.pix", "layout-vertical.pix",
  "padding-0.pix", "padding-8.pix", "padding-16.pix", "padding-asym.pix",
  "stroke-none.pix", "stroke-1.pix", "stroke-2.pix", "stroke-color.pix", "stroke-outside.pix"
];

function isControlledSet(files: string[]): boolean {
  const names = new Set(files.map((file) => basename(file)));
  return controlledNames.every((name) => names.has(name));
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
