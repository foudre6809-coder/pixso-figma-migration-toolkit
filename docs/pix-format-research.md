# PIX format research

This research is limited to local, read-only format reconnaissance. It does not claim general `.pix` parsing support and does not change either plugin.

## Confirmed facts

- Both inspected real files are ZIP containers with no ZIP entry encryption flag.
- Both contain `VERSION`, `pixso.binary`, one nested design-payload `.pix` entry, and image assets.
- The nested design-payload entry begins with a `pixso-kw` wrapper, declares `compress:zstd`, and contains a Zstandard frame at offset 24.
- `pixso.binary` is a Kiwi binary schema. It decodes with the official Kiwi schema decoder and contains `PixsoMsg` and `PixsoNode` message definitions.
- The decompressed design payload decodes as `PixsoMsg`. Decode followed by re-encode reproduces every original payload byte in both inspected files.
- The two real files cover different Pixso/Kiwi versions, 242 vs. 224 schema definitions, 1,061 vs. 35,813,246 decoded payload bytes, and 12 vs. 191,738 node records.

Primary format reference: [evanw/kiwi](https://github.com/evanw/kiwi), especially its binary schema decoder and native-type encoding documentation.

## Inferences

- `pixso.binary` is a versioned schema dictionary, not the principal document instance data.
- The nested Zstandard-compressed `.pix` entry is the principal Kiwi message stream for the inspected files.
- `PixsoMsg.pixsoNodes[]` is the document node-record sequence. This is strongly supported by schema typing, exact root-message round trips, and sequential per-node record matches.
- `PixsoNode.size` represents width/height.
- Sixteen controlled synthetic samples confirm `transform.m02/m12` as parent-local x/y translation, `stackMode` as Auto Layout direction, four `stackPadding*` fields as Padding, and `strokePaints`/border weights/`strokeAlign` as visible Stroke values.
- Nine controlled nested samples confirm that Page/Frame/Rectangle chains containing only identity-plus-translation matrices use exact ancestor translation sums. This is explicitly limited to `translation-only ancestor composition`.

## Not verified

- Nested coordinates involving rotation, scale, skew, mirror, Auto Layout, Group, Section, Component/Instance, virtual parents, or page-origin offsets.
- Controlled value mappings for gap and corner radius.
- Stroke style references and variable bindings; the controlled samples contained visible values only.
- The meaning of sparse or deletion-state `PixsoNode` records that omit id, name, or type.
- Compatibility beyond the two inspected versions.
- Lossless handling of every blob, image, vector network, text run, variable, prototype, and unknown future field.

## Differential samples required

Real samples remain local and must not be committed. The next run needs:

1. Stroke visible values, shared style reference, and variable binding variants.
2. A separate rotation/scale matrix series only if explicitly authorized.
3. Gap and corner-radius off/A/B series only in separately authorized rounds.
4. Two unchanged saves to identify nondeterministic IDs and timestamps.

Only SHA-256, sizes, structural counts, schema-safe strings, redacted entry hashes, and redacted differential evidence may be committed.
