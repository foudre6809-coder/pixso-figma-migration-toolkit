import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Figma preview summary", () => {
  it("shows all four preview outcome categories without merging verified into modified", () => {
    const ui = readFileSync(new URL("../apps/figma-plugin/src/ui.html", import.meta.url), "utf8");

    expect(ui).toContain("将修改 ${counts.modified || 0}");
    expect(ui).toContain("无需修改 ${counts.verified || 0}");
    expect(ui).toContain("需人工确认 ${counts.partial || 0}");
    expect(ui).toContain("无法处理 ${counts.failed || 0}");
    expect(ui).toContain('modified: "将修改", verified: "无需修改"');
    expect(ui).toContain('let loadedJson = ""');
    expect(ui).toContain('json: loadedJson || document.getElementById("json").value');
    expect(ui).not.toContain('document.getElementById("json").value = await file.text()');
  });
});
