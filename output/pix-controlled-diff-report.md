# PIX controlled semantic differential report

> All source .pix files remained local. This report contains only synthetic sample names, decoded numeric values, field paths, offsets, and limitations.

## Conclusion

- Status: **PASS**
- Controlled samples: 16
- Reason: Coordinates and all three requested design-attribute groups were confirmed across 16 controlled local samples.
- General .pix parsing support claimed: **no**

## Sample integrity

| Group | Files | Decode/re-encode | Stable target GUID | Stable target identity | Stable node count | Excluded/derived changes |
| --- | ---: | --- | --- | --- | --- | --- |
| coordinate | 4 | yes | yes | yes | yes | none |
| autoLayout | 3 | yes | yes | yes | yes | Child transforms change as a derived consequence of direction. The none sample retains padding/gap storage while stackMode is absent; stackMode alone represents direction state. |
| padding | 4 | yes | yes | yes | yes | Child transforms change deterministically with padding; layoutMode remains HORIZONTAL and gap remains 0. |
| stroke | 5 | yes | yes | yes | yes | strokePaddingPath appears when a stroke exists and is treated as a derived path, not a semantic source field. |

## Confirmed fields

| Semantic | Status | Kiwi field path | Evidence |
| --- | --- | --- | --- |
| coordinate | confirmed | PixsoNode.transform.m02/m12 | 4/4 documented x/y pairs, including negatives, matched exactly |
| Auto Layout direction | confirmed | PixsoNode.stackMode | none/HORIZONTAL/VERTICAL matched |
| Padding | confirmed | PixsoNode.stackPaddingTop, PixsoNode.stackPaddingRight, PixsoNode.stackPaddingBottom, PixsoNode.stackPaddingLeft | 0/8/16 and asymmetric 4/8/12/16 matched |
| Stroke | confirmed | PixsoNode.strokePaints[], PixsoNode.strokePaints[].color, PixsoNode.strokeWeight, PixsoNode.borderTopWeight/borderRightWeight/borderBottomWeight/borderLeftWeight, PixsoNode.strokeAlign | absence, 1/2 px, color, and INSIDE/OUTSIDE matched |

## Coordinate samples

| Sample | Known | Decoded | Field path | Record offset | Confidence |
| --- | --- | --- | --- | ---: | --- |
| coord-00.pix | `{"x":0,"y":0}` | `{"x":0,"y":0}` | PixsoNode.transform.m02/m12 | 6 | confirmed |
| coord-10.pix | `{"x":10,"y":20}` | `{"x":10,"y":20}` | PixsoNode.transform.m02/m12 | 6 | confirmed |
| coord-50.pix | `{"x":50,"y":70}` | `{"x":50,"y":70}` | PixsoNode.transform.m02/m12 | 6 | confirmed |
| coord-neg.pix | `{"x":-20,"y":-30}` | `{"x":-20,"y":-30}` | PixsoNode.transform.m02/m12 | 6 | confirmed |

Model: **local-transform**

Limitations:

- Root samples show no page-origin offset: m02/m12 equal the documented x/y values, including negatives.
- Nested-node m02/m12 values are parent-local translations; page-absolute coordinates require composing ancestor transforms.

## Auto Layout samples

| Sample | Known | Decoded | Field path | Record offset | Confidence |
| --- | --- | --- | --- | ---: | --- |
| layout-none.pix | `null` | `null` | PixsoNode.stackMode | 94 | confirmed |
| layout-horizontal.pix | `"HORIZONTAL"` | `"HORIZONTAL"` | PixsoNode.stackMode | 97 | confirmed |
| layout-vertical.pix | `"VERTICAL"` | `"VERTICAL"` | PixsoNode.stackMode | 94 | confirmed |

Limitations:

- Direction-induced child transform changes are derived and are not used to identify stackMode.

## Padding samples

