# PIX binary payload research

## Outcome

The controlled semantic round and the nested translation-only coordinate round are **PASS**. Sixteen local synthetic Pixso files confirmed local coordinates plus Auto Layout direction, Padding, and visible Stroke values. Nine additional local synthetic files confirmed ancestor translation composition. This remains a narrow parser prototype, not a claim of general `.pix` or full transform support.

The stroke source provenance round is **FIX**. It confirmed the shared Stroke color style reference identity fields, but the variable chain is still only inferred because the local Pixso client session did not produce clean `stroke-variable-detached.pix` and `stroke-variable-value-b.pix` exports in the target sample directory. The production parser therefore still emits only resolved visible Stroke appearance; source provenance stays in research diagnostics.

```text
.pix ZIP
├── pixso.binary              Kiwi binary schema
└── design-payload.pix        pixso-kw wrapper
    └── Zstandard frame       Kiwi PixsoMsg
        └── pixsoNodes[]      sequential PixsoNode records
```

No real `.pix` file, unpacked image, business text, or path is committed. The committed controlled report contains only synthetic sample names, numeric values, field paths, offsets, hashes, and limitations.

## Nested translation-only round

| Group | Files | Exact decode/re-encode | Stable GUIDs and parent chain | Result |
| --- | ---: | --- | --- | --- |
| single-level parent movement | 3 | yes | yes | child local (10,20) remains fixed; absolute positions are (10,20), (110,220), and (-40,50) |
| double-level positive/negative | 2 | yes | yes | ancestor sums produce (135,246) and (-65,36) exactly |
| grandparent-only movement | 2 | yes | yes | FrameB and ChildRect remain local-stable while absolute changes from (35,46) to (115,26) |
| sibling control | 2 | yes | yes | local positions remain (10,20) and (50,60), preserving delta (40,40) |

All matrices in these chains are identity-plus-translation. The Canvas root has no transform and acts as the controlled origin. No cycle, missing parent, virtual parent, unexplained child rewrite, or hidden matrix term was observed.

The confirmed rule is limited to these samples:

```text
computedAbsolute = node local translation + each ancestor translation
```

This does not confirm rotation, scale, skew, mirror, Auto Layout positioning, Group/Section behavior, Component/Instance transforms, or page-origin offsets.

## Sample integrity

| Group | Files | Exact decode/re-encode | Stable target GUID/identity | Stable node count | Excluded derived changes |
| --- | ---: | --- | --- | --- | --- |
| coordinate | 4 | yes | yes | yes | none |
| Auto Layout | 3 | yes | yes | yes | child transforms follow direction; disabled layout retains dormant padding/gap storage |
| Padding | 4 | yes | yes | yes | child transforms follow padding; `stackMode=HORIZONTAL`, gap=0 remain stable |
| Stroke | 5 | yes | yes | yes | `strokePaddingPath` appears with a stroke and is treated as derived geometry |

Container/document metadata is excluded before semantic comparison. Each target is located by stable GUID and independently by synthetic name, type, parent link, and node count.

## Confirmed fields

| Semantic | Kiwi field | Evidence | Limitation |
| --- | --- | --- | --- |
| local x/y | `PixsoNode.transform.m02/m12` | 0/0, 10/20, 50/70, and -20/-30 match exactly | nested page-absolute coordinates require ancestor transform composition |
| nested absolute x/y diagnostics | ancestor `transform.m02/m12` sum | nine single-level, double-level, negative, grandparent-only, and sibling samples match exactly | translation-only; formal `rect.x/y` remain local |
| width/height | `PixsoNode.size.x/y` | schema field and exact message round trip | none |
| Auto Layout direction | `PixsoNode.stackMode` | absent, `HORIZONTAL`, and `VERTICAL` match | disabled layout can retain dormant padding/gap values |
| Padding | `stackPaddingTop/Right/Bottom/Left` | 0, 8, 16, and asymmetric 4/8/12/16 match | variable-bound padding not sampled |
| Stroke existence/color | `strokePaints[]` and `strokePaints[].color` | none, #D9DDE7, and #FF0000 match | only visible solid paints sampled |
| Stroke width | `strokeWeight` and four `border*Weight` fields | 1 px and 2 px match | Pixso omits default `strokeWeight=1` but stores four 1 px border weights |
| Stroke align | `strokeAlign` | INSIDE and OUTSIDE match | Pixso omits default `INSIDE` |

