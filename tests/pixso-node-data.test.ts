import { describe, expect, it } from "vitest";
import {
  classifyPixsoNodeType,
  createRootRefs,
  findAppearanceOwnerCandidate,
  readLayoutPositioning,
  rootIndexWarnings,
  rootPath,
  summarizeImageFills,
  summarizeStrokes
} from "../apps/pixso-plugin/src/node-data";

describe("Pixso 节点数据适配", () => {
  it("优先按 IMAGE 填充识别图片节点", () => {
    expect(classifyPixsoNodeType({ type: "RECTANGLE", fills: [{ type: "IMAGE" }] })).toBe("IMAGE");
    expect(classifyPixsoNodeType({ type: "RECTANGLE", fills: [{ type: "IMAGE", visible: false }] })).toBe("IMAGE");
  });

  it("将纯色矩形识别为矢量节点", () => {
    expect(classifyPixsoNodeType({ type: "RECTANGLE", fills: [{ type: "SOLID" }] })).toBe("VECTOR");
  });

  it("将混合填充中的图片优先识别为图片节点", () => {
    expect(classifyPixsoNodeType({
      type: "VECTOR",
      fills: [{ type: "SOLID" }, { type: "IMAGE", visible: true }]
    })).toBe("IMAGE");
  });

  it("保留带图片背景的容器和组件类型", () => {
    expect(classifyPixsoNodeType({ type: "FRAME", fills: [{ type: "IMAGE" }] })).toBe("FRAME");
    expect(classifyPixsoNodeType({ type: "COMPONENT", fills: [{ type: "IMAGE" }] })).toBe("COMPONENT");
    expect(classifyPixsoNodeType({ type: "INSTANCE", fills: [{ type: "IMAGE" }] })).toBe("INSTANCE");
  });

  it("导出完整的图片填充摘要", () => {
    const summary = summarizeImageFills([
      {
        type: "IMAGE",
        scaleMode: "FILL",
        opacity: 0.75,
        blendMode: "MULTIPLY",
        imageHash: "hash-1",
        imageTransform: [[1, 0, 0], [0, 1, 0]]
      },
      { type: "IMAGE", imageScaleMode: "FIT", hash: "hash-2" }
    ]);

    expect(summary.source).toBe("native");
    expect(summary.value).toEqual({
      count: 2,
      scaleModes: ["FILL", "FIT"],
      opacities: [0.75, 1],
      blendModes: ["MULTIPLY", "NORMAL"],
      hashes: ["hash-1", "hash-2"],
      hasTransform: true
    });
  });

  it("分批后仍保留根节点在原选择集中的索引", () => {
    const refs = createRootRefs([{ name: "A" }, { name: "B" }, { name: "C" }], undefined, "selection");
    const secondBatch = refs.slice(2, 3);

    expect(secondBatch[0]?.originalIndex).toBe(2);
    expect(rootPath(secondBatch[0]!)).toEqual(["C[2]"]);
  });

  it("稀疏选择使用节点在页面中的真实索引", () => {
    const page = [
      { id: "1", name: "A" },
      { id: "2", name: "B" },
      { id: "3", name: "C" },
      { id: "4", name: "D" },
      { id: "5", name: "E" }
    ];
    const refs = createRootRefs([page[1]!, { ...page[4]! }], page, "selection");

    expect(refs.map(({ originalIndex }) => originalIndex)).toEqual([1, 4]);
    expect(refs.map(({ indexSource }) => indexSource)).toEqual(["page", "page"]);
  });

  it("页面子节点不可用时标记为选择顺序回退", () => {
    const refs = createRootRefs([{ id: "2" }, { id: "5" }], undefined, "selection");
    expect(refs.map(({ originalIndex, indexSource }) => [originalIndex, indexSource])).toEqual([
      [0, "selection"],
      [1, "selection"]
    ]);
    expect(rootIndexWarnings(refs).join(" ")).toContain("索引可信度下降");
  });

  it("探测绝对定位和忽略自动布局候选字段", () => {
    expect(readLayoutPositioning({ layoutPositioning: "ABSOLUTE" }).value).toBe("ABSOLUTE");
    expect(readLayoutPositioning({ layoutAlign: "STRETCH", isAbsolute: true }).value).toBe("ABSOLUTE");
    expect(readLayoutPositioning({ layoutGrow: 1, ignoreAutoLayout: false }).value).toBe("AUTO");
    expect(readLayoutPositioning({}).source).toBe("unavailable");
  });

  it("识别输入框的全尺寸背景为视觉承载节点", () => {
    expect(
      findAppearanceOwnerCandidate({
        width: 200,
        height: 36,
        fills: [],
        strokes: [],
        children: [
          { type: "RECTANGLE", x: 0, y: 0, width: 200, height: 36, visible: true, isMask: false },
          { type: "TEXT", x: 12, y: 8, width: 80, height: 20 }
        ]
      })
    ).toEqual({ reason: "full-size-background", childIndex: 0 });
  });

  it("多个全尺寸背景候选时不自动选择视觉承载节点", () => {
    const rectangle = { type: "RECTANGLE", x: 0, y: 0, width: 200, height: 36, visible: true, isMask: false };
    expect(
      findAppearanceOwnerCandidate({ width: 200, height: 36, fills: [], strokes: [], children: [rectangle, rectangle] })
    ).toEqual({ reason: "ambiguous" });
  });

  it("输出描边 Paint 完整性摘要", () => {
    expect(
      summarizeStrokes({
        strokes: [{ type: "GRADIENT_LINEAR", opacity: 0.8, boundVariables: { color: "v1" } }],
        strokeStyleId: "style-1",
        strokeStyleName: "Input/Border"
      }).value
    ).toEqual({
      count: 1,
      paintTypes: ["GRADIENT_LINEAR"],
      opacities: [0.8],
      styleId: "style-1",
      styleName: "Input/Border",
      isMixed: false,
      hasGradient: true,
      hasVariableReference: true,
      completeSingleSolid: false
    });
  });

  it("描边字段不可用时明确报告缺失", () => {
    const summary = summarizeStrokes({});
    expect(summary.source).toBe("unavailable");
    expect(summary.note).toContain("未开放描边");
  });
});