| Sample | Known | Decoded | Field path | Record offset | Confidence |
| --- | --- | --- | --- | ---: | --- |
| padding-0.pix | `{"top":0,"right":0,"bottom":0,"left":0}` | `{"top":0,"right":0,"bottom":0,"left":0}` | PixsoNode.stackPaddingTop, PixsoNode.stackPaddingRight, PixsoNode.stackPaddingBottom, PixsoNode.stackPaddingLeft | 94 | confirmed |
| padding-8.pix | `{"top":8,"right":8,"bottom":8,"left":8}` | `{"top":8,"right":8,"bottom":8,"left":8}` | PixsoNode.stackPaddingTop, PixsoNode.stackPaddingRight, PixsoNode.stackPaddingBottom, PixsoNode.stackPaddingLeft | 97 | confirmed |
| padding-16.pix | `{"top":16,"right":16,"bottom":16,"left":16}` | `{"top":16,"right":16,"bottom":16,"left":16}` | PixsoNode.stackPaddingTop, PixsoNode.stackPaddingRight, PixsoNode.stackPaddingBottom, PixsoNode.stackPaddingLeft | 97 | confirmed |
| padding-asym.pix | `{"top":4,"right":8,"bottom":12,"left":16}` | `{"top":4,"right":8,"bottom":12,"left":16}` | PixsoNode.stackPaddingTop, PixsoNode.stackPaddingRight, PixsoNode.stackPaddingBottom, PixsoNode.stackPaddingLeft | 97 | confirmed |

Limitations:

- Only numeric padding values are confirmed; variable-bound padding was not present in these samples.

## Stroke samples

| Sample | Known | Decoded | Field path | Record offset | Confidence |
| --- | --- | --- | --- | ---: | --- |
| stroke-none.pix | `{"present":false,"weight":null,"color":null,"align":null}` | `{"present":false,"weight":null,"color":null,"align":null}` | PixsoNode.strokePaints[], PixsoNode.strokePaints[].color, PixsoNode.strokeWeight/border*Weight, PixsoNode.strokeAlign | 6 | confirmed |
| stroke-1.pix | `{"present":true,"weight":1,"color":"#D9DDE7","align":"INSIDE"}` | `{"present":true,"weight":1,"color":"#D9DDE7","align":"INSIDE"}` | PixsoNode.strokePaints[], PixsoNode.strokePaints[].color, PixsoNode.strokeWeight/border*Weight, PixsoNode.strokeAlign | 6 | confirmed |
| stroke-2.pix | `{"present":true,"weight":2,"color":"#D9DDE7","align":"INSIDE"}` | `{"present":true,"weight":2,"color":"#D9DDE7","align":"INSIDE"}` | PixsoNode.strokePaints[], PixsoNode.strokePaints[].color, PixsoNode.strokeWeight/border*Weight, PixsoNode.strokeAlign | 6 | confirmed |
| stroke-color.pix | `{"present":true,"weight":1,"color":"#FF0000","align":"INSIDE"}` | `{"present":true,"weight":1,"color":"#FF0000","align":"INSIDE"}` | PixsoNode.strokePaints[], PixsoNode.strokePaints[].color, PixsoNode.strokeWeight/border*Weight, PixsoNode.strokeAlign | 6 | confirmed |
| stroke-outside.pix | `{"present":true,"weight":1,"color":"#D9DDE7","align":"OUTSIDE"}` | `{"present":true,"weight":1,"color":"#D9DDE7","align":"OUTSIDE"}` | PixsoNode.strokePaints[], PixsoNode.strokePaints[].color, PixsoNode.strokeWeight/border*Weight, PixsoNode.strokeAlign | 6 | confirmed |

- Style reference: **not-found**
- Variable binding: **not-found**

Limitations:

- A 1 px INSIDE stroke omits strokeWeight/strokeAlign defaults but stores four 1 px border weights.
- Visible solid color, opacity, width, and align are confirmed; style references and variable bindings were absent.

## Parser boundary

The parser now emits confirmed local x/y, width/height, Auto Layout direction, four padding values, and visible Stroke values. Gap remains diagnostics-only. Style references and variable bindings remain not-found and are not synthesized.
