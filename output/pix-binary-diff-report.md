# PIX binary differential research

> This report confirms a serialization and record boundary only where byte-for-byte evidence exists. It does **not** claim general .pix parsing support.

## Conclusion

- Status: **STOP**
- Actual real files inspected: 2
- Controlled differential samples: 0
- Reason: Serialization and node records are confirmed, but fewer than three controlled geometry samples and no off/A/B attribute set are available.
- Parser support claimed: **no**

## Sample summary

| Sample | File bytes | pixso.binary bytes | Decoded payload bytes | Nodes | Exact root round trip |
| --- | ---: | ---: | ---: | ---: | --- |
| sample-001 | 15505 | 31944 | 1061 | 12 | yes |
| sample-002 | 11562673 | 29240 | 35813246 | 191738 | yes |

## Confirmed fields

| Field | Confidence | Evidence |
| --- | --- | --- |
| serialization | confirmed | Kiwi binary schemas decoded and PixsoMsg round-tripped exactly in 2 real file(s). |
| nodeRecordBoundary | confirmed | 191750/191750 PixsoNode encodings were uniquely located in sequential payload order. |
| node.name | confirmed | PixsoNode.name is a Kiwi schema field and decoded records re-encode byte-for-byte. Values are redacted from reports. |
| node.type | confirmed | PixsoNode.type resolves through the Kiwi NodeType enum and exact root-message round trip. |
| node.parentId | confirmed | PixsoNode.parentIndex.guid links decoded node GUIDs; no visual-tree semantics beyond this direct link are claimed. |
| rect.width/height | confirmed | PixsoNode.size is a schema field of Vector type; x/y components are retained as width/height. |

## Inferred fields

| Field | Confidence | Evidence |
| --- | --- | --- |
| layoutMode | inferred | PixsoNode.stackMode decodes to enum values such as HORIZONTAL, but controlled off/A/B samples are absent. |
| padding/gap/stroke | inferred | Schema and decoded records expose stackPadding*, stackSpacing, and strokePaints; three-value differential validation is absent. |
| geometry transform | inferred | PixsoNode.transform contains Matrix m02/m12 candidates, but their coordinate conversion is not filled without three known positions. |

## Not found / not validated

| Field | Confidence | Evidence |
| --- | --- | --- |
| rect.x/rect.y | not-found | No three controlled coordinate values were supplied, so transform-to-top-left conversion is intentionally unset. |
| confirmed design attribute | not-found | No attribute has off/A/B controlled files; decoded field names alone are insufficient for confirmation. |

## Container entries

Entry names and node names that may contain business text are redacted. Non-standard entry names are represented by category and SHA-256 in JSON.

### sample-001

SHA-256: `9254b4ef05ff4419115e2008f35e5becbc3a6c3e99a30583b0775a0a062aabfe`

| Entry category | Compressed | Uncompressed | Method | Encrypted |
| --- | ---: | ---: | ---: | --- |
| asset.png | 428 | 8409 | 8 | no |
| design-payload.pix | 504 | 499 | 8 | no |
| VERSION | 42 | 50 | 8 | no |
| pixso.binary | 13627 | 31944 | 8 | no |

### sample-002

SHA-256: `bfd99ea1e6df3e1bb55da2d33f8aeffd9ada49461eaa446106b73383f1a56054`

| Entry category | Compressed | Uncompressed | Method | Encrypted |
| --- | ---: | ---: | ---: | --- |
| asset.png | 26303 | 33348 | 8 | no |
| design-payload.pix | 5158286 | 5169013 | 8 | no |
| asset.png | 13724 | 13719 | 8 | no |
| asset.png | 1715 | 1838 | 8 | no |
| asset.png | 1908 | 1931 | 8 | no |
| asset.png | 20596 | 20852 | 8 | no |
| asset.png | 9268 | 9263 | 8 | no |
| asset.png | 278101 | 278016 | 8 | no |
| asset.png | 9513 | 9508 | 8 | no |
| asset.png | 497143 | 528821 | 8 | no |
| asset.png | 8608 | 8603 | 8 | no |
| asset.png | 60931 | 62508 | 8 | no |
| asset.png | 224 | 264 | 8 | no |
| asset.png | 25434 | 25424 | 8 | no |
| asset.png | 82236 | 82206 | 8 | no |
| asset.png | 928991 | 928706 | 8 | no |
| asset.png | 480738 | 537494 | 8 | no |
| asset.png | 50704 | 50684 | 8 | no |
| asset.png | 5629 | 5624 | 8 | no |
| asset.png | 67573 | 67569 | 8 | no |
| asset.png | 91909 | 92042 | 8 | no |
| asset.png | 28630 | 28620 | 8 | no |
| asset.png | 9570 | 9595 | 8 | no |
| asset.png | 37038 | 38732 | 8 | no |
| asset.png | 43818 | 43803 | 8 | no |
| asset.png | 577104 | 583297 | 8 | no |
| asset.png | 624029 | 623936 | 8 | no |
| asset.png | 30534 | 30524 | 8 | no |
| asset.png | 1230653 | 1230273 | 8 | no |
| asset.png | 1140774 | 1140424 | 8 | no |
| VERSION | 42 | 50 | 8 | no |
| pixso.binary | 12539 | 29240 | 8 | no |

