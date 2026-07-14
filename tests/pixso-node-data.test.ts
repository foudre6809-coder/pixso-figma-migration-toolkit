import { describe, expect, it } from "vitest";
import {
  classifyPixsoNodeType,
  createRootRefs,
  readLayoutPositioning,
  rootPath,
  summarizeImageFills
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
    const refs = createRootRefs([{ name: "A" }, { name: "B" }, { name: "C" }]);
    const secondBatch = refs.slice(2, 3);

    expect(secondBatch[0]?.originalIndex).toBe(2);
    expect(rootPath(secondBatch[0]!)).toEqual(["C[2]"]);
  });

  it("探测绝对定位和忽略自动布局候选字段", () => {
    expect(readLayoutPositioning({ layoutPositioning: "ABSOLUTE" }).value).toBe("ABSOLUTE");
    expect(readLayoutPositioning({ layoutAlign: "STRETCH", isAbsolute: true }).value).toBe("ABSOLUTE");
    expect(readLayoutPositioning({ layoutGrow: 1, ignoreAutoLayout: false }).value).toBe("AUTO");
    expect(readLayoutPositioning({}).source).toBe("unavailable");
  });
});
