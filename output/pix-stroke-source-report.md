# PIX stroke source provenance differential report

> Source .pix files stayed local. This report contains synthetic sample names, decoded field paths, value summaries, and record offsets only.

## Conclusion

- Status: **FIX**
- Samples used: 8
- Missing samples: stroke-variable-detached.pix, stroke-variable-value-b.pix
- Reason: At least one stroke source chain has evidence, but the matrix is incomplete or one chain is not confirmed.
- General .pix parsing support claimed: **no**

## Integrity

| Check | Result |
| --- | --- |
| Decode/re-encode samples | 8/8 |
| Stable target GUID | yes |
| Stable target identity | yes |
| Stable node count | no |
| Unexpected decoded changes | none |

## Sample Summary

| Sample | Expected source | GUID | Nodes | Record offset | Visible stroke |
| --- | --- | --- | ---: | ---: | --- |
| stroke-inline-blue.pix | inline | 22:1 | 12 | 354 | {"weight":2,"align":"INSIDE","color":"#3366FF"} |
| stroke-style-blue.pix | shared-style | 22:1 | 13 | 504 | {"weight":2,"align":"INSIDE","color":"#3366FF"} |
| stroke-style-detached-blue.pix | detached-style | 22:1 | 13 | 633 | {"weight":2,"align":"INSIDE","color":"#3366FF"} |
| stroke-style-value-blue.pix | shared-style | 22:1 | 13 | 504 | {"weight":2,"align":"INSIDE","color":"#3366FF"} |
| stroke-style-value-green.pix | shared-style | 22:1 | 13 | 501 | {"weight":2,"align":"INSIDE","color":"#3366FF"} |
| stroke-inline-variable-value.pix | inline | 22:1 | 13 | 633 | {"weight":2,"align":"INSIDE","color":"#3366FF"} |
| stroke-variable-bound.pix | variable-bound | 22:1 | 15 | 783 | {"weight":2,"align":"INSIDE","color":"#3366FF"} |
| stroke-variable-value-a.pix | variable-bound | 22:1 | 15 | 783 | {"weight":2,"align":"INSIDE","color":"#3366FF"} |

## Source Evidence

| Source | Status | Identity candidate paths | Value paths | Samples |
| --- | --- | --- | --- | --- |
| Shared style | confirmed | `inheritStrokeStyleID.sessionID`, `inheritStrokeStyleID.localID` | none | stroke-inline-blue.pix, stroke-style-blue.pix, stroke-style-detached-blue.pix, stroke-style-value-blue.pix, stroke-style-value-green.pix |
| Variable binding | inferred | `strokePaints[0].colorVar.value.alias.guid.sessionID`, `strokePaints[0].colorVar.value.alias.guid.localID`, `strokePaints[0].colorVar.dataType`, `strokePaints[0].colorVar.resolvedDataType` | none | stroke-inline-variable-value.pix, stroke-variable-bound.pix, stroke-variable-value-a.pix |

## Evidence Chains

Style:

- inline -> style introduces stable non-appearance fields
- style -> detached removes those fields while keeping the visible blue stroke
- style blue -> style green keeps identity fields stable; decoded target visible stroke did not change

Limitations:

- Shared style evidence is scoped to color style binding on stroke paint.
- The style-value-green sample did not change decoded visible stroke fields; shared style definition value storage remains not-found.

Variable:

- inline variable value -> variable bound introduces candidate non-appearance fields
- variable bound -> value A is stable
- variable detached and value B samples are required to confirm identity and value propagation

Limitations:

- Missing variable samples: stroke-variable-detached.pix, stroke-variable-value-b.pix

## Complete Decoded-Node Structured Diffs

### stroke-inline-blue.pix -> stroke-style-blue.pix

Changed fields: 2

| Field path | Left | Right |
| --- | --- | --- |
| inheritStrokeStyleID.localID | `null` | `2` |
| inheritStrokeStyleID.sessionID | `null` | `22` |

### stroke-style-blue.pix -> stroke-style-detached-blue.pix

Changed fields: 2

| Field path | Left | Right |
| --- | --- | --- |
| inheritStrokeStyleID.localID | `2` | `0` |
| inheritStrokeStyleID.sessionID | `22` | `0` |

### stroke-style-value-blue.pix -> stroke-style-value-green.pix

Changed fields: 0

| Field path | Left | Right |
| --- | --- | --- |
| none | `null` | `null` |

### stroke-inline-variable-value.pix -> stroke-variable-bound.pix

Changed fields: 4

| Field path | Left | Right |
| --- | --- | --- |
| strokePaints[0].colorVar.dataType | `null` | `"ALIAS"` |
| strokePaints[0].colorVar.resolvedDataType | `null` | `"COLOR"` |
| strokePaints[0].colorVar.value.alias.guid.localID | `null` | `3` |
| strokePaints[0].colorVar.value.alias.guid.sessionID | `null` | `26` |

## Parser Boundary

The parser keeps `attributes.stroke` as resolved visible appearance only. Source provenance is research diagnostics only, and this report does not make the production parser emit unconfirmed style or variable binding fields.
