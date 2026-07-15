import { describe, expect, it } from "vitest";
import { compileSchema, encodeBinarySchema, parseSchema } from "kiwi-schema";
import { parseDecodedPixsoPayload, readZipEntries } from "../packages/pix-parser/src/index";

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
}

message PixsoMsg {
  PixsoNode[] pixsoNodes = 1;
}
`;

describe("pix parser prototype", () => {
  it("confirms Kiwi node boundaries and avoids guessing x/y", () => {
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
          stackSpacing: 8
        }
      ]
    });
    const result = parseDecodedPixsoPayload(schemaBytes, "synthetic.pix", payload);
    expect(result.rootRoundTripExact).toBe(true);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      id: "1:2",
      name: "Synthetic frame",
      type: "FRAME",
      parentId: null,
      rect: { width: 100, height: 80 },
      attributes: { layoutMode: "HORIZONTAL", gap: 8 }
    });
    expect(result.nodes[0].rect.x).toBeUndefined();
    expect(result.nodes[0].raw.recordOffset).toBeGreaterThanOrEqual(0);
    expect(result.nodes[0].raw.fieldConfidence["rect.x"]).toBe("not-found");
  });

  it("lists stored ZIP entries without extracting files", () => {
    const zip = makeStoredZip("pixso.binary", Buffer.from("schema"));
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

function makeStoredZip(nameValue: string, data: Buffer): Buffer {
  const name = Buffer.from(nameValue);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const centralOffset = local.length + name.length + data.length;
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}