Node record boundaries, `name`, `type`, `guid`, `parentIndex.guid`, schema decoding, Zstandard wrapping, and full root-message byte round trips remain confirmed from the prior round.

## Inferred or not found

| Field | Status | Reason |
| --- | --- | --- |
| gap / `stackSpacing` | inferred | deliberately out of scope; retained in diagnostics only |
| Stroke style reference | confirmed for source provenance research | `inheritStrokeStyleID.sessionID/localID` appears in style-bound samples and is cleared to `0:0` after detaching while visible appearance remains blue |
| Stroke variable binding | inferred | `strokePaints[0].colorVar.*` appears in bound samples, but detached and value-B samples are still missing |
| page-absolute nested geometry | confirmed-translation-only | pure translation ancestor sums match all nine controlled nested samples; other matrix operations remain unverified |
| radius, component/instance, image, vector, text style | not-found | deliberately out of scope |

## Stroke Source Provenance Round

| Chain | Samples used | Status | Candidate fields | Limitation |
| --- | ---: | --- | --- | --- |
| inline vs shared style vs detached style | 5 | confirmed | `inheritStrokeStyleID.sessionID`, `inheritStrokeStyleID.localID` | confirms style reference identity only; shared style definition value storage remains not-found |
| inline vs variable-bound | 3 | inferred | `strokePaints[0].colorVar.dataType`, `strokePaints[0].colorVar.resolvedDataType`, `strokePaints[0].colorVar.value.alias.guid.sessionID/localID` | missing `stroke-variable-detached.pix` and `stroke-variable-value-b.pix` |

All eight source-provenance samples were local synthetic files. All decoded and re-encoded exactly. The `StrokeTarget` GUID stayed stable (`22:1`) across the available samples. Node count changed from 12/13 to 15 as style and variable definitions were introduced; those extra definition records are expected and are not committed as `.pix` fixtures.

`stroke-style-value-green.pix` did not change the decoded visible Stroke color on `StrokeTarget`; it stayed `#3366FF`. This means the current evidence confirms the reference field, not the shared style definition/value table. No parser claim is made for resolving style definitions.

## Parser behavior

`packages/pix-parser` now emits only confirmed semantic fields:

- local `rect.x/y` from matrix translation;
- `rect.width/height`;
- Auto Layout direction when `stackMode` is present;
- active four-direction Padding;
- visible Stroke paint, color, opacity, width, and align.

Gap and dormant Padding candidates stay under `raw.diagnostics`. Style references and variable bindings remain outside formal node output; the parser does not invent fallback metadata. `coordinateModel` remains `local-transform`. For a complete Page/Frame/Rectangle chain containing only identity-plus-translation matrices, diagnostics may include `computedAbsoluteX/Y` with `coordinateCompositionStatus=confirmed-translation-only`. Missing parents, cycles, or non-translation matrices suppress those computed diagnostics.

## Reproduction

```bash
pnpm build
node apps/pix-file-probe/dist/binary-cli.js /local/controlled/*.pix --output-dir output
```

When all 16 required controlled filenames are present, the CLI writes `output/pix-controlled-diff-report.json` and `.md`. Other input sets continue to use the generic structural report.

When all nine nested-coordinate filenames are present, the CLI writes `output/pix-nested-coordinate-report.json` and `.md`. Real sample files remain local and are never copied into the repository.

When stroke source provenance samples are present, the CLI writes `output/pix-stroke-source-report.json` and `.md`. Missing source-provenance samples produce a `FIX` result, not a parser support claim.

## Next validation

1. Re-export `stroke-variable-detached.pix` and `stroke-variable-value-b.pix` through a verified Pixso client export path, then rerun the stroke source provenance report.
2. Rotation and scale composition only in a separately authorized, tightly controlled matrix round.
3. Separate controlled rounds for Gap and Radius only if explicitly authorized.
