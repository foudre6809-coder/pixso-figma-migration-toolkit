# Compatibility Notes

## Verified By Implementation

- The repository provides local plugin manifests for Pixso and Figma.
- Migration data is validated with a versioned schema.
- Figma-side layout planning supports layout mode, padding, gap, and hug sizing operations.
- Node matching handles missing migration IDs and reports ambiguity.
- Pixso export supports selected nodes, selected artboards, or the current page, split into root-node batches.
- Figma repair reports unsafe component/instance matches, text differences, missing image fills, vector conversion, and size anomalies.
- Sketch-imported groups can match Pixso frames, and repeated names are disambiguated with indexed hierarchy paths.
- A missing outer Sketch artboard can be treated as a flattened root; matching then uses page-absolute geometry instead of child-local geometry.
- Matched Figma nodes receive a persistent migration ID, so later repair runs do not depend on positions changed by Auto Layout.
- Solid fill, solid stroke, stroke width/alignment, and corner radii are restored when Pixso exposes them natively.
- Gradient, image, and multi-layer Paint values are left untouched when the current schema cannot represent them completely; they are never converted into an empty fill or stroke.
- HUG height maps to Figma Auto sizing with the original Pixso height retained as `minHeight`.
- Migration IDs prefer Pixso's stable node ID and are checked for duplicates before export and import. Duplicate IDs stop export or remain ambiguous instead of being bound by order.
- Both plugin interfaces and user-facing diagnostics are displayed in Chinese.
- Capability reports recursively inspect the selected subtree and include per-field coverage plus non-sensitive layout samples.
- Capability probing checks `layoutPositioning`, `layoutAlign`, `layoutGrow`, `isAbsolute`, and `ignoreAutoLayout`. When overlapping children are found and positioning cannot be confirmed, Auto Layout is skipped and reported as partial.
- Image-filled Pixso nodes are classified as images before rectangle/vector type mapping. Image summaries include fill count, scale modes, opacity, blend mode, available hashes, and transform presence.
- Batched exports retain each root's original page or selection index in both `originalIndex` and its root path.
- Figma provides a read-only preview stage and a separate safe-repair stage. High-risk items are skipped by default.
- Retained complex background rectangles are made absolute before `layoutMode` is set, then restored to their saved local position.
- Main Components are rebuilt only when a source Component has a unique high-confidence match to an ordinary Figma Frame. Instance candidates are reported but not rebound automatically.

## Must Be Verified In User Pixso Deployment

- Whether selected nodes expose all descendants.
- Whether Auto Layout fields are readable.
- Whether component and instance fields are readable.
- Whether text styles, image fills, SVG/vector details, and plugin data are readable.
- Whether `setPluginData` is permitted.
- Which of the private deployment's absolute-position candidates are present and what values they return.

## Verified With User Sample

- The `InputNumber 数字输入框` sample contained 252 Pixso metadata nodes and 252 Sketch nodes.
- Offline matching resolved all 252 nodes after frame/group compatibility and indexed hierarchy matching were added.
- The sample exposed geometry for all nodes, but did not expose recoverable Auto Layout values; this remains a Pixso API capability limit rather than a matcher failure.
- Figma results distinguish actual modifications from nodes that were only matched and verified, so zero-change runs are not reported as successful repairs.
- Sketch-imported groups with recoverable layout data are converted in place before Auto Layout is applied. A plain full-size bottom rectangle is promoted to the Frame's fills, strokes, corners, and effects; complex backgrounds remain as absolute-positioned child layers; uncertain backgrounds remain untouched. Lost component links remain explicitly reported.
- The `Input 输入框` export contains 960 metadata nodes. Pixso exposed 621 solid fills, 161 solid strokes, and 535 corner-radius values; these fields are available for Figma-side appearance restoration.

## Awaiting Clean-Import Visual Verification

- When Sketch removes a Pixso frame's transparent outer bounds, Group-to-Frame conversion now restores the Pixso position and size before applying Auto Layout. This is intended to prevent padding from shifting the whole component.
- A run against a file already changed by earlier plugin versions is diagnostic only. It cannot be used as the 80%-90% visual acceptance result because prior Auto Layout changes have already moved repeated nodes away from their original matching coordinates.
- Final acceptance requires a clean Sketch import, a first repair run, and side-by-side Pixso/Figma screenshots with selection outlines cleared.

## Known Limits

- Private Pixso API differences may require adapter edits in `apps/pixso-plugin/src/main.ts`.
- Sketch import may rename or regroup nodes, lowering match confidence.
- Overlapping repeated nodes with identical names, types, hierarchy, and geometry remain intentionally ambiguous unless a migration ID has already been written.
- Geometry-based HUG inference remains conservative for files whose private Pixso API does not expose sizing modes. Unconfirmed overlapping or absolute-position cases are skipped rather than automatically repaired.
- Figma plugin does not automatically rebind uncertain component instances.
- Page export requires the private deployment to expose `currentPage.children`; otherwise the plugin reports the capability gap.
- Cancellation is checked between root-node batches. A single very large artboard still completes its current batch before stopping.
- Variables, variants, constraints, and prototypes are not fully restored in V1.