## Format and entropy evidence

### sample-001

- Serialization:
  - Kiwi binary schema: **confirmed** — 242 definitions decoded; PixsoMsg/PixsoNode schema present.
  - Kiwi PixsoMsg payload: **confirmed** — decode/re-encode is byte-for-byte identical.
  - Protobuf wire scan: **not-found** — 1 valid leading fields, 0% coverage; no Protobuf magic exists.
  - MessagePack/CBOR: **not-found** — No complete top-level collection signature; first bytes are consumed by confirmed Kiwi schema decoding.
  - BSON: **not-found** — BSON length and terminator heuristic did not match.
  - FlatBuffers: **not-found** — No plausible four-byte file identifier.
- Compression:
  - zstd at offset 24 in redacted-entry (high)
- pixso.binary entropy: 5.5342 bits/byte
- Schema strings retained with offsets: 228/500
- Numeric scans: varint=31944, zigzag-small=31944, length-prefixed-string=916, float32LE/BE=5597/5593, float64LE/BE=630/630
- Node types: SYMBOL=1, FRAME=4, CANVAS=7

### sample-002

- Serialization:
  - Kiwi binary schema: **confirmed** — 224 definitions decoded; PixsoMsg/PixsoNode schema present.
  - Kiwi PixsoMsg payload: **confirmed** — decode/re-encode is byte-for-byte identical.
  - Protobuf wire scan: **not-found** — 3 valid leading fields, 0% coverage; no Protobuf magic exists.
  - MessagePack/CBOR: **not-found** — No complete top-level collection signature; first bytes are consumed by confirmed Kiwi schema decoding.
  - BSON: **not-found** — BSON length and terminator heuristic did not match.
  - FlatBuffers: **not-found** — No plausible four-byte file identifier.
- Compression:
  - zstd at offset 24 in redacted-entry (high)
- pixso.binary entropy: 5.5343 bits/byte
- Schema strings retained with offsets: 217/500
- Numeric scans: varint=29240, zigzag-small=29240, length-prefixed-string=834, float32LE/BE=5272/5269, float64LE/BE=578/578
- Node types: INSTANCE=663, RECTANGLE=7331, TEXT=10846, FRAME=1319, SYMBOL=307, VECTOR=110816, ELLIPSE=869, GROUP=7448, BOOLEAN_OPERATION=52080, REGULAR_POLYGON=5, CANVAS=5, LINE=47, VARIABLE=1, VARIABLE_SET=1

## Schema hexadecimal/block diff

- sample-001 → sample-002: common prefix 0 bytes; common suffix 6227 bytes; 1/500 left-side 64-byte blocks retained in block LCS; 100 direct hex changed ranges and 200 shared-string offset changes retained.

The JSON companion includes pixso.binary head/tail hex, 4 KiB entropy blocks, schema-string offsets, sanitized entry-name hashes, direct changed ranges, and block LCS metrics.

## Geometry status

- `PixsoNode.size` is confirmed and maps to width/height.
- `PixsoNode.transform` is decoded and `m02/m12` are coordinate candidates.
- `rect.x` and `rect.y` remain unset because three controlled known coordinate values were not supplied.
- No integer, float32, float64, endian, varint, or zigzag match is promoted to a field meaning without controlled values.

## Design attribute status

- `stackMode`, `stackPadding*`, `stackSpacing`, and `strokePaints` are decoded schema fields.
- They remain inferred as requested design attributes until off/A/B controlled samples produce stable value changes.

## Next validation required

1. Three files with one frame at three documented x/y pairs and unchanged IDs/content.
2. For each of Auto Layout, padding, gap, stroke, and radius: off, value A, and value B files.
3. Save the same minimal document twice unchanged to separate IDs/timestamps from semantic changes.
4. Keep all real files local; rerun `pix-binary-inspect` and commit only the redacted reports.
