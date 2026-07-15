import { describe, expect, it } from "vitest";
import { compileSchema, encodeBinarySchema, parseSchema } from "kiwi-schema";
import { parseDecodedPixsoPayload, readZipEntries } from "../packages/pix-parser/src/index";
import { makeSyntheticStoredZip } from "./fixtures/synthetic-pix-container";

const schemaText = `
struct GUID {
  uint sessionID;
  uint localID;
}

struct Vector {
  float x;
  float y;
}

struct Matrix {
  float m00;
  float m01;
  float m02;
  float m10;
  float m11;
  float m12;
}

message ParentIndex {
  GUID guid = 1;
}

enum NodeType {
  FRAME = 0;
  CANVAS = 1;
}

enum StackMode {
  NONE = 0;
  HORIZONTAL = 1;
  VERTICAL = 2;
}

struct Color {
  uint r;
  uint g;
  uint b;
  uint a;
}

message Paint {
  string type = 1;
  Color color = 2;
  float opacity = 3;
  bool visible = 4;
  string blendMode = 5;
}

message PixsoNode {
  GUID guid = 1;
  ParentIndex parentIndex = 2;
  Matrix transform = 3;
  NodeType type = 4;
  string name = 5;
  Vector size = 6;
  StackMode stackMode = 7;
  float stackPaddingTop = 8;
  float stackSpacing = 9;
  Paint[] strokePaints = 10;
  float strokeWeight = 11;
  float borderTopWeight = 12;
  float borderRightWeight = 13;
  float borderBottomWeight = 14;
  float borderLeftWeight = 15;
  string strokeAlign = 16;
}

message PixsoMsg {
  PixsoNode[] pixsoNodes = 1;
}
`;

describe("pix parser prototype", () => {
  it("emits confirmed local-transform geometry and keeps gap diagnostics-only", () => {
    const schema = parseSchema(schemaText);
    const compiled = compileSchema(schema);
    const schemaBytes = encodeBinarySchema(schema);
    const payload = compiled.encodePixsoMsg({
      pixsoNodes: [
        {
          guid: { sessionID: 1, localID: 2 },
          parentIndex: { guid: { sessionID: 0, localID: 0 } },
          transform: { m00: 1, m01: 0, m02: -50, m10: 0, m11: 1, m12: -50 },
          type: "FRAME",
          name: "Synthetic frame",
          size: { x: 100, y: 80 },
          stackMode: "HORIZONTAL",
          stackPaddingTop: 16,
          stackSpacing: 8,
          strokePaints: [{
            type: "SOLID",
            color: { r: 217, g: 221, b: 231, a: 255 },
            opacity: 1,
            visible: true,
            blendMode: "NORMAL"
          }],
          borderTopWeight: 1,
          borderRightWeight: 1,
          borderBottomWeight: 1,
          borderLeftWeight: 1
        }
      ]
    });
    const result = parseDecodedPixsoPayload(schemaBytes, "synthetic.pix", payload);
    expect(result.rootRoundTripExact).toBe(true);
    expect(result.coordinateModel).toBe("local-transform");
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      id: "1:2",
      name: "Synthetic frame",
      type: "FRAME",
      parentId: null,
      rect: { x: -50, y: -50, width: 100, height: 80 },
      attributes: {
        layoutMode: "HORIZONTAL",
        padding: { top: 16 },
        stroke: { weight: 1, align: "INSIDE", paints: [{ type: "SOLID", color: { r: 217, g: 221, b: 231, a: 255 } }] }
      },
      raw: { diagnostics: { gapCandidate: 8 } }
    });
    expect(result.nodes[0].attributes).not.toHaveProperty("gap");
    expect(result.nodes[0].raw.recordOffset).toBeGreaterThanOrEqual(0);
    expect(result.nodes[0].raw.fieldConfidence["rect.x"]).toBe("confirmed");
    expect(result.nodes[0].raw.fieldConfidence.layoutMode).toBe("confirmed");
    expect(result.nodes[0].raw.fieldConfidence.padding).toBe("confirmed");
    expect(result.nodes[0].raw.fieldConfidence.stroke).toBe("confirmed");
  });

  it("lists stored ZIP entries without extracting files", () => {
    const zip = makeSyntheticStoredZip("pixso.binary", Buffer.from("schema"));
    const entries = readZipEntries(zip);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      name: "pixso.binary",
      compressionMethod: 0,
      encrypted: false
    });
    expect(Buffer.from(entries[0].data ?? []).toString("utf8")).toBe("schema");
  });
});
