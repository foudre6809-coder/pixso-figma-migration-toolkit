# PIX binary payload research

## Outcome

The serialization and node-record structure are confirmed for two local real files:

```text
.pix ZIP
├── pixso.binary              Kiwi binary schema
└── design-payload.pix        pixso-kw wrapper
    └── Zstandard frame       Kiwi PixsoMsg
        └── pixsoNodes[]      sequential PixsoNode records
```

This is not yet general `.pix` parser support. The current conclusion is **STOP** because there are only two non-controlled real files, no third known coordinate value, and no off/A/B attribute sets.

## Evidence threshold

A format or field is marked confirmed only when structural decoding and byte-level validation agree. String presence alone is never treated as field semantics.

- `pixso.binary`: decoded with Kiwi `decodeBinarySchema`.
- Root message: `PixsoMsg` from the decoded schema.
- Payload validation: decoded root message re-encodes byte-for-byte to the full decompressed payload.
- Node boundaries: every decoded `PixsoNode` re-encodes to a sequential byte range in the original payload.
- Business values: node names and non-standard entry names are excluded from committed reports.

## Confirmed fields

| Field | Encoding/evidence | Confidence |
| --- | --- | --- |
| Root record | Kiwi `PixsoMsg` exact round trip | confirmed |
| Node boundary | Sequential encoded `PixsoNode` offset and length | confirmed |
| Node id | `PixsoNode.guid` (`sessionID:localID`) | confirmed when present |
| Parent link | `PixsoNode.parentIndex.guid` | confirmed when present |
| Node name | Kiwi string `PixsoNode.name` | confirmed when present; value redacted |
| Node type | `PixsoNode.type` / `NodeType` enum | confirmed when present |
| Width/height | `PixsoNode.size` Vector x/y | confirmed when present |

Sparse records can omit some fields. The parser leaves them absent and records `not-found`; it never creates placeholder values.

## Inferred fields

| Requested property | Decoded schema field | Current status |
| --- | --- | --- |
| x/y | `transform.m02/m12` plus an unknown coordinate conversion | inferred |
| layoutMode | `stackMode` | inferred |
| padding | `stackPaddingTop/Right/Bottom/Left` | inferred |
| gap | `stackSpacing` | inferred |
| stroke | `strokePaints` and border-weight fields | inferred |
| radius | `cornerRadius`/corner-specific fields | inferred |

These remain inferred until controlled known values validate the mapping in at least three files.

## Binary-format checks

- Header/tail hex and 4 KiB entropy blocks are stored in the JSON report.
- Null-terminated schema strings are stored with offsets; design-payload strings are redacted.
- Schema pairs receive direct byte-range diffs and a 64-byte block LCS metric.
- Kiwi variable integers and null-terminated strings explain the schema layout.
- Kiwi floats use 32-bit float encoding with a compact zero representation, per the upstream format.
- The tool scans gzip, zlib, Brotli wrapper markers, LZ4, Snappy framing, and Zstandard signatures. Only Zstandard is confirmed for the design payload.
- Protobuf wire coverage, MessagePack/CBOR collection heuristics, BSON length/terminator checks, and FlatBuffers identifier checks are reported but not promoted over definitive Kiwi decoding.
- Numeric candidates are not assigned meaning without controlled expected values, regardless of integer, varint, zigzag, float32/float64, or endian matches.

## Prototype boundaries

`packages/pix-parser` is deliberately narrow:

- reads ZIP entries in memory;
- rejects encrypted entries;
- identifies the Kiwi schema and nested payload;
- invokes the local `zstd` executable without network access;
- requires exact `PixsoMsg` decode/re-encode equality;
- emits nodes with per-field confidence;
- leaves x/y absent instead of guessing.

The package must not be wired into the existing Pixso or Figma plugins until the PASS threshold is met.

## Reproduction

```bash
pnpm build
node apps/pix-file-probe/dist/binary-cli.js /local/00-empty.pix /local/01-frame.pix --output-dir output
```

The generated `output/pix-binary-diff-report.json` and `.md` redact paths, node names, and non-standard entry names.

## Next-round controlled values

The independent GPT review agreed that structural decoding may continue while semantic extraction remains STOP. It recommended keeping `coordinateModel: "unknown"` until these local files exist:

| Sample | x | y | width | height | Purpose |
| --- | ---: | ---: | ---: | ---: | --- |
| origin | 0 | 0 | 100 | 50 | baseline |
| x-only | 37 | 0 | 100 | 50 | isolate m02 delta |
| y-only | 0 | 23 | 100 | 50 | isolate m12 delta |
| asymmetric | 41 | 17 | 123 | 47 | distinguish top-left from center `(102.5, 40.5)` |

Keep rotation 0, scale 1, stroke/effects off, one node, and an unchanged parent. If nesting must be tested, add a separate parent-relative series instead of changing the parent in this series.

Minimum property values:

- Auto Layout: off; horizontal with spacing 0; horizontal with spacing 20.
- Padding-left: 0; 10; 30, with other sides 0.
- Gap: 0; 10; 40, with two fixed 50×50 children.
- Stroke: none; black width 1; black width 5.
- Radius: 0; 8; 24 on a fixed 100×100 rectangle.

Each series changes one value only. The report must emit field path, old value, new value, and confidence; schema-field presence alone remains insufficient.
