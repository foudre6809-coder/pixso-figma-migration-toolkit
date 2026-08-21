# PIX nested translation coordinate report

> Source .pix files remained local. This report contains only synthetic filenames, numeric evidence, structural paths, offsets, and limitations.

## Conclusion

- Status: **PASS**
- Controlled files: 9
- Model: **translation-only-ancestor-sum**
- Parser marker: **confirmed-translation-only**
- Reason: Nested translation-only ancestor composition matched exactly across nine controlled local samples.
- General .pix or full transform support claimed: **no**

## Integrity

| Group | Files | Exact round trip | Stable count | Stable GUIDs | Stable parent chains | Pure translation | Only intended semantic changes |
| --- | ---: | --- | --- | --- | --- | --- | --- |
| single-level | 3 | yes | yes | yes | yes | yes | yes |
| double-level | 2 | yes | yes | yes | yes | yes | yes |
| grandparent-only | 2 | yes | yes | yes | yes | yes | yes |
| siblings | 2 | yes | yes | yes | yes | yes | yes |

- grandparent-only: FrameB and ChildRect local transforms remain unchanged while only ParentFrame moves.
- siblings: The two synthetic rectangles intentionally share a name; stable GUIDs and unique local positions identify them.
- siblings: Their local delta remains exactly (40,40) after the direct parent moves.

## Coordinate evidence

| Sample | Node path | Local | Ancestor translations | Expected absolute | Decoded absolute | Record offset | Confidence |
| --- | --- | --- | --- | --- | --- | ---: | --- |
| nested-single-00.pix | RECTANGLE > FRAME > CANVAS | `{"x":10,"y":20}` | `[{"x":0,"y":0}]` | `{"x":10,"y":20}` | `{"x":10,"y":20}` | 6 | confirmed |
| nested-single-100-200.pix | RECTANGLE > FRAME > CANVAS | `{"x":10,"y":20}` | `[{"x":100,"y":200}]` | `{"x":110,"y":220}` | `{"x":110,"y":220}` | 6 | confirmed |
| nested-single-neg.pix | RECTANGLE > FRAME > CANVAS | `{"x":10,"y":20}` | `[{"x":-50,"y":30}]` | `{"x":-40,"y":50}` | `{"x":-40,"y":50}` | 6 | confirmed |
| nested-double-positive.pix | RECTANGLE > FRAME > FRAME > CANVAS | `{"x":5,"y":6}` | `[{"x":100,"y":200},{"x":30,"y":40}]` | `{"x":135,"y":246}` | `{"x":135,"y":246}` | 6 | confirmed |
| nested-double-negative.pix | RECTANGLE > FRAME > FRAME > CANVAS | `{"x":5,"y":6}` | `[{"x":-40,"y":50},{"x":-30,"y":-20}]` | `{"x":-65,"y":36}` | `{"x":-65,"y":36}` | 6 | confirmed |
| nested-grandparent-00.pix | RECTANGLE > FRAME > FRAME > CANVAS | `{"x":5,"y":6}` | `[{"x":0,"y":0},{"x":30,"y":40}]` | `{"x":35,"y":46}` | `{"x":35,"y":46}` | 6 | confirmed |
| nested-grandparent-80-neg20.pix | RECTANGLE > FRAME > FRAME > CANVAS | `{"x":5,"y":6}` | `[{"x":80,"y":-20},{"x":30,"y":40}]` | `{"x":115,"y":26}` | `{"x":115,"y":26}` | 6 | confirmed |
| nested-siblings-00.pix | RECTANGLE > FRAME > FRAME > CANVAS | `{"x":10,"y":20}` | `[{"x":0,"y":0},{"x":0,"y":0}]` | `{"x":10,"y":20}` | `{"x":10,"y":20}` | 95 | confirmed |
| nested-siblings-00.pix | RECTANGLE > FRAME > FRAME > CANVAS | `{"x":50,"y":60}` | `[{"x":0,"y":0},{"x":0,"y":0}]` | `{"x":50,"y":60}` | `{"x":50,"y":60}` | 6 | confirmed |
| nested-siblings-moved.pix | RECTANGLE > FRAME > FRAME > CANVAS | `{"x":10,"y":20}` | `[{"x":0,"y":0},{"x":100,"y":-30}]` | `{"x":110,"y":-10}` | `{"x":110,"y":-10}` | 95 | confirmed |
| nested-siblings-moved.pix | RECTANGLE > FRAME > FRAME > CANVAS | `{"x":50,"y":60}` | `[{"x":0,"y":0},{"x":100,"y":-30}]` | `{"x":150,"y":30}` | `{"x":150,"y":30}` | 6 | confirmed |

The confirmed rule for these controlled samples is:

`computedAbsolute = node local translation + each ancestor translation`

The two sibling nodes retain local positions (10,20) and (50,60), so their local delta remains exactly (40,40) before and after their direct parent moves.

## Parser boundary

`rect.x/y` remain parent-local. The parser writes `computedAbsoluteX/Y` only under `raw.diagnostics` and only when the complete available chain is a pure translation ending at a root Canvas or root node. The status is `confirmed-translation-only`.

Limitations:

- Confirmed only for Page, Frame, and Rectangle chains containing translation matrices.
- Rotation, scale, skew, mirror, Auto Layout, Group, Section, Component/Instance, and page-origin offsets remain unverified.
- rect.x/y remain parent-local. Computed absolute coordinates are diagnostics-only and are omitted when any ancestor is missing or not a pure translation.
